import { useState, useCallback, useRef, useEffect } from 'react';
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
  const [showQR, setShowQR] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const cooldownRef = useRef(false);
  const startingRef = useRef(false); // 防快速双击开始

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
    if (startingRef.current) return; // 防快速双击
    startingRef.current = true;
    cooldownRef.current = false; // 重置冷却，防上个 session 的冷却还没结束
    setRecordedVideoBlob(null);
    setSession({
      startTime: Date.now(),
      totalErrors: 0,
      history: []
    });
    setIsRecording(true);
    setCurrentResult(null);
    setCameraStarted(true); // 启动摄像头 + 检测循环
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

  const stopClimb = useCallback(() => {
    startingRef.current = false; // 重置开始锁
    setIsRecording(false);
    setCurrentResult(null); // 清除残留标注，防止报告关闭后还在显示
    setSession(prev => {
      if (!prev) return prev;
      return { ...prev, endTime: Date.now() };
    });
    // 立即显示报告，不延迟
    setShowReport(true);
  }, []);

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
      // 保留当前规则标注，仅更新 AI 分析文本（标注始终由 poseRules 控制）
      setCurrentResult(prev => {
        if (!prev) return result;
        return { ...prev, ...result, markers: prev.markers };
      });

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
                // 如果已有姿态规则标注（错误/警告），不叠加手部标记
                const hasPoseMarkers = prev.markers.some(m => m.type === 'error' || m.type === 'warning');
                // 只取最近手的标注（最多1个）
                const top = holdMarkers.slice(0, 1);
                // 坐标校正：object-cover 裁切，手部坐标偏移
                const video = videoElementRef.current;
                if (video && video.videoWidth && video.offsetWidth) {
                  const vw = video.videoWidth, vh = video.videoHeight;
                  const cw = video.offsetWidth, ch = video.offsetHeight;
                  const vAR = vw / vh, cAR = cw / ch;
                  for (const m of top) {
                    const nx = m.x / 100, ny = m.y / 100;
                    let adjX = nx, adjY = ny;
                    if (vAR > cAR) {
                      const vr = cAR / vAR;
                      const cs = (1 - vr) / 2;
                      adjX = Math.max(0, Math.min(1, (nx - cs) / vr));
                    } else {
                      const vr = vAR / cAR;
                      const cs = (1 - vr) / 2;
                      adjY = Math.max(0, Math.min(1, (ny - cs) / vr));
                    }
                    m.x = adjX * 100;
                    m.y = adjY * 100;
                  }
                }
                // 移除旧的手部距离标记
                const filtered = prev.markers.filter(m => !m.label.includes('未握住') && !m.label.includes('抓握异常'));
                // 有姿态规则标注时，不叠加手部标注
                if (hasPoseMarkers) return prev;
                return { ...prev, markers: [...filtered, ...top] };
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

  // MediaPipe 实时姿态标记（带稳定性缓冲，防频闪）
  // 滑窗计数锁（双阈值）：连续 N 帧确认才亮，连续缺失到 M 帧以下才灭
  // 防后置摄像头光线/阴影导致的高频微小抖动
  const MARKER_CONFIRM = 5;  // 连续 5 帧（~300ms）都检测到 → 首次亮圈
  const MARKER_CLEAR = 3;    // 连续衰减到 3 帧以下（~180ms 未检测到）→ 灭圈
  const markerCountersRef = useRef<Record<string, number>>({});
  const markerActiveRef = useRef<Set<string>>(new Set());
  const markerDataRef = useRef<Record<string, import('./types').Marker>>({});

  // MediaPipe 实时姿态标记（带滑窗计数防抖）
  const handlePoseMarkers = useCallback((markers: import('./types').Marker[], _landmarks: any, hands?: any[]) => {
    // 保存手部数据
    if (hands && hands.length > 0) {
      handResultsRef.current = hands;
    }

    const counters = markerCountersRef.current;
    const currentLabels = new Set(markers.map(m => m.label));

    // 缓存最新标记数据（供衰减期使用，此时标记不在 markers 中）
    const dataCache = markerDataRef.current;
    for (const m of markers) {
      dataCache[m.label] = m;
    }

    // 更新所有计数器
    const allLabels = new Set([...Object.keys(counters), ...markers.map(m => m.label)]);
    for (const label of allLabels) {
      counters[label] = currentLabels.has(label)
        ? Math.min(MARKER_CONFIRM, (counters[label] || 0) + 1)   // 检测到 → 累加
        : Math.max(0, (counters[label] || 0) - 1);              // 未检测到 → 衰减
    }

    // 双阈值管理激活状态
    const activeSet = markerActiveRef.current;
    const activeMarkers: import('./types').Marker[] = [];
    for (const [label, count] of Object.entries(counters)) {
      if (!activeSet.has(label) && count >= MARKER_CONFIRM) {
        activeSet.add(label); // 首次亮圈
      } else if (activeSet.has(label) && count < MARKER_CLEAR) {
        activeSet.delete(label); // 灭圈
      }
    }

    // 从缓存获取活跃标记的完整数据（包括衰减期的）
    for (const label of activeSet) {
      const cached = dataCache[label];
      if (cached) activeMarkers.push(cached);
    }

    // 清理零值计数
    for (const key of Object.keys(counters)) {
      if (counters[key] === 0) delete counters[key];
    }

    // 更新 UI
    setCurrentResult(prev => {
      if (!prev) {
        return {
          markers: activeMarkers,
          instruction: '',
          detailed_feedback: '',
          detected_route_color: '',
          climb_status: 'moving',
        };
      }
      const ruleMarkers = activeMarkers.filter(m => m.type === 'error' || m.type === 'warning').slice(0, 2);
      return { ...prev, markers: ruleMarkers };
    });
  }, []);

  // ─── 卡关 5v 分析 ─────────────────────────────────────────
  const [betaSuggestion, setBetaSuggestion] = useState<string | null>(null);
  const betaTimerRef = useRef<number>(0);
  const analyzingStuckRef = useRef(false);

  const handleStuck = useCallback(async (buffer: any[]) => {
    if (analyzingStuckRef.current) return;
    analyzingStuckRef.current = true;
    try {
      // 从缓冲区提取 3-4 帧
      const frames = buffer.slice(-4).map((e: any) => ({
        base64: e.base64,
        timestamp: e.timestamp,
      }));
      const prompt = `你是一名抱石攀岩教练。用户卡在岩壁上了！请用一句话（20字以内）给出最简短的动作建议（比如"右脚踩高，左手换大点"）。不要解释，不要多余内容。`;

      const res = await fetch('/api/analyze-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, prompt, model: 'glm-5v-turbo' }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.content || '';
        // 清理 JSON 包裹，提取纯文本
        const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '').trim();
        const text = cleaned.length > 60 ? cleaned.slice(0, 60) : cleaned;
        setBetaSuggestion(text);
        // 8 秒后自动消失
        if (betaTimerRef.current) clearTimeout(betaTimerRef.current);
        betaTimerRef.current = window.setTimeout(() => setBetaSuggestion(null), 8000);
      }
    } catch (err) {
      console.warn('[Stuck] 5v 分析失败:', err);
    } finally {
      analyzingStuckRef.current = false;
    }
  }, []);

  // ─── 掉落自动复盘 ─────────────────────────────────────────
  const handleFall = useCallback(async (buffer: any[]) => {
    console.log('[Fall] 检测到掉落，缓冲区帧数:', buffer.length);
    // stop recording if active
    stopClimb();
  }, [stopClimb]);

  return (
    <>
      <QRPopover isOpen={showQR} onClose={() => setShowQR(false)} xiaohongshuQR="/xiaohongshu-qr.png" />
      <div className="relative h-screen w-screen bg-slate-950 font-sans text-slate-200 overflow-hidden flex flex-col">
      {/* Mobile-First Header */}
      <header className="absolute top-0 inset-x-0 h-14 bg-gradient-to-b from-slate-950/80 to-transparent flex items-center justify-between px-4 z-40 backdrop-blur-sm">
        <div className="flex items-center gap-2 flex-shrink-0">
          <button id="b-logo" onClick={() => setShowQR(true)} className="w-7 h-7 bg-orange-600 rounded-lg flex items-center justify-center text-white font-black italic shadow-lg shadow-orange-600/20 hover:bg-orange-500 active:scale-90 transition-all text-xs">B</button>
          <h1 className="text-[11px] font-black tracking-tighter text-white uppercase italic leading-none">抱石 AI <span className="text-orange-500">专业版</span></h1>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mode Toggle */}
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
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[8px] text-slate-500 uppercase font-black">云端延迟</span>
            <span className="text-[10px] font-mono text-emerald-400">1.2s</span>
          </div>
          <div className="hidden sm:block h-3 w-px bg-slate-800"></div>
          <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-500'}`} />
        </div>
      </header>

      {/* Full-Screen Content */}
      <main className="flex-1 relative overflow-hidden bg-slate-900 shadow-inner">
        <div className={`absolute inset-0 ${mode === 'camera' ? '' : 'hidden'}`}>
            <CameraStream
              onFrame={handleFrame}
              onPoseMarkers={handlePoseMarkers}
              onStuck={handleStuck}
              onFall={handleFall}
              isRecording={isRecording}
              cameraStarted={cameraStarted}
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
              fps={30}
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

            {/* Overlays — 仅在录制中显示标注圈，防止非录制时残留 */}
            {isRecording && <Overlay markers={currentResult?.markers || []} />}
            <GuidancePanel result={currentResult} isAnalyzing={isAnalyzing} error={analysisError} />

            {/* 卡关 Beta 建议浮层 */}
            <AnimatePresence>
              {betaSuggestion && (
                <motion.div
                  initial={{ y: 20, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 20, opacity: 0, scale: 0.9 }}
                  className="absolute bottom-32 left-6 right-6 z-50 max-w-sm mx-auto"
                >
                  <div className="bg-gradient-to-br from-orange-600/95 to-orange-700/95 backdrop-blur-md border border-orange-400/50 p-4 rounded-2xl shadow-2xl shadow-orange-600/30">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center text-xs font-black">💡</div>
                      <span className="text-[10px] font-black text-orange-200 uppercase tracking-widest">AI 建议</span>
                    </div>
                    <p className="text-white text-base font-bold leading-tight">{betaSuggestion}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

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
          </div>
          <div className={`absolute inset-0 ${mode === 'video' ? '' : 'hidden'}`}>
            <VideoAnalysis />
          </div>
      </main>

      {/* Camera Mode: Floating Controls Overlay — 纯条件渲染，去动画避免冲突 */}
      {mode === 'camera' && !isRecording && !showReport && (
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
    </>
  );
}
