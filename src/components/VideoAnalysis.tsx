import { jsonrepair } from 'jsonrepair';
import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Upload, Play, Square, FileVideo, Radio, Activity,
  AlertTriangle, ChevronRight, Sparkles, TrendingUp, ListChecks,
  Maximize2, Minimize2
} from 'lucide-react';
import {
  ExtractedFrame, TimestampedIssue, VideoAnalysisResult,
  ArmSupplement, MotionMetadata,
  FRAME_CONFIG
} from '../types';
import { initPoseEngine, detectPose, LANDMARK } from '../utils/poseEngine';

/** 异步 API 轮询间隔 */
const DEFAULT_FRAME_COUNT = 10;

/** 计算三点间角度（度）— 用于肘关节角度 */
function calcAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * bc.x + ab.y * bc.y;
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magAB < 0.001 || magBC < 0.001) return 0;
  const cosA = Math.max(-1, Math.min(1, dot / (magAB * magBC)));
  return Math.round(Math.acos(cosA) * (180 / Math.PI));
}

/** 将归一化 bbox [ymin, xmin, ymax, xmax] 换算为视频像素坐标 */
interface PixelBBox {
  x: number; y: number;
  width: number; height: number;
}
function normalizedBboxToPixel(
  bbox: [number, number, number, number],
  videoWidth: number,
  videoHeight: number,
): PixelBBox {
  const [ymin, xmin, ymax, xmax] = bbox;
  const x = (xmin / 1000) * videoWidth;
  const y = (ymin / 1000) * videoHeight;
  const w = ((xmax - xmin) / 1000) * videoWidth;
  const h = ((ymax - ymin) / 1000) * videoHeight;
  return { x, y, width: w, height: h };
}

/** 分析中轮换文案 */
const ANALYZING_MESSAGES = [
  '教练正在仔细查看你的攀爬动作...',
  '教练正在查阅抱石指南...',
  '教练正在对比标准动作...',
  '教练正在圈出需要改进的地方...',
];

export function VideoAnalysis() {
  // ── 文件 & 播放 ──
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);         // 实时播放进度

  // ── 分析流程 ──
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'submitting' | 'analyzing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  // ── 分析结果 ──
  const [result, setResult] = useState<VideoAnalysisResult | null>(null);
  const [issues, setIssues] = useState<TimestampedIssue[]>([]);
  const [activeIssue, setActiveIssue] = useState<number | null>(null);
  const [keyframes, setKeyframes] = useState<Record<number, string>>({});
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null); // 联动过滤

  // ── TaskId（state 驱动轮询 useEffect，StrictMode 安全）──
  // taskId removed — replaced by streaming

  // ── Ref ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const extractCanvasRef = useRef<HTMLCanvasElement>(null);
  const bboxOverlayRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<ExtractedFrame[]>([]);
  const msgRef = useRef<number | null>(null);

  // 清理（仅 URL 和消息轮换）
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (msgRef.current) {
        clearInterval(msgRef.current);
        msgRef.current = null;
      }
    };
  }, [videoUrl]);

  // 分析中轮换文案
  useEffect(() => {
    if (phase === 'analyzing') {
      let idx = 0;
      msgRef.current = window.setInterval(() => {
        idx = (idx + 1) % ANALYZING_MESSAGES.length;
        setStatusText(ANALYZING_MESSAGES[idx]);
      }, 4000);
    }
    return () => {
      if (msgRef.current) {
        clearInterval(msgRef.current);
        msgRef.current = null;
      }
    };
  }, [phase]);

  // ── 流式读取（替代异步轮询） ──
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const isSubmittingRef = useRef(false); // 📌 防并发锁

  const readStream = useCallback(async (
    response: Response,
    onProgress: (raw: string) => void,
  ): Promise<string> => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('响应流不可读');

    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: !done });
      result += chunk;

      // 提取 SSE data: 行内容
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) throw new Error(parsed.error);
            const content = parsed.choices?.[0]?.delta?.content || '';
            buffer += content;
            onProgress(buffer);
          } catch (e: any) {
            if (e.message !== 'Unexpected token') throw e;
          }
        }
      }
    }
    // 最终返回完整 buffer（即完整 JSON 字符串）
    // fallback: 如果 SSE 解析没拿到内容，直接返回原始响应体
    return buffer || result;
  }, []);
  // ── AI 输出 JSON 修复（处理常见格式错误） ──
  function repairJSON(raw: string): string {
    let s = raw.trim();
    // 1. 只取首个 { 到末个 } 之间的内容
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1);
    }
    // 2. 去掉尾随逗号（常见于 AI 生成的数组/对象末尾）
    s = s.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
    // 3. 单引号 → 双引号（jsonrepair 有时对中文单引号敏感）
    s = s.replace(/'/g, '"');
    // 4. 未引号属性名补引号
    s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    // 5. jsonrepair 自动修复合（兜不住时 return 原始串）
    try {
      return jsonrepair(s);
    } catch {
      return s;
    }
  }

  const extractKeyframes = useCallback(async (issueList: TimestampedIssue[]) => {
    const video = videoRef.current;
    const canvas = extractCanvasRef.current;
    if (!video || !canvas || issueList.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const { WIDTH, HEIGHT, QUALITY } = FRAME_CONFIG;
    const results: Record<number, string> = {};

    for (let i = 0; i < issueList.length; i++) {
      video.currentTime = issueList[i].timestamp;
      await new Promise<void>((resolve) => {
        let done = false;
        const timeoutId = setTimeout(() => {
          if (done) return;
          done = true;
          console.warn(`[Keyframe] seek timeout at ${issueList[i].timestamp}s`);
          captureKF();
        }, 4000);

        const onSeeked = () => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          video.removeEventListener('seeked', onSeeked);
          captureKF();
        };
        video.addEventListener('seeked', onSeeked);

        function captureKF() {
          requestAnimationFrame(() => {
            try {
              ctx.drawImage(video, 0, 0, WIDTH, HEIGHT);
            } catch (_) {}
            results[i] = canvas.toDataURL('image/jpeg', QUALITY);
            resolve();
          });
        }
      });
    }
    setKeyframes(results);
  }, []);

  // ── 打开 HTML 完整报告（新窗口） ──
  const openReport = useCallback(() => {
    const r = result;
    const imgMap = keyframes;
    if (!r) return;

    const issueCards = (r.issues || []).map((issue, i) => {
      const sevColor = issue.severity === 'high' ? '#ef4444' : issue.severity === 'mid' ? '#f59e0b' : '#eab308';
      const imgHtml = imgMap[i]
        ? `<div style="margin-bottom:12px;border-radius:12px;overflow:hidden;border:1px solid #334155;"><img src="${imgMap[i]}" style="width:100%;display:block;"/></div>`
        : '';
      const kwHtml = (issue.correction_keywords || []).map(k =>
        `<span style="display:inline-block;padding:2px 8px;background:#1e293b;border-radius:999px;font-size:12px;color:#94a3b8;margin:2px;">${k}</span>`
      ).join(' ');
      return `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:16px;margin-bottom:12px;">
        ${imgHtml}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:white;background:${sevColor};">${issue.severity}</span>
          <span style="font-size:12px;color:#64748b;font-family:monospace;">${issue.timestamp.toFixed(1)}s</span>
        </div>
        <p style="font-size:15px;font-weight:700;color:#f1f5f9;margin:0 0 4px;">${issue.issue_type}</p>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 8px;">${issue.suggestion}</p>
        ${kwHtml}
      </div>`;
    }).join('\n');

    const sHtml = (items: string[] | undefined, color: string) => items?.length
      ? `<div style="margin-top:16px;">
           <h4 style="font-size:12px;font-weight:700;color:${color};margin:0 0 8px;">${
             color === '#22c55e' ? '\u2714 做得好的' : color === '#ef4444' ? '\u26a0 需要改进' : '\u2191 改进建议'
           }</h4>
           <ul style="list-style:none;padding:0;margin:0;">
             ${items.map(s => `<li style="font-size:13px;color:#94a3b8;padding-left:12px;border-left:2px solid ${color}40;margin-bottom:4px;">${s}</li>`).join('\n')}
           </ul>
         </div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>攀爬动作分析报告</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#020617;color:#e2e8f0}
  .container{max-width:720px;margin:0 auto;padding:24px 16px 48px}
  h1{font-size:22px;font-weight:900;margin-bottom:20px;text-align:center}
  .score-box{text-align:center;background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:20px;padding:24px;margin-bottom:24px;border:1px solid #334155}
  .score-num{font-size:48px;font-weight:900;color:#f97316}
  .score-label{font-size:14px;color:#64748b;margin-top:4px}
  .summary{font-size:14px;color:#94a3b8;line-height:1.7;margin-top:16px;text-align:left}
</style></head>
<body><div class="container">
  <h1>\u722c\u77f3\u52a8\u4f5c\u5206\u6790\u62a5\u544a</h1>
  <div class="score-box">
    <div class="score-num">${r.overall_score}<span style="font-size:20px;font-weight:400;color:#64748b;">/100</span></div>
    <div class="score-label">AI \u7efc\u5408\u8bc4\u5206</div>
    <div class="summary">${r.summary || ''}</div>
    ${sHtml(r.strengths, '#22c55e')}
    ${sHtml(r.weaknesses, '#ef4444')}
    ${sHtml(r.improvements, '#f97316')}
  </div>
  ${r.issues?.length ? '<h2 style="font-size:16px;font-weight:700;margin-bottom:12px;">\u5173\u952e\u95ee\u9898</h2>' + issueCards : ''}
  <p style="text-align:center;font-size:12px;color:#475569;margin-top:24px;">Bouldering AI Pro &middot; AI \u62b1\u77f3\u6559\u7ec3</p>
</div></body></html>`;

    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }, [result, keyframes]);

  // ── 文件选择 ──
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);

    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setPhase('idle');
    setResult(null);
    setIssues([]);
    setActiveIssue(null);
    setErrorText(null);
    setProgress(0);
    setKeyframes({});
    setSelectedPhase(null);
    setCurrentTime(0);
  }, [videoUrl]);

  // ── 视频元数据加载完毕 ──
  const handleMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) setVideoDuration(video.duration);
  }, []);

  // ── 实时进度追踪 ──
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, []);

  // ── 开始抽帧 → 流式分析 ──
  const startAnalysis = useCallback(async () => {
    const video = videoRef.current;
    const canvas = extractCanvasRef.current;
    if (!video || !canvas) return;

    // 确保视频元数据已加载
    if (video.readyState < 1) {
      await new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    }
    // 额外等待实际帧数据加载完毕（移动端 Safari 常见问题：loadedmetadata 后 drawImage 仍是黑帧）
    if (video.readyState < 3) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000); // 3 秒兜底
        video.addEventListener('canplay', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    let duration = video.duration;
    if (duration <= 0 || !isFinite(duration) || duration === Infinity) {
      console.warn('[VideoAnalysis] waiting for valid duration, current:', duration);
      await new Promise<void>((r) => setTimeout(r, 1000));
      duration = video.duration;
    }
    if (duration <= 0 || !isFinite(duration) || duration === Infinity) {
      console.error('[VideoAnalysis] invalid video duration after retry:', duration);
      setErrorText('无法读取视频时长，可能是手机浏览器不支持的视频格式。请检查视频能否正常播放，或尝试重新录制。');
      setPhase('error');
      return;
    }

    setPhase('extracting');
    setErrorText(null);
    setStatusText('正在提取关键帧...');
    setProgress(5);

    // 1. 计算抽帧间隔
    const interval = duration / DEFAULT_FRAME_COUNT;
    const extracted: ExtractedFrame[] = [];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const { WIDTH, HEIGHT, QUALITY } = FRAME_CONFIG;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    // 2. 逐帧抽取 + MediaPipe 骨骼检测
    video.pause();
    let poseEngineReady = false;
    try {
      await initPoseEngine();
      poseEngineReady = true;
      console.log('[VideoAnalysis] PoseEngine 加载成功，将检测手臂骨骼');
    } catch (e) {
      console.warn('[VideoAnalysis] PoseEngine 加载失败，跳过骨骼检测:', e);
    }

    const armSupplement: ArmSupplement[] = [];
    const SEEK_TIMEOUT = 4000; // 移动端 Safari 兼容：4 秒超时
    let lastMediaPipeTimestamp = -1; // 📌 强制 MediaPipe 时间戳单调递增
    for (let i = 0; i < DEFAULT_FRAME_COUNT; i++) {
      const targetTime = i * interval;
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        let done = false;
        const timeoutId = setTimeout(() => {
          if (done) return;
          done = true;
          console.warn(`[Frame] seek timed out at ${targetTime}s, capturing anyway`);
          captureFrame();
        }, SEEK_TIMEOUT);

        const onSeeked = () => {
          if (done) return;
          done = true;
          clearTimeout(timeoutId);
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('timeupdate', onTimeUpdate);
          captureFrame();
        };
        video.addEventListener('seeked', onSeeked);

        // 部分移动端浏览器 seek 不触发 seeked，用 timeupdate 兜底
        const onTimeUpdate = () => {
          if (done) return;
          if (Math.abs(video.currentTime - targetTime) < 0.5) {
            done = true;
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('timeupdate', onTimeUpdate);
            captureFrame();
          }
        };
        video.addEventListener('timeupdate', onTimeUpdate);

        function captureFrame() {
          requestAnimationFrame(() => {
            try {
              ctx!.drawImage(video, 0, 0, WIDTH, HEIGHT);
            } catch (drawErr) {
              console.warn('[Frame] drawImage error at', targetTime, drawErr);
            }
            const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
            const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

            // 检查是否为全黑帧（移动端 Safari 常见问题：loadedmetadata 后 drawImage 仍是黑帧）
            try {
              const imgData = ctx!.getImageData(0, 0, 4, 4);
              const isBlack = imgData.data.every((v) => v === 0);
              if (isBlack) {
                console.warn(`[Frame] 帧 ${targetTime.toFixed(1)}s 是全黑，可能是移动端视频解码问题`);
              }
            } catch (_e) {
              // getImageData 可能因 canvas 污染抛 SecurityError，静默忽略
            }

            extracted.push({ base64, timestamp: targetTime });

            // ── 骨骼检测：提取手臂角度 ──
            if (poseEngineReady && video.videoWidth > 0 && video.videoHeight > 0) {
              try {
                // 📌 MediaPipe 要求时间戳严格单调递增，超时兜底可能导致倒流
                let mpTimestamp = Math.round(targetTime * 1000);
                if (mpTimestamp <= lastMediaPipeTimestamp) {
                  mpTimestamp = lastMediaPipeTimestamp + 1;
                }
                lastMediaPipeTimestamp = mpTimestamp;

                const pose = detectPose(video, mpTimestamp, {
                  width: video.videoWidth,
                  height: video.videoHeight,
                });
                if (pose?.landmarks) {
                  const ls = pose.landmarks;
                  const lElbow = ls[LANDMARK.LEFT_ELBOW];
                  const lShoulder = ls[LANDMARK.LEFT_SHOULDER];
                  const lWrist = ls[LANDMARK.LEFT_WRIST];
                  const rElbow = ls[LANDMARK.RIGHT_ELBOW];
                  const rShoulder = ls[LANDMARK.RIGHT_SHOULDER];
                  const rWrist = ls[LANDMARK.RIGHT_WRIST];

                  if (lElbow && lShoulder && lWrist) {
                    const lAngle = calcAngle(lShoulder, lElbow, lWrist);
                    const rAngle = rShoulder && rElbow && rWrist
                      ? calcAngle(rShoulder, rElbow, rWrist)
                      : undefined;

                    const notes: string[] = [];
                    if (lAngle > 160) notes.push('左臂直臂挂肉(省力)');
                    else if (lAngle < 90) notes.push('左臂屈臂死锁(费体能)');
                    if (rAngle != null && rAngle > 160) notes.push('右臂直臂挂肉(省力)');
                    else if (rAngle != null && rAngle < 90) notes.push('右臂屈臂死锁(费体能)');

                    // 检查手臂可见性
                    if (lShoulder.visibility && lShoulder.visibility < 0.5) notes.push('左臂被遮挡，角度为推测值');
                    if (rShoulder?.visibility && rShoulder.visibility < 0.5) notes.push('右臂被遮挡，角度为推测值');

                    armSupplement.push({
                      timestamp: targetTime,
                      left_elbow_angle: lAngle,
                      right_elbow_angle: rAngle,
                      note: notes.length > 0 ? notes.join('；') : undefined,
                    });
                  }
                }
              } catch (e) {
                // 骨骼检测失败静默跳过
                console.warn(`[VideoAnalysis] 帧 ${targetTime}s 骨骼检测失败:`, e);
              }
            }

            setProgress(5 + Math.round((i + 1) / DEFAULT_FRAME_COUNT * 40));
            resolve();
          });
        }
      });
    }

    framesRef.current = extracted;

    // 3. 流式提交分析
    setPhase('submitting');
    setProgress(46);
    setStatusText('正在提交给 AI 分析...');

    const timestamps = extracted.map((f, i) => {
      const ts = f.timestamp ?? i * interval;
      return `第${i + 1}张：${Number.isFinite(ts) ? ts.toFixed(1) : '?'}秒`;
    }).join('\n');

    const prompt = `# Role
你是一名国家级专业抱石攀岩教练兼比赛主裁判。请分析输入的${DEFAULT_FRAME_COUNT}张按时间排序的攀岩截图，并结合我为你提供的前端骨骼检测元数据（MediaPipe 实测肘关节角度），进行深度、连贯的复盘。

# 截图时间序
${timestamps}

# Core Philosophy
攀岩是时序连贯的艺术，严禁进行孤立的单帧判定。

# 终局裁判与顶端控制规范 (Top-Out & Endgame Rules)
你现在不仅是教练，更是抱石比赛的【主裁判】。视频的最后 3-4 帧通常对应攀爬的终局，必须通过以下物理特征精准分析顶端控制并给出判定。

**核心原则：默认 UNKNOWN，除非有明确证据。** 不确认的情况一律用 UNKNOWN，不要臆断。

### [SUCCESS 完攀] 判定标准
- 双手同时出现在墙体顶端终点（Top Hold）位置 → 即判定 SUCCESS，不要求保持帧数，无需关注下墙姿态

### [FAIL 坠落] 判定标准（必须有明确失控证据）
- 必须有**明确的身体失控迹象**：四肢在空中突然失去平衡、身体明显偏离岩墙无法抓回、惊恐脱手等
- 单凭"未观察到合分"不能判 FAIL，必须画面清楚显示坠落过程
- 满足以上条件 → climb_result = "FAIL"

### [UNKNOWN 默认]
- 既未确认合分成功，也无明确失控坠落证据 → 一律 UNKNOWN
- 可能情况：主动下墙、画面盲区合分、合分瞬间跳落等

### 顶端动作控制 KPI
- 审视终点**手部锁定**与**重心移动**：果断动态冲顶（Dyno to Top）后高质量合分？还是终点犹豫倒手耗尽体力？
- 骨骼数据显示合分时手臂是否已死锁（肘角 < 90° 代偿）？
- 合分精准度评分 top_control_score（0-100）及合分状态 top_hand_match_status

### 输出要求
- 所有内容基于实际画面，不要编造
- bbox 使用 0-1000 归一化整数坐标，紧凑裁剪
- 必须分析双臂发力状态（直臂挂肉/屈臂死锁/过渡自然）
- 判断终局结果 climb_result
- 只返回 JSON，不要其他文字
- 🚫 JSON 字符串值内严禁使用未经转义的英文双引号，若需引用口语请改用中文引号或单引号

### 输出 JSON 格式
{
  "climb_result": "SUCCESS | FAIL | UNKNOWN",
  "end_game_reason": "裁判依据（详细描述合分/坠落过程及时间点）",
  "top_control_score": "0-100整数，顶端控制分",
  "top_hand_match_status": "perfect_match | struggling_match | no_match",
  "overall_score": 整数,
  "summary": "一句话总评（15字内）",
  "sequence_analysis": "完整动作叙事（100-150字）",
  "phases": [{"phase_name":"起步(Start)|过渡(Transition)|核心发力(Crux)|完攀/结束(Finish)", "time_range":[0,0], "summary":"不超过30字", "status":"good|warning|critical"}],
  "issues": [{"timestamp":0, "issue_type":"", "severity":"high|mid|low", "bbox":[0,0,0,0], "suggestion":"", "correction_keywords":[]}],
  "strengths": [], "weaknesses": [], "improvements": []
}

`;
    try {
      setProgress(50);
      setStatusText('AI 教练正在分析动作...');

      // 进度条随时间平滑推进 50%→95%
      let elapsedSec = 0;
      streamTimerRef.current = window.setInterval(() => {
        elapsedSec++;
        const pct = 50 + Math.min(elapsedSec / 45, 1) * 45;
        setProgress(Math.round(pct));
      }, 1000);

      // 📌 防并发锁：同一时间只允许一次提交
      if (isSubmittingRef.current) {
        throw new Error('已有分析请求在进行中');
      }
      isSubmittingRef.current = true;

      const controller = new AbortController();
      streamAbortRef.current = controller;

      let analysisResult: VideoAnalysisResult | null = null;

      try {
        const res = await fetch('/api/analyze-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            frames: extracted,
            prompt,
            model: 'glm-5v-turbo',
            motion_metadata: armSupplement.length > 0
              ? { arm_analysis_supplement: armSupplement }
              : undefined,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (res.status === 504) {
            throw new Error('Netlify 服务器超时（10秒限制）。请使用本地开发环境 (localhost:3001) 或稍后重试。部署版不支持 10 帧以上分析。');
          }
          throw new Error(err.error || `提交失败 HTTP ${res.status}`);
        }

        // 读取流
        setStatusText('AI 教练正在实时看片...');
        const json = await res.json();
        const rawJson = json.content || '';

        if (!rawJson) {
          throw new Error(json.error || 'AI 未返回有效内容');
        }

        // 流结束，解析完整 JSON
        if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
        streamAbortRef.current = null;

        // 清理可能的 markdown 包裹
        const cleaned = rawJson.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
        try {
          analysisResult = JSON.parse(cleaned);
        } catch (_) {
          try {
            const repaired = repairJSON(cleaned);
            analysisResult = JSON.parse(repaired);
          } catch (_e) {
            const fallbackMatch = cleaned.match(/\"climb_result\"\s*:\s*\"(SUCCESS|FAIL|UNKNOWN)\"/);
            const scoreMatch = cleaned.match(/\"overall_score\"\s*:\s*(\d+)/);
            const summaryMatch = cleaned.match(/\"summary\"\s*:\s*\"([^"]+?)\"(?=\s*[,}])/);
            analysisResult = {
              climb_result: (fallbackMatch?.[1] as any) || 'UNKNOWN',
              end_game_reason: 'AI 输出格式异常，请重试',
              overall_score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
              summary: summaryMatch?.[1] || '分析完成',
              sequence_analysis: '',
              issues: [],
              phases: [],
              strengths: [],
              weaknesses: [],
              improvements: [],
            } as VideoAnalysisResult;
          }
        }
      } finally {
        isSubmittingRef.current = false;
      }

      if (!analysisResult) throw new Error('分析失败');

      setResult(analysisResult);
      setIssues(analysisResult?.issues || []);
      setProgress(100);
      setPhase('done');
      setStatusText('分析完成');
      void extractKeyframes(analysisResult?.issues || []);

      const vid = videoRef.current;
      if (vid) { vid.play(); }
      setIsPlaying(true);

    } catch (err) {
      console.error('[stream] error:', err);
      if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
      streamAbortRef.current = null;
      if ((err as any)?.name === 'AbortError') {
        setErrorText('流式请求被中断');
      } else {
        setErrorText(err instanceof Error ? err.message : '分析失败');
      }
      setPhase('error');
    }
  }, []);

  // ── 时间戳点击跳转 ──
  const jumpToTimestamp = useCallback((ts: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ts;
    video.play();
    setIsPlaying(true);
    setActiveIssue(issues.findIndex(i => i.timestamp === ts));
  }, [issues]);

  // ── 阶段点击跳转 ──
  const jumpToPhase = useCallback((ts: number, phaseName: string) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ts;
    video.play();
    setIsPlaying(true);
    setSelectedPhase(phaseName);
    const phase = result?.phases?.find(p => p.phase_name === phaseName);
    if (phase && result) {
      const firstIssueIdx = result.issues.findIndex(
        i => i.timestamp >= phase.time_range[0] && i.timestamp <= phase.time_range[1]
      );
      setActiveIssue(firstIssueIdx >= 0 ? firstIssueIdx : null);
    }
  }, [result]);

  // ── 按阶段过滤问题 ──
  const filteredIssues = (() => {
    if (!selectedPhase || !videoDuration || !result?.phases) return issues;
    const phase = result.phases.find(p => p.phase_name === selectedPhase);
    if (!phase) return issues;
    return issues.filter(i => i.timestamp >= phase.time_range[0] && i.timestamp <= phase.time_range[1]);
  })();

  // ── BBox 叠加绘制 ──
  useEffect(() => {
    const canvas = bboxOverlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // 匹配 canvas 尺寸到视频实际渲染尺寸
    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (activeIssue === null) return;
    const issue = issues[activeIssue];
    if (!issue?.bbox) return;

    const pb = normalizedBboxToPixel(issue.bbox, canvas.width, canvas.height);

    // 红色半透明矩形
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(pb.x, pb.y, pb.width, pb.height);

    // 左上角标签
    ctx.fillStyle = '#ef4444cc';
    ctx.fillRect(pb.x, pb.y - 24, ctx.measureText('⚠').width + 24, 24);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('⚠ ' + issue.severity.toUpperCase(), pb.x + 6, pb.y - 7);
  }, [activeIssue, issues]);

  // ── 播放/暂停 ──
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // ── 重置 ──
  const resetAll = useCallback(() => {
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setPhase('idle');
    setResult(null);
    setIssues([]);
    setActiveIssue(null);
    setErrorText(null);
    setProgress(0);
    setKeyframes({});
    setSelectedPhase(null);
    setCurrentTime(0);
  }, [videoUrl]);

  // ── 渲染：问题标记条 ──
  const renderTimeline = () => {
    if (!videoDuration || issues.length === 0) return null;

    return (
      <div className="relative w-full h-6 bg-slate-800 rounded-full overflow-hidden mt-2">
        {issues.map((issue, i) => {
          const left = (issue.timestamp / videoDuration) * 100;
          const color = issue.severity === 'high' ? 'bg-red-500' :
                        issue.severity === 'mid' ? 'bg-amber-500' : 'bg-yellow-500';
          return (
            <button
              key={i}
              onClick={() => jumpToTimestamp(issue.timestamp)}
              className={`absolute top-1 min-w-[28px] min-h-[28px] w-4 h-4 rounded-full ${color} border-2 border-slate-900 
                         hover:scale-125 transition-transform cursor-pointer z-10
                         ${activeIssue === i ? 'ring-2 ring-white scale-125' : ''}`}
              style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
              title={`${issue.issue_type} @ ${issue.timestamp.toFixed(1)}s`}
            />
          );
        })}
      </div>
    );
  };

  // ── 渲染 ──
  return (
    <div className="flex flex-col items-center h-full overflow-y-auto pt-16">
      {/* 隐藏的画布 */}
      <canvas ref={extractCanvasRef} width={640} height={480} style={{ display: 'none' }} />

      {/* ═══════════ 闲置状态：选文件 ═══════════ */}
      {phase === 'idle' && !videoFile && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-6 w-full max-w-md pt-10"
        >
          <div className="w-20 h-20 bg-orange-600/20 rounded-3xl flex items-center justify-center">
            <FileVideo className="w-10 h-10 text-orange-500" />
          </div>
          <h2 className="text-xl font-black text-white text-center">上传攀爬视频</h2>
          <p className="text-sm text-slate-400 text-center">
            AI 教练将完整分析你的攀爬动作，找出需要改进的关键时刻
          </p>
          <label className="w-full cursor-pointer group">
            <div className="border-2 border-dashed border-slate-700 hover:border-orange-500/50 rounded-2xl p-10 text-center transition-all">
              <Upload className="mx-auto mb-4 text-slate-500 group-hover:text-orange-400" size={40} />
              <p className="text-slate-400 text-sm mb-1">点击选择视频文件</p>
              <p className="text-xs text-slate-600">支持 MP4, MOV, WebM</p>
            </div>
            <input type="file" accept="video/mp4,video/quicktime,video/webm" onChange={handleFileSelect} className="hidden" />
          </label>
        </motion.div>
      )}

      {/* ═══════════ 视频（选文件后始终渲染） ─────── */}
      {videoFile && (
        <div className="w-full px-4 pt-4">
          <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-slate-800">
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              onLoadedMetadata={handleMetadata}
              onTimeUpdate={handleTimeUpdate}
              className="w-full aspect-video object-contain bg-black"
              playsInline
              controls={phase === 'done' || phase === 'idle'}
              onClick={phase === 'done' ? togglePlay : undefined}
            />
            {/* BBox 叠加层 */}
            <canvas
              ref={bboxOverlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {/* 分析中覆盖层 */}
            {phase !== 'done' && phase !== 'idle' && phase !== 'error' && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-12 h-12 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-orange-400 font-bold">{statusText}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ 已选文件 + 开始按钮 ────────── */}
      {phase === 'idle' && videoFile && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 w-full max-w-md pt-4"
        >
          <div className="w-full bg-slate-900 rounded-2xl p-4 border border-slate-800">
            <p className="text-sm text-slate-300 truncate">{videoFile.name}</p>
            <p className="text-xs text-slate-500 mt-1">
              {(videoFile.size / 1024 / 1024).toFixed(1)} MB
              {videoDuration > 0 && ` · ${Math.floor(videoDuration)}秒`}
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={resetAll}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 h-14 rounded-2xl font-bold transition-all"
            >
              重新选择
            </button>
            <button
              onClick={startAnalysis}
              className="flex-[2] bg-green-600 hover:bg-green-500 text-white h-14 rounded-2xl flex items-center justify-center gap-2 font-bold text-lg transition-all active:scale-95"
            >
              <Play className="w-5 h-5 fill-current" /> 开始 AI 分析
            </button>
          </div>
        </motion.div>
      )}

      {/* ═══════════ 进度条 ───────────────────── */}
      {(phase === 'extracting' || phase === 'submitting' || phase === 'analyzing') && (
        <div className="w-full max-w-md px-4 mt-4">
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
            <div className="w-full bg-slate-800 rounded-full h-3 mb-3 overflow-hidden">
              <div
                className="bg-orange-500 h-full rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {phase === 'analyzing' ? (
                  <Radio className="w-4 h-4 text-orange-400 animate-pulse" />
                ) : (
                  <Activity className="w-4 h-4 text-slate-400" />
                )}
                <span className="text-sm text-slate-400">{statusText}</span>
              </div>
              <span className="text-xs text-slate-600">{progress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ 结果展示 ───────────────────── */}
      {phase === 'done' && result && (
        <div className="w-full max-w-md px-4 mt-3 mb-8 space-y-3">

          {/* ─── ① 阶段时序控制条（PhaseTrack）紧贴视频 ── */}
          {result.phases?.length > 0 && videoDuration > 0 && (
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
              <h3 className="text-xs font-bold text-slate-400 mb-3">阶段时序</h3>
              <div className="relative w-full h-10 bg-slate-800 rounded-full overflow-hidden">
                {result.phases.map((ph, pi) => {
                  const left = (ph.time_range[0] / videoDuration) * 100;
                  const width = ((ph.time_range[1] - ph.time_range[0]) / videoDuration) * 100;
                  const barColor = ph.status === 'good' ? 'bg-green-500/50' :
                    ph.status === 'warning' ? 'bg-amber-500/50' : 'bg-red-500/50';
                  const isActive = ph.phase_name === selectedPhase;
                  return (
                    <button
                      key={pi}
                      onClick={() => jumpToPhase(ph.time_range[0], ph.phase_name)}
                      className={`absolute top-0 h-full ${barColor} cursor-pointer transition-all duration-300
                                 ${isActive ? 'opacity-100 ring-2 ring-white/30 scale-y-110 z-10' : 'opacity-50 hover:opacity-80'}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${ph.phase_name}: ${ph.summary}`}
                    >
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-lg">
                        {ph.phase_name}
                      </span>
                    </button>
                  );
                })}
                {/* 播放进度游标 */}
                <div
                  className="absolute top-0 w-1 h-full bg-white/70 z-20 transition-all duration-200 pointer-events-none"
                  style={{ left: `${(currentTime / videoDuration) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* ─── ② 缺陷时间轴 + 工具栏 ──────────── */}
          {issues.length > 0 && (
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-400">
                  时间戳 {selectedPhase && result?.phases?.find(p => p.phase_name === selectedPhase)
                    ? `（${result.phases.find(p => p.phase_name === selectedPhase)?.time_range[0].toFixed(1)}s-${result.phases.find(p => p.phase_name === selectedPhase)?.time_range[1].toFixed(1)}s）`
                    : `（${issues.length}个标记）`}
                </h3>
                <div className="flex items-center gap-2">
                  {selectedPhase && (
                    <button
                      onClick={() => { setSelectedPhase(null); setActiveIssue(null); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300 underline"
                    >
                      显示全部
                    </button>
                  )}
                  <button
                    onClick={openReport}
                    className="text-xs text-orange-400 hover:text-orange-300 font-bold flex items-center gap-1"
                  >
                    <Maximize2 className="w-3 h-3" /> 完整报告
                  </button>
                </div>
              </div>
              {/* 时间轴圆点 */}
              <div className="relative w-full h-6 bg-slate-800 rounded-full overflow-hidden mt-1">
                {issues.map((issue, i) => {
                  const left = (issue.timestamp / videoDuration) * 100;
                  const color = issue.severity === 'high' ? 'bg-red-500' :
                                issue.severity === 'mid' ? 'bg-amber-500' : 'bg-yellow-500';
                  // 检查是否在当前选中阶段内
                  const inPhase = !selectedPhase || !result?.phases
                    ? true
                    : (() => {
                        const p = result.phases?.find(pp => pp.phase_name === selectedPhase);
                        return p ? (issue.timestamp >= p.time_range[0] && issue.timestamp <= p.time_range[1]) : true;
                      })();
                  return (
                    <button
                      key={i}
                      onClick={() => jumpToTimestamp(issue.timestamp)}
                      className={`absolute top-1 w-4 h-4 rounded-full ${color} border-2 border-slate-900
                                 transition-all cursor-pointer z-10
                                 ${activeIssue === i ? 'ring-2 ring-white scale-125 z-20' : ''}
                                 ${inPhase && selectedPhase ? '' : !selectedPhase ? '' : 'opacity-20 scale-75'}`}
                      style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
                      title={`${issue.issue_type} @ ${issue.timestamp.toFixed(1)}s`}
                    />
                  );
                })}
                {/* 播放进度游标 */}
                <div
                  className="absolute top-0 w-0.5 h-full bg-white/80 z-20 transition-all duration-200 pointer-events-none"
                  style={{ left: `${(currentTime / videoDuration) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* ─── ③ 宏观回顾：总评 + 全流程叙事 ──────── */}
          {result.climb_result && (
            <div className={`rounded-2xl p-4 border text-center
              ${result.climb_result === 'SUCCESS'
                ? 'bg-green-500/10 border-green-500/40 text-green-400'
                : result.climb_result === 'FAIL'
                  ? 'bg-red-500/10 border-red-500/40 text-red-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              <p className="text-3xl font-black flex items-center justify-center gap-3">
                {result.climb_result === 'SUCCESS' ? '🏁 完攀' :
                 result.climb_result === 'FAIL' ? '💀 坠落' : '🤷 主动下墙'}
                {result.top_hand_match_status && (
                  <span className="text-sm font-normal">
                    {result.top_hand_match_status === 'perfect_match'
                      ? '🟢 干净合分'
                      : result.top_hand_match_status === 'struggling_match'
                        ? '🟡 勉强合分'
                        : '🔴 未合分'}
                  </span>
                )}
              </p>
              {result.end_game_reason && (
                <p className="text-xs mt-1 opacity-70">{result.end_game_reason}</p>
              )}
            </div>
          )}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-14 h-14 rounded-full bg-orange-600/20 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-orange-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <p className="text-3xl font-black text-white">
                    {result.overall_score}
                    <span className="text-base font-normal text-slate-500">/100</span>
                  </p>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">AI 综合评分</p>
              </div>
            </div>
            {/* ⬆ 顶端控制仪表盘 */}
            {result.top_control_score != null && (
              <div className="mb-4 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">⬆ 顶端控制分</span>
                  <span className={`text-sm font-bold ${
                    result.top_control_score >= 70 ? 'text-emerald-400'
                    : result.top_control_score >= 40 ? 'text-amber-400'
                    : 'text-red-400'
                  }`}>{result.top_control_score}/100</span>
                </div>
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      result.top_control_score >= 70 ? 'bg-emerald-500'
                      : result.top_control_score >= 40 ? 'bg-amber-500'
                      : 'bg-red-500'
                    }`}
                    style={{ width: `${result.top_control_score}%` }}
                  />
                </div>
              </div>
            )}



            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              {result.summary}
            </p>

            {result.sequence_analysis && (
              <div className="bg-slate-800/50 rounded-xl p-4 border-l-2 border-orange-500/50">
                <h4 className="text-xs font-bold text-orange-400 flex items-center gap-1 mb-2">
                  <Activity className="w-3 h-3" /> 动作全流程回顾
                </h4>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {result.sequence_analysis}
                </p>
              </div>
            )}
          </div>

          {/* ─── ④ 动态问题卡片（按阶段过滤） ──────── */}
          {filteredIssues.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                {selectedPhase
                  ? `${selectedPhase} · ${filteredIssues.length}个问题`
                  : `发现 ${issues.length} 个关键问题`}
              </h3>
              {filteredIssues.map((issue, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  onClick={() => jumpToTimestamp(issue.timestamp)}
                  className={`w-full text-left bg-slate-900 border rounded-2xl p-4 transition-all
                             ${activeIssue === issues.findIndex(it => it.timestamp === issue.timestamp)
                               ? 'border-orange-500/50 bg-slate-800 ring-1 ring-orange-500/30'
                               : 'border-slate-800 hover:border-slate-700'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase
                          ${issue.severity === 'high' ? 'bg-red-900/40 text-red-300' :
                            issue.severity === 'mid' ? 'bg-amber-900/40 text-amber-300' :
                            'bg-yellow-900/40 text-yellow-300'}`}>
                          {issue.severity}
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          {issue.timestamp.toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-sm font-bold text-white">{issue.issue_type}</p>
                      <p className="text-xs text-slate-400 mt-1">{issue.suggestion}</p>
                      {issue.correction_keywords && issue.correction_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {issue.correction_keywords.map((kw, j) => (
                            <span key={j} className="px-2 py-0.5 bg-slate-800 rounded-full text-[10px] text-slate-400">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 mt-1 shrink-0" />
                  </div>
                </motion.button>
              ))}
            </div>
          )}

          {/* ─── ⑤ 阶段卡片 + 色彩进度条（第二次出现，但现在是上下文） ── */}
          {result.phases?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-sky-400 flex items-center gap-1 mb-3">
                <ListChecks className="w-3 h-3" /> 攀爬阶段评估
              </h4>
              <div className="space-y-2">
                {result.phases.map((ph, pi) => {
                  const statusColor = ph.status === 'good' ? 'border-l-green-500' :
                    ph.status === 'warning' ? 'border-l-amber-500' : 'border-l-red-500';
                  const statusBg = ph.status === 'good' ? 'bg-green-900/30 text-green-300' :
                    ph.status === 'warning' ? 'bg-amber-900/30 text-amber-300' : 'bg-red-900/30 text-red-300';
                  const statusLabel = ph.status === 'good' ? '良好' :
                    ph.status === 'warning' ? '关注' : '严重';
                  const isActive = ph.phase_name === selectedPhase;
                  return (
                    <button
                      key={pi}
                      onClick={() => {
                        if (selectedPhase === ph.phase_name) {
                          setSelectedPhase(null);
                        } else {
                          jumpToPhase(ph.time_range[0], ph.phase_name);
                        }
                      }}
                      className={`w-full text-left rounded-lg p-3 border-l-4 ${statusColor} transition-all
                                 ${isActive ? 'bg-slate-700/70 ring-1 ring-white/20' : 'bg-slate-800/50 hover:bg-slate-700/50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-white">{ph.phase_name}</span>
                        <span className="text-xs font-mono text-slate-500">
                          {ph.time_range[0].toFixed(1)}s - {ph.time_range[1].toFixed(1)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${statusBg}`}>
                          {statusLabel}
                        </span>
                        <span className="text-xs text-slate-300">{ph.summary}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── ⑥ 做得好的 / 需要改进 / 建议 ──────── */}
          {result.strengths?.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <h4 className="text-xs font-bold text-green-400 flex items-center gap-1 mb-2">
                <TrendingUp className="w-3 h-3" /> 做得好的
              </h4>
              <ul className="space-y-1">
                {result.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-slate-400 pl-3 border-l-2 border-green-500/30">{s}</li>
                ))}
              </ul>
              {result.weaknesses?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <h4 className="text-xs font-bold text-red-400 flex items-center gap-1 mb-2">
                    <ListChecks className="w-3 h-3" /> 需要改进
                  </h4>
                  <ul className="space-y-1">
                    {result.weaknesses.map((w, i) => (
                      <li key={i} className="text-xs text-slate-400 pl-3 border-l-2 border-red-500/30">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.improvements?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <h4 className="text-xs font-bold text-blue-400 flex items-center gap-1 mb-2">
                    <ChevronRight className="w-3 h-3" /> 改进建议
                  </h4>
                  <ul className="space-y-1">
                    {result.improvements.map((imp, i) => (
                      <li key={i} className="text-xs text-slate-400 pl-3 border-l-2 border-blue-500/30">{imp}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ─── ⑦ 重新分析 ───────────────────── */}
          <button
            onClick={resetAll}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-4 rounded-2xl font-bold transition-all"
          >
            分析其他视频
          </button>
        </div>
      )}

      {/* ═══════════ 错误 ───────────────────────── */}
      {phase === 'error' && errorText && (
        <div className="w-full max-w-md px-4 mt-4">
          <div className="bg-red-900/40 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl text-sm mb-4">
            {errorText}
          </div>
          <button
            onClick={resetAll}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold transition-all"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
