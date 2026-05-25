import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Upload, Play, Square, FileVideo, Radio, Activity,
  AlertTriangle, ChevronRight, Sparkles, TrendingUp, ListChecks,
  Maximize2, Minimize2
} from 'lucide-react';
import {
  ExtractedFrame, TimestampedIssue, VideoAnalysisResult,
  FRAME_CONFIG
} from '../types';

/** 异步 API 轮询间隔 */
const POLL_INTERVAL = 3000;

/** 默认帧数 */
const FRAME_COUNT = 20;

export function VideoAnalysis() {
  // ── 文件 & 播放 ──
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── 分析流程 ──
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'submitting' | 'analyzing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  // ── 分析结果 ──
  const [result, setResult] = useState<VideoAnalysisResult | null>(null);
  const [issues, setIssues] = useState<TimestampedIssue[]>([]);
  const [activeIssue, setActiveIssue] = useState<number | null>(null);

  // ── Ref ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const extractCanvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<number | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const framesRef = useRef<ExtractedFrame[]>([]);

  // 清理
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [videoUrl]);

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
  }, [videoUrl]);

  // ── 开始抽帧 → 异步分析 ──
  const startAnalysis = useCallback(async () => {
    const video = videoRef.current;
    const canvas = extractCanvasRef.current;
    if (!video || !canvas || !videoDuration) return;

    setPhase('extracting');
    setErrorText(null);
    setStatusText('正在提取关键帧...');
    setProgress(5);

    // 1. 计算抽帧间隔
    const interval = videoDuration / FRAME_COUNT;
    const extracted: ExtractedFrame[] = [];
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { WIDTH, HEIGHT, QUALITY } = FRAME_CONFIG;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    // 2. 逐帧抽取
    video.pause();
    for (let i = 0; i < FRAME_COUNT; i++) {
      const targetTime = i * interval;
      video.currentTime = targetTime;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          // 等一帧让 canvas 渲染
          requestAnimationFrame(() => {
            ctx!.drawImage(video, 0, 0, WIDTH, HEIGHT);
            const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
            const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
            extracted.push({ base64, timestamp: targetTime });

            setProgress(5 + Math.round((i + 1) / FRAME_COUNT * 40));
            resolve();
          });
        };
        video.addEventListener('seeked', onSeeked);
      });
    }

    framesRef.current = extracted;

    // 3. 提交异步分析
    setPhase('submitting');
    setStatusText('正在提交给 AI 分析...');

    // 构建带时间戳的 prompt
    const timestamps = extracted.map((f, i) =>
      `第${i + 1}张：${f.timestamp.toFixed(1)}秒`
    ).join('\n');

    const prompt = `你是一位专业抱石教练。下面有${FRAME_COUNT}张按时间顺序排列的攀爬动作截图：

${timestamps}

请分析整段动作，找出动作变形最严重或存在受伤风险的时刻。

### 输出要求
- 只在有问题的时间点输出，没问题就不输出
- 用我提供的时间戳（秒）标明问题位置
- 如果某个问题部位在画面中可见，给出像素坐标框 bbox
- 建议不超过 50 字

### 输出 JSON 格式
{
  "issues": [
    {
      "timestamp": 0.0,
      "issue_type": "膝盖内扣",
      "severity": "high",
      "bbox": [ymin, xmin, ymax, xmax],
      "suggestion": "外旋髋关节使膝盖朝前",
      "correction_keywords": ["外旋髋关节", "降重心"]
    }
  ],
  "overall_score": 75,
  "summary": "整体动作评估（50字以内）",
  "strengths": ["做得好的1", "做得好的2"],
  "weaknesses": ["主要问题1", "主要问题2"],
  "improvements": ["改进建议1", "改进建议2"]
}

请只返回 JSON，不要包含其他文字。`;

    try {
      const res = await fetch('/api/analyze-async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: extracted,
          prompt,
          model: 'glm-5v-turbo',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `提交失败 HTTP ${res.status}`);
      }

      const { taskId } = await res.json();
      taskIdRef.current = taskId;

      // 4. 开始轮询
      setPhase('analyzing');
      setStatusText('AI 教练正在分析动作...');
      setProgress(50);

      pollRef.current = window.setInterval(async () => {
        if (!taskIdRef.current) return;

        try {
          const pollRes = await fetch(`/api/query-result?taskId=${taskIdRef.current}`);
          if (!pollRes.ok) {
            const err = await pollRes.json().catch(() => ({}));
            throw new Error(err.error || `轮询失败 HTTP ${pollRes.status}`);
          }

          const data = await pollRes.json();

          if (data.status === 'SUCCESS') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            const analysisResult = data.result as VideoAnalysisResult;
            setResult(analysisResult);
            setIssues(analysisResult.issues || []);
            setProgress(100);
            setPhase('done');
            setStatusText('分析完成');

            // 自动播放视频
            video.play();
            setIsPlaying(true);

          } else if (data.status === 'FAIL') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            throw new Error(data.error || 'AI 分析失败，请重试');
          }
          // PROCESSING → 继续等
        } catch (err) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setPhase('error');
          setErrorText(err instanceof Error ? err.message : '轮询失败');
        }
      }, POLL_INTERVAL);

    } catch (err) {
      setPhase('error');
      setErrorText(err instanceof Error ? err.message : '提交失败');
    }
  }, [videoDuration]);

  // ── 视频元数据加载 ──
  const handleMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) setVideoDuration(video.duration);
  }, []);

  // ── 时间戳跳转 ──
  const jumpToTimestamp = useCallback((ts: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ts;
    video.play();
    setIsPlaying(true);
    setActiveIssue(issues.findIndex(i => i.timestamp === ts));
  }, [issues]);

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
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
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
  }, [videoUrl]);

  // ── 渲染：问题标记条 ──
  const renderTimeline = () => {
    if (!videoDuration || issues.length === 0) return null;

    return (
      <div className="relative w-full h-6 bg-slate-800 rounded-full overflow-hidden mt-3">
        {/* 时间轴背景 */}
        {issues.map((issue, i) => {
          const left = (issue.timestamp / videoDuration) * 100;
          const color = issue.severity === 'high' ? 'bg-red-500' :
                        issue.severity === 'mid' ? 'bg-amber-500' : 'bg-yellow-500';
          return (
            <button
              key={i}
              onClick={() => jumpToTimestamp(issue.timestamp)}
              className={`absolute top-1 w-4 h-4 rounded-full ${color} border-2 border-slate-900 
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
    <div className="flex flex-col items-center h-full overflow-y-auto">
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

      {/* ═══════════ 视频 + 预览 ─────────────────── */}
      {videoFile && phase !== 'idle' && (
        <div className="w-full px-4 pt-4">
          <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-slate-800">
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              onLoadedMetadata={handleMetadata}
              className="w-full aspect-video object-contain bg-black"
              playsInline
              controls={phase === 'done'}
              onClick={phase === 'done' ? togglePlay : undefined}
            />
            {/* 分析中覆盖层 */}
            {phase !== 'done' && phase !== 'error' && (
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
          className="flex flex-col items-center gap-4 w-full max-w-md pt-6"
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

      {/* ═══════════ 进度条（抽取中/提交中/分析中） ── */}
      {(phase === 'extracting' || phase === 'submitting' || phase === 'analyzing') && (
        <div className="w-full max-w-md px-4 mt-6">
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800">
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
        <div className="w-full max-w-md px-4 mt-4 mb-8 space-y-4">
          {/* 时间轴 */}
          {renderTimeline()}

          {/* 问题卡片列表 */}
          {issues.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                发现 {issues.length} 个关键问题
              </h3>
              {issues.map((issue, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => jumpToTimestamp(issue.timestamp)}
                  className={`w-full text-left bg-slate-900 border rounded-2xl p-4 transition-all
                             ${activeIssue === i
                               ? 'border-orange-500/50 bg-slate-800'
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

          {/* 评分 & 总结 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-600/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-black text-white">
                  {result.overall_score}
                  <span className="text-sm font-normal text-slate-500">/100</span>
                </p>
                <p className="text-xs text-slate-500">AI 综合评分</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              {result.summary}
            </p>

            {result.strengths?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-bold text-green-400 flex items-center gap-1 mb-2">
                  <TrendingUp className="w-3 h-3" /> 做得好的
                </h4>
                <ul className="space-y-1">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-slate-400 pl-3 border-l-2 border-green-500/30">{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.weaknesses?.length > 0 && (
              <div className="mt-4">
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
              <div className="mt-4">
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

          {/* 重新分析按钮 */}
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
        <div className="w-full max-w-md px-4 mt-6">
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
