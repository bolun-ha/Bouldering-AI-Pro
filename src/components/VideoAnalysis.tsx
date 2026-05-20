import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Upload, Play, Square, FileVideo, Radio, Activity } from 'lucide-react';
import { AnalysisResult, SessionData, HistoryEntry, ReportData } from '../types';
import { ReportView } from './ReportView';

/**
 * 本地像素对比 — 检测视频帧是否发生明显变化
 * 在前端过滤静止画面，减少 API 调用，规避限流
 */
function pixelDiffPercent(current: Uint8ClampedArray, previous: Uint8ClampedArray): number {
  if (previous.length === 0) return 100; // 第一帧，肯定变化
  let changed = 0;
  const total = current.length;
  // 每隔 16 个字节采样一次（跳过 3/4 像素，兼顾性能）
  for (let i = 0; i < total; i += 16) {
    const r = Math.abs(current[i] - previous[i]);
    const g = Math.abs(current[i + 1] - previous[i + 1]);
    const b = Math.abs(current[i + 2] - previous[i + 2]);
    if (r + g + b > 80) changed++;
  }
  return (changed / (total / 16)) * 100;
}

export function VideoAnalysis() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [skipCount, setSkipCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'analyzing'>('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);       // 640x360 截帧
  const compareCanvasRef = useRef<HTMLCanvasElement>(null); // 160x90 像素对比
  const sessionRef = useRef<SessionData | null>(null);
  const isAnalyzingRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const frameCounterRef = useRef(0);
  const skipCounterRef = useRef(0);
  const prevPixelRef = useRef<Uint8ClampedArray | null>(null);
  const lastApiCallRef = useRef(0);

  sessionRef.current = sessionData;

  // 清理 URL 对象
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);

    const url = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoUrl(url);
    setShowReport(false);
    setSessionData(null);
    setProgress(0);
    setFrameCount(0);
    setSkipCount(0);
    setError(null);
    prevPixelRef.current = null;
  }, [videoUrl]);

  const stopAnalysis = useCallback(() => {
    const video = videoRef.current;
    if (video) video.pause();
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setStatus('idle');
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const session = sessionRef.current;
    if (!session || session.history.length === 0) {
      setError('没有生成有效的分析数据');
      return;
    }

    (async () => {
      try {
        const dur = video ? Math.floor(video.currentTime) : Math.floor((Date.now() - session.startTime) / 1000);
        const response = await fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: session.history.map(h => ({
              climb_status: h.result.climb_status,
              detailed_feedback: h.result.detailed_feedback,
              instruction: h.result.instruction,
              detected_route_color: h.result.detected_route_color,
            })),
            totalErrors: session.totalErrors,
            duration: dur,
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || '报告生成失败');
        }

        const data = await response.json();
        const report: ReportData = {
          overallScore: data.overallScore ?? 0,
          summary: data.summary ?? '',
          strengths: data.strengths ?? [],
          weaknesses: data.weaknesses ?? [],
          improvements: data.improvements ?? [],
          trend: data.trend ?? '',
        };

        setProgress(100);
        setShowReport(true);
        setSessionData(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : '报告生成失败');
      }
    })();
  }, []);

  const startAnalysis = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const compareCanvas = compareCanvasRef.current;
    if (!video || !canvas || !compareCanvas) return;

    // 重置
    const newSession: SessionData = {
      startTime: Date.now(),
      totalErrors: 0,
      history: [],
    };
    setSessionData(newSession);
    sessionRef.current = newSession;
    frameCounterRef.current = 0;
    skipCounterRef.current = 0;
    prevPixelRef.current = null;
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setProgress(0);
    setFrameCount(0);
    setSkipCount(0);
    setError(null);
    setStatus('waiting');

    // 从头播放
    video.currentTime = 0;
    video.play();

    // 500ms 检查一次（比固定 3s 精细 6 倍 + 本地过滤 → 实际约 1-1.5 QPS）
    intervalRef.current = window.setInterval(async () => {
      if (!isAnalyzingRef.current || !video || !canvas || !compareCanvas) {
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }

      if (video.paused || video.ended) {
        stopAnalysis();
        return;
      }

      // --- 1. 像素对比：判断是否有明显动作变化 ---
      const compCtx = compareCanvas.getContext('2d');
      if (!compCtx) return;

      const cw = 160, ch = 90;
      compareCanvas.width = cw;
      compareCanvas.height = ch;
      compCtx.drawImage(video, 0, 0, cw, ch);
      const currentPixels = compCtx.getImageData(0, 0, cw, ch).data;

      const diff = pixelDiffPercent(currentPixels, prevPixelRef.current || new Uint8ClampedArray());
      prevPixelRef.current = new Uint8ClampedArray(currentPixels); // 存副本

      // 变化 < 4% → 跳过，不调用 API
      if (diff < 4) {
        skipCounterRef.current++;
        setSkipCount(skipCounterRef.current);
        setStatus('waiting');
        // 更新进度（基于视频实际时间）
        const dur = videoDuration || video.duration || 60;
        setProgress(Math.min(95, Math.round((video.currentTime / dur) * 100)));
        return;
      }

      // --- 2. 动作变化明显 → 截帧分析 ---
      setStatus('analyzing');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 640;
      canvas.height = 360;
      ctx.drawImage(video, 0, 0, 640, 360);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      frameCounterRef.current++;
      const frameNum = frameCounterRef.current;

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${response.status}`);
        }

        lastApiCallRef.current = Date.now();
        const result: AnalysisResult = await response.json();

        // 缩略图快照
        let snapshot: string | undefined;
        try {
          const thumbCanvas = document.createElement('canvas');
          if (video.readyState >= 2) {
            const aspect = video.videoHeight / video.videoWidth;
            thumbCanvas.width = 320;
            thumbCanvas.height = Math.round(320 * aspect);
            const thumbCtx = thumbCanvas.getContext('2d');
            if (thumbCtx) {
              thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
              snapshot = thumbCanvas.toDataURL('image/jpeg', 0.35);
            }
          }
        } catch (_) { /* 缩略图失败不影响 */ }

        const entry: HistoryEntry = { result, snapshot };
        const errors = result.markers.filter(m => m.type === 'error').length;

        setSessionData(prev => {
          if (!prev) return prev;
          return { ...prev, totalErrors: prev.totalErrors + errors, history: [...prev.history, entry] };
        });
        setFrameCount(frameNum);

        // 进度基于视频实际已播放时长
        const dur = videoDuration || video.duration || 60;
        setProgress(Math.min(95, Math.round((video.currentTime / dur) * 100)));
      } catch (err) {
        console.error('Frame analysis failed:', err);
        // 单帧失败继续
      }
    }, 500); // 检查间隔 500ms
  }, [stopAnalysis, videoDuration]);

  const handleMetadataLoaded = useCallback(() => {
    const video = videoRef.current;
    if (video) setVideoDuration(video.duration);
  }, []);

  const resetAll = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
    setStatus('idle');
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(null);
    setVideoUrl(null);
    setSessionData(null);
    setShowReport(false);
    setProgress(0);
    setError(null);
    prevPixelRef.current = null;
  }, [videoUrl]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
      {!videoFile && !showReport && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-6 w-full max-w-md"
        >
          <div className="w-20 h-20 bg-orange-600/20 rounded-3xl flex items-center justify-center">
            <FileVideo className="w-10 h-10 text-orange-500" />
          </div>
          <h2 className="text-xl font-black text-white text-center">上传攀爬视频</h2>
          <p className="text-sm text-slate-400 text-center">
            选择一段你在抱石墙上的攀爬视频，AI 会逐帧分析你的动作并生成训练报告
          </p>

          <label className="w-full cursor-pointer group">
            <div className="w-full border-2 border-dashed border-slate-700 hover:border-orange-500/50 rounded-2xl p-10 text-center transition-all group-active:scale-[0.98]">
              <Upload className="mx-auto mb-4 text-slate-500 group-hover:text-orange-400 transition-colors" size={40} />
              <p className="text-slate-400 text-sm mb-1">点击选择视频文件</p>
              <p className="text-xs text-slate-600">支持 MP4, MOV, WebM 格式</p>
            </div>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </motion.div>
      )}

      {/* 隐藏：视频源 + 分析画布 + 像素对比画布 */}
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        onLoadedMetadata={handleMetadataLoaded}
        style={{ display: 'none' }}
        playsInline
      />
      <canvas ref={canvasRef} width={640} height={360} style={{ display: 'none' }} />
      <canvas ref={compareCanvasRef} width={160} height={90} style={{ display: 'none' }} />

      {/* 已选视频 + 控制按钮 */}
      {videoFile && !isAnalyzing && !showReport && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 w-full max-w-md"
        >
          <div className="w-full bg-slate-900 rounded-2xl p-4 border border-slate-800">
            <p className="text-sm text-slate-300 truncate">{videoFile.name}</p>
            <p className="text-xs text-slate-500 mt-1">
              {(videoFile.size / 1024 / 1024).toFixed(1)} MB
              {videoDuration > 0 ? ` · ${Math.floor(videoDuration)}秒` : ''}
            </p>
          </div>

          <button
            onClick={startAnalysis}
            className="w-full bg-green-600 hover:bg-green-500 text-white h-14 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all font-bold text-lg"
          >
            <Play className="w-5 h-5 fill-current" /> 开始分析
          </button>

          <button
            onClick={resetAll}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
          >
            重新选择视频
          </button>
        </motion.div>
      )}

      {/* 分析中进度 */}
      {isAnalyzing && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4 w-full max-w-md"
        >
          <div className="w-full bg-slate-900 rounded-2xl p-6 border border-slate-800">
            {/* 进度条 */}
            <div className="w-full bg-slate-800 rounded-full h-3 mb-4 overflow-hidden">
              <div
                className="bg-orange-500 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>

            {/* 状态行 */}
            <div className="flex items-center justify-between text-xs mb-3">
              <div className="flex items-center gap-2">
                {status === 'waiting' ? (
                  <>
                    <Activity className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-500">动作检测中</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                    <span className="text-orange-400 font-bold">分析中</span>
                  </>
                )}
              </div>
              <span className="text-slate-500">{progress}%</span>
            </div>

            {/* 统计 */}
            <div className="flex justify-between text-xs text-slate-600">
              <span>已分析 {frameCount} 帧</span>
              {skipCount > 0 && <span>跳过 {skipCount} 帧（静止）</span>}
            </div>
          </div>

          <button
            onClick={stopAnalysis}
            className="bg-red-600 hover:bg-red-500 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 active:scale-95"
          >
            <Square className="w-5 h-5" /> 停止分析
          </button>
        </motion.div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-900/40 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl w-full max-w-md text-sm">
          {error}
        </div>
      )}

      {/* 报告 */}
      {showReport && sessionData && (
        <ReportView
          data={sessionData}
          recordedVideo={null}
          onReset={resetAll}
        />
      )}
    </div>
  );
}
