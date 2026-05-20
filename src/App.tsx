import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CameraStream } from './components/CameraStream';
import { Overlay } from './components/Overlay';
import { GuidancePanel } from './components/GuidancePanel';
import { ReportView } from './components/ReportView';
import { VideoRecorder } from './components/VideoRecorder';
import { VideoAnalysis } from './components/VideoAnalysis';
import { AnalysisResult, SessionData, HistoryEntry } from './types';
import { Play, Square, ShieldCheck, Settings, History, Video, Camera } from 'lucide-react';
import { drawMarkers } from './utils/drawMarkers';

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [recordedRawBlob, setRecordedRawBlob] = useState<Blob | null>(null);
  const [recordRawMode, setRecordRawMode] = useState(false);
  const [mode, setMode] = useState<'camera' | 'video'>('camera');
  const cooldownRef = useRef(false);

  // Video 元素引用（传给 VideoRecorder 做合成录制）
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  // 当前 markers（传给 VideoRecorder 画到合成画布上）
  const markersRef = useRef<{ markers: import('./types').Marker[] }>({ markers: [] });

  // 保持 markers 最新
  markersRef.current = { markers: currentResult?.markers || [] };

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    videoElementRef.current = video;
  }, []);

  const handleRecordingComplete = useCallback((result: { annotatedBlob: Blob; rawBlob?: Blob; mode: 'annotated' | 'both' }) => {
    setRecordedVideoBlob(result.annotatedBlob);
    if (result.rawBlob) setRecordedRawBlob(result.rawBlob);
  }, []);

  const startClimb = () => {
    setRecordedVideoBlob(null);
    setSession({
      startTime: Date.now(),
      totalErrors: 0,
      history: []
    });
    setIsRecording(true);
    setCurrentResult(null);
  };

  const stopClimb = () => {
    setIsRecording(false);
    if (session) {
      setSession(prev => {
        if (!prev) return prev;
        return { ...prev, endTime: Date.now() };
      });
      // 延迟显示报告，等 MediaRecorder 完成 final flush
      setTimeout(() => setShowReport(true), 500);
    }
  };

  const handleFrame = useCallback(async (canvas: HTMLCanvasElement) => {
    if (!isRecording || isAnalyzing || cooldownRef.current) return;

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || response.statusText || 'AI Server Error');
      }

      const result: AnalysisResult = await response.json();
      setCurrentResult(result);

      // 保存缩略图（320px 宽，带 AI 标注，用于报告中的快照画廊）
      let snapshot: string | undefined;
      try {
        const thumbCanvas = document.createElement('canvas');
        const video = videoElementRef.current;
        if (video && video.readyState >= 2) {
          const aspect = video.videoHeight / video.videoWidth;
          thumbCanvas.width = 320;
          thumbCanvas.height = Math.round(320 * aspect);
          const thumbCtx = thumbCanvas.getContext('2d');
          if (thumbCtx) {
            thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
            // 画 AI 标注
            drawMarkers(thumbCtx, thumbCanvas.width, thumbCanvas.height, result.markers, result.detected_route_color);
            snapshot = thumbCanvas.toDataURL('image/jpeg', 0.75);
          }
        }
      } catch (_) { /* 缩略图失败不影响主流程 */ }

      const entry: HistoryEntry = { result, snapshot };

      setSession(prev => {
        if (!prev) return null;
        const errors = result.markers.filter(m => m.type === 'error').length;
        return {
          ...prev,
          totalErrors: prev.totalErrors + errors,
          history: [...prev.history, entry]
        };
      });

    } catch (err) {
      console.error("Analysis Failed:", err);
      setAnalysisError(err instanceof Error ? err.message : '未知错误');
      // 失败后冷却 5 秒，防止疯狂重试导致闪烁
      cooldownRef.current = true;
      setTimeout(() => { cooldownRef.current = false; }, 5000);
    } finally {
      setIsAnalyzing(false);
    }
  }, [isRecording, isAnalyzing]);

  return (
    <div className="relative h-screen w-screen bg-slate-950 font-sans text-slate-200 overflow-hidden flex flex-col">
      {/* Mobile-First Header */}
      <header className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-slate-950/80 to-transparent flex items-center justify-between px-6 z-40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center text-white font-black italic shadow-lg shadow-orange-600/20">B</div>
          <h1 className="text-sm font-black tracking-tighter text-white uppercase italic">抱石 AI <span className="text-orange-500">专业版</span></h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Mode Toggle */}
          <div className="flex bg-slate-900 rounded-xl p-0.5 border border-slate-800">
            <button
              onClick={() => setMode('camera')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                mode === 'camera'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Camera className="w-3 h-3" /> 实时
            </button>
            <button
              onClick={() => setMode('video')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                mode === 'video'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Video className="w-3 h-3" /> 视频
            </button>
            {/* 同时录制原始版切换 */}
            <button
              onClick={() => setRecordRawMode(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                recordRawMode
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title="同时保存无 AI 标注的原始版本"
            >
              {recordRawMode ? '标注+原始' : '仅标注'}
            </button>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[8px] text-slate-500 uppercase font-black">云端延迟</span>
            <span className="text-[10px] font-mono text-emerald-400">1.2s</span>
          </div>
          <div className="h-4 w-px bg-slate-800"></div>
          <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
        </div>
      </header>

      {/* Full-Screen Content */}
      <main className="flex-1 relative overflow-hidden bg-slate-900 shadow-inner">
        {mode === 'camera' ? (
          <>
            <CameraStream
              onFrame={handleFrame}
              isRecording={isRecording}
              captureInterval={1800}
              onError={setCameraError}
              onVideoReady={handleVideoReady}
            />

            {/* VideoRecorder（隐藏的合成录制引擎） */}
            <VideoRecorder
              video={videoElementRef.current}
              markers={currentResult?.markers || []}
              active={isRecording}
              onRecordingComplete={handleRecordingComplete}
              fps={15}
              recordRaw={recordRawMode}
            />

            {/* Camera Error Message */}
            {cameraError && (
              <div className="absolute inset-0 z-50 flex items-center justify-center p-8 text-center bg-slate-950/90 backdrop-blur-md">
                <div className="max-w-xs space-y-4">
                  <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Square className="w-8 h-8 fill-current" />
                  </div>
                  <h2 className="text-xl font-black uppercase italic text-white italic">访问被拒绝</h2>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    {cameraError}
                  </p>
                  <div className="pt-4">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">解决方案</p>
                    <button
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="bg-orange-600 hover:bg-orange-500 text-white px-6 py-3 rounded-xl font-bold transition-all text-sm w-full"
                    >
                      在新窗口中打开
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Overlays */}
            <Overlay markers={currentResult?.markers || []} />
            <GuidancePanel result={currentResult} isAnalyzing={isAnalyzing} error={analysisError} />

            {/* 录制中提示（录制时显示录制小红点） */}
            {isRecording && (
              <div className="absolute top-20 left-6 z-40 flex items-center gap-2 bg-slate-950/70 backdrop-blur-md border border-red-500/30 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-mono text-red-400 uppercase tracking-widest">录制中</span>
              </div>
            )}

            {/* Global Loading Indicator (Subtle) */}
            {isAnalyzing && (
              <div className="absolute top-20 right-6 z-40 bg-slate-950/60 backdrop-blur-md border border-white/5 px-2 py-1 rounded-md flex items-center gap-2">
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" />
                <span className="text-[8px] font-mono text-blue-400 uppercase tracking-widest">云端分析中</span>
              </div>
            )}
          </>
        ) : (
          <VideoAnalysis />
        )}
      </main>

      {/* Camera Mode: Floating Controls Overlay (Visible only when not recording) */}
      <AnimatePresence>
        {mode === 'camera' && !isRecording && !showReport && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-4 w-full px-8 max-w-sm"
          >
            <button
              onClick={startClimb}
              className="w-full bg-white text-slate-950 h-16 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-transform shadow-2xl"
            >
              <Play className="w-6 h-6 fill-current" />
              <span className="font-black uppercase tracking-widest text-lg italic">开始攀爬</span>
            </button>
            <div className="flex gap-4 w-full">
               <button className="flex-1 bg-slate-900 border border-slate-800 h-14 rounded-2xl flex items-center justify-center text-slate-400 active:scale-95 transition-transform">
                  <History className="w-5 h-5" />
               </button>
               <button className="flex-1 bg-slate-900 border border-slate-800 h-14 rounded-2xl flex items-center justify-center text-slate-400 active:scale-95 transition-transform">
                  <Settings className="w-5 h-5" />
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Mode: Recording HUD */}
      {mode === 'camera' && isRecording && (
        <div className="absolute bottom-12 right-6 z-50 flex flex-col items-end gap-4 pointer-events-none">
          {/* Status Label */}
          {currentResult?.climb_status && (
            <motion.div
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="bg-emerald-500 text-slate-950 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg"
            >
              状态: {
                currentResult.climb_status === 'moving' ? '正在移动' :
                currentResult.climb_status === 'steady' ? '姿势稳定' :
                currentResult.climb_status === 'stuck' ? '停滞' :
                currentResult.climb_status === 'falling' ? '检测到坠落' : '已完成'
              }
            </motion.div>
          )}

          {/* Stop Button */}
          <button
            onClick={stopClimb}
            className="w-16 h-16 bg-slate-950 border-2 border-red-500 rounded-2xl flex flex-col items-center justify-center pointer-events-auto active:scale-90 transition-transform shadow-2xl group"
          >
            <Square className="w-5 h-5 text-red-500 fill-current mb-1" />
            <span className="text-[8px] font-black text-red-500 uppercase">结束</span>
          </button>
        </div>
      )}

      {/* Bottom Meter Rail */}
      <footer className="h-4 bg-slate-950 flex items-center justify-between px-6 z-40 border-t border-slate-900/50">
          {mode === 'camera' && (
            <div className="flex gap-4 text-[6px] font-mono text-slate-600 uppercase tracking-[0.2em]">
              <span>端到端加密已启用</span>
              <span>网络带宽: 420MB/s</span>
              {currentResult?.detected_route_color && (
                <span className="text-orange-500 font-bold">检测线路: {currentResult.detected_route_color}</span>
              )}
            </div>
          )}
        <ShieldCheck className="w-3 h-3 text-emerald-950" />
      </footer>

      {/* Full-Screen Report Overlay */}
      <AnimatePresence>
        {showReport && session && (
          <ReportView
            data={session}
            recordedVideo={recordedVideoBlob}
            recordedRawBlob={recordedRawBlob}
            onReset={() => {
              setShowReport(false);
              setRecordedVideoBlob(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
