import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CameraStream } from './components/CameraStream';
import { Overlay } from './components/Overlay';
import { GuidancePanel } from './components/GuidancePanel';
import { ReportView } from './components/ReportView';
import { VideoRecorder } from './components/VideoRecorder';
import { VideoAnalysis } from './components/VideoAnalysis';
import { RouteGuideUploader } from './components/RouteGuide';
import { AnalysisResult, SessionData, HistoryEntry } from './types';
import { Play, Square, ShieldCheck, Settings, History, Video, Camera, ChevronRight } from 'lucide-react';
import { drawMarkers } from './utils/drawMarkers';
import { QRPopover } from './components/QRPopover';

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
  const [mode, setMode] = useState<'camera' | 'video'>('camera');
  const [videoSubMode, setVideoSubMode] = useState<'route' | 'analysis'>('route');
  const [cameraOn, setCameraOn] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const cooldownRef = useRef(false);

  // Video 元素引用（传给 VideoRecorder 做合成录制）
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  // 当前 markers（传给 VideoRecorder 画到合成画布上）
  const markersRef = useRef<{ markers: import('./types').Marker[] }>({ markers: [] });
  // 实时手部数据（供 hold 距离分析用）
  const handResultsRef = useRef<any[]>([]);

  // 保持 markers 最新
  markersRef.current = { markers: currentResult?.markers || [] };

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    videoElementRef.current = video;
  }, []);

  const handleRecordingComplete = useCallback((result: { annotatedBlob: Blob; rawBlob: Blob }) => {
    setRecordedVideoBlob(result.annotatedBlob);
    setRecordedRawBlob(result.rawBlob);
  }, []);

  const startClimb = () => {
    if (!cameraOn) {
      setCameraOn(true);
      // 摄像头打开后再开始录制，给 MediaPipe 一点初始化时间
      setTimeout(() => {
        setRecordedVideoBlob(null);
        setSession({
          startTime: Date.now(),
          totalErrors: 0,
          history: []
        });
        setIsRecording(true);
        setCurrentResult(null);
      }, 1500);
      return;
    }
    setRecordedVideoBlob(null);
    setSession({
      startTime: Date.now(),
      totalErrors: 0,
      history: []
    });
    setIsRecording(true);
    setCurrentResult(null);
  };

  // 首次访问自动弹出二维码
  useEffect(() => {
    const key = 'bouldering_qr_shown';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, '1');
      const t = setTimeout(() => setShowQR(true), 2000);
      return () => clearTimeout(t);
    }
  }, []);

  const stopClimb = () => {
    setIsRecording(false);
    if (session) {
      setSession(prev => {
        if (!prev) return prev;
        return { ...prev, endTime: Date.now() };
      });
      // 立即显示报告，不延迟
      setShowReport(true);
    }
  };

  const handleFrame = useCallback(async (canvas: HTMLCanvasElement, landmarksSnapshot: string = '', handSnapshot: string = '') => {
    if (!isRecording || isAnalyzing || cooldownRef.current) return;

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.98);

      const body: any = { image: dataUrl };
      if (landmarksSnapshot) body.pose = landmarksSnapshot;
      if (handSnapshot) body.hands = handSnapshot;

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || response.statusText || 'AI Server Error');
      }

      const result: AnalysisResult = await response.json();
      setCurrentResult(result);

      // ── 岩点-手部距离分析 ───────────────────────────────
      if (result.hold_positions && result.hold_positions.length > 0 && handResultsRef.current.length > 0) {
        try {
          const { computeHoldDistances } = await import('./utils/poseEngine');
          const video = videoElementRef.current;
          if (video) {
            const distances = computeHoldDistances(
              handResultsRef.current as any,
              result.hold_positions,
              video.videoWidth || 1280,
              video.videoHeight || 720,
            );
            // 添加未抓到岩点的标记
            const holdMarkers: import('./types').Marker[] = [];
            for (const d of distances) {
              if (!d.isOnHold && d.nearestHoldIdx >= 0) {
                const hold = result.hold_positions[d.nearestHoldIdx];
                holdMarkers.push({
                  x: d.handPos.x,
                  y: d.handPos.y,
                  type: 'warning',
                  label: `${d.hand === 'left' ? '左' : '右'}手未握住岩点`,
                  description: `${d.hand === 'left' ? '左' : '右'}手离最近${hold.color}岩点${d.distance.toFixed(0)}%，${d.grip.type}抓握。建议调整手位对准目标岩点。`,
                });
              }
              // 抓握类型建议
              if (d.isOnHold && d.grip.type === 'unknown') {
                holdMarkers.push({
                  x: d.handPos.x,
                  y: d.handPos.y,
                  type: 'info',
                  label: `${d.hand === 'left' ? '左' : '右'}手抓握异常`,
                  description: '未识别到标准抓握姿势，注意手指是否完全接触岩点。',
                });
              }
            }
            if (holdMarkers.length > 0) {
              setCurrentResult(prev => {
                if (!prev) return prev;
                return { ...prev, markers: [...prev.markers, ...holdMarkers] };
              });
            }
          }
        } catch (_) { /* hold 距离分析失败不影响主流程 */ }
      }

      // 保存缩略图（320px 宽，带 AI 标注，用于报告中的快照画廊）
      let snapshot: string | undefined;
      try {
        const thumbCanvas = document.createElement('canvas');
        const video = videoElementRef.current;
        if (video && video.readyState >= 2) {
          const aspect = video.videoHeight / video.videoWidth;
          thumbCanvas.width = 320;
          thumbCanvas.height = Math.round(320 * aspect);
          const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
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

  // MediaPipe 实时姿态标记
  const handlePoseMarkers = useCallback((markers: import('./types').Marker[], _landmarks: any, hands?: any[]) => {
    // 保存手部数据
    if (hands && hands.length > 0) {
      handResultsRef.current = hands;
    }
    if (markers.length === 0) return;
    setCurrentResult(prev => {
      if (!prev) {
        return {
          markers,
          instruction: '',
          detailed_feedback: '',
          detected_route_color: '',
          climb_status: 'moving',
        };
      }
      const ruleMarkers = markers.filter(m => m.type === 'error' || m.type === 'warning');
      const aiMarkers = prev.markers.filter(m => m.type === 'success' || m.type === 'info');
      const combined = [...ruleMarkers, ...aiMarkers];
      return { ...prev, markers: combined };
    });
  }, []);

  return (
    <>
      <QRPopover isOpen={showQR} onClose={() => setShowQR(false)} xiaohongshuQR="/xiaohongshu-qr.png" />
      <div className="relative h-screen w-screen bg-slate-950 font-sans text-slate-200 overflow-hidden flex flex-col">
      {/* Mobile-First Header — 精简一行 */}
      <header className="absolute top-0 inset-x-0 h-14 bg-gradient-to-b from-slate-950/80 to-transparent flex items-center justify-between px-4 z-40 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <button id="b-logo" onClick={() => setShowQR(true)} className="w-7 h-7 bg-orange-600 rounded-lg flex items-center justify-center text-white font-black italic shadow-lg shadow-orange-600/20 hover:bg-orange-500 active:scale-90 transition-all text-[10px]">B</button>
          <h1 className="text-[11px] font-black tracking-tighter text-white uppercase italic whitespace-nowrap">抱石 AI<span className="text-orange-500 ml-1">专业版</span></h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Toggle — 更紧凑 */}
          <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            <button
              onClick={() => setMode('camera')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                mode === 'camera'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Camera className="w-2.5 h-2.5" /> 实时
            </button>
            <button
              onClick={() => setMode('video')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                mode === 'video'
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Video className="w-2.5 h-2.5" /> 视频
            </button>
          </div>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
        </div>
      </header>

      {/* Full-Screen Content */}
      <main className="flex-1 relative overflow-hidden bg-slate-900 shadow-inner">
        {mode === 'camera' ? (
          <>
            {/* Camera off: show placeholder with start button */}
            {!cameraOn ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6">
                  <Camera className="w-10 h-10 text-slate-500" />
                </div>
                <h2 className="text-lg font-black text-white uppercase italic mb-2">准备攀爬</h2>
                <p className="text-sm text-slate-400 mb-8 text-center px-8">
                  开启摄像头后即可进行实时姿态检测<br />与 AI 攀爬分析
                </p>
                <button
                  onClick={() => {
                    setCameraOn(true);
                  }}
                  className="bg-orange-600 hover:bg-orange-500 text-white px-8 py-4 rounded-2xl font-bold text-base active:scale-95 transition-all shadow-2xl shadow-orange-600/20 flex items-center gap-3"
                >
                  <Camera className="w-5 h-5" />
                  开启摄像头
                </button>
              </div>
            ) : (
              <>
                <CameraStream
                  onFrame={handleFrame}
                  onPoseMarkers={handlePoseMarkers}
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
                />
              </>
            )}

            {/* Camera Error Message */}
            {cameraError && cameraOn && (
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
          <div className="w-full h-full flex flex-col">
            {/* Video Submode Tabs */}
            <div className="flex bg-slate-900 border-b border-slate-800">
              <button
                onClick={() => setVideoSubMode('route')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${
                  videoSubMode === 'route'
                    ? 'text-orange-400 border-b-2 border-orange-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                📷 图片路线分析
              </button>
              <button
                onClick={() => setVideoSubMode('analysis')}
                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all ${
                  videoSubMode === 'analysis'
                    ? 'text-orange-400 border-b-2 border-orange-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                🎬 视频分析
              </button>
            </div>
            {/* Content */}
            {videoSubMode === 'route' ? (
              <RouteGuideUploader />
            ) : (
              <VideoAnalysis />
            )}
          </div>
        )}
      </main>

      {/* Camera Mode: Floating Controls Overlay — 纯条件渲染，去动画避免冲突 */}
      {mode === 'camera' && cameraOn && !isRecording && !showReport && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-4 w-full px-8 max-w-sm">
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
          </div>
        )}

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

      {/* Bottom Meter Rail — 精简 */}
      <footer className="h-3 bg-slate-950 flex items-center justify-between px-4 z-40 border-t border-slate-900/50">
          {mode === 'camera' && (
            <div className="flex gap-3 text-[5px] font-mono text-slate-700 uppercase tracking-[0.15em] truncate">
              <span>加密</span>
              {currentResult?.detected_route_color && (
                <span className="text-orange-600 font-bold truncate">{currentResult.detected_route_color}</span>
              )}
            </div>
          )}
        <ShieldCheck className="w-2 h-2 text-emerald-950 flex-shrink-0" />
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
    </>
  );
}
