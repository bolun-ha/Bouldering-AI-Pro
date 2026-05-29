import React, { useRef, useEffect, useCallback } from 'react';
import { Marker } from '../types';

interface VideoRecorderProps {
  /** 摄像头 video 元素（用于获取实时画面） */
  video: HTMLVideoElement | null;
  /** 当前帧的 AI 标记（每 1.8s 更新一次） */
  markers: Marker[];
  /** 是否正在录制 */
  active: boolean;
  /** 录制完成回调（annotatedBlob = 带标注版，rawBlob = 原始无标注版） */
  onRecordingComplete: (result: {
    annotatedBlob: Blob;
    rawBlob: Blob;
  }) => void;
  /** 每秒帧数（默认 15，平衡性能与流畅度） */
  fps?: number;
}

/** 标记类型对应的颜色 */
const MARKER_COLORS: Record<string, { bg: string; border: string; glow: string }> = {
  error:   { bg: '#ef4444', border: '#dc2626', glow: 'rgba(239,68,68,0.3)' },
  warning: { bg: '#f97316', border: '#ea580c', glow: 'rgba(249,115,22,0.3)' },
  success: { bg: '#10b981', border: '#059669', glow: 'rgba(16,185,129,0.4)' },
  info:    { bg: '#3b82f6', border: '#2563eb', glow: 'rgba(59,130,246,0.3)' },
};

/**
 * 双轨录制 + 离线合成
 *
 * 攀爬中：仅录制原始视频（高码率 H.264/HW 编码）
 * 同时记录标注时间轴（markerTimeline）
 *
 * 完攀后：离线回放原始视频，Canvas 合成标注版（640×aspect，原始录制已为 1280×720 高码率）
 * → 输出 annotatedBlob + rawBlob 两份视频
 */
export const VideoRecorder: React.FC<VideoRecorderProps> = ({
  video,
  markers,
  active,
  onRecordingComplete,
  fps = 15,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const rawRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rawChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('video/webm');
  const isRecordingRef = useRef<boolean>(false);
  const completedRef = useRef(false);
  const markerTimelineRef = useRef<{ time: number; markers: Marker[] }[]>([]);
  const rawRafRef = useRef<number>(0);
  const rawCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── 高码率 + H.264 优先（画质压榨核心） ────────────────
  const HIGH_BITRATE = 6 * 1024 * 1024; // 6 Mbps

  const getSupportedMimeType = () => {
    const types = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',      // H.264 MP4（iOS 15+ WebKit 实验性支持）
      'video/webm;codecs=h264,opus',                   // WebM 容器 H.264
      'video/webm;codecs=vp9,opus',                    // VP9
      'video/webm;codecs=vp8,opus',                    // VP8
      'video/webm',                                     // 兜底
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  };

  // ── 标注时间轴：每次 markers 变化时记录当前视频时间 ──────
  useEffect(() => {
    if (active && video && markers.length > 0) {
      markerTimelineRef.current.push({
        time: video.currentTime,
        markers: markers.map(m => ({ ...m })), // 浅拷贝防引用
      });
    }
  }, [markers, active, video]);

  // ── 离线合成标注版视频（自然播放 + rAF 捕获） ────────────
  // 避坑：不用 for 循环 seek → 移动端 Safari 硬件解码器会死锁/OOM
  // 正解：video.play() 自然播放 → rAF 每帧判定是否捕获 → 0 解码压力
  const synthesizeAnnotatedVideo = useCallback(async (rawBlob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      // 30 秒超时兜底：如果合成卡死（解码器锁死、rAF 不回调等），强行结束
      const timeoutId = setTimeout(() => {
        reject(new Error('Synthesis timeout (30s)'));
      }, 30000);

      const playbackVideo = document.createElement('video');
      playbackVideo.muted = true;
      playbackVideo.playsInline = true;
      playbackVideo.preload = 'auto';
      const url = URL.createObjectURL(rawBlob);
      playbackVideo.src = url;

      playbackVideo.onloadedmetadata = () => {
        clearTimeout(timeoutId); // 视频能加载说明正常，取消超时
        // 但需要再次设置一个新超时用于合成执行阶段
        const execTimeoutId = setTimeout(() => {
          origReject(new Error('Synthesis execution timeout (30s) - possible decode hang'));
        }, 30000);

        const origResolve = resolve;
        const origReject = reject;
        const combinedResolve = (val: Blob) => { clearTimeout(execTimeoutId); origResolve(val); };
        const combinedReject = (err: any) => { clearTimeout(execTimeoutId); origReject(err); };

        const synthCanvas = document.createElement('canvas');
        const aspect = playbackVideo.videoHeight / playbackVideo.videoWidth || 1;
        // 合成分辨率 640×aspect（原始录制已有 1280×720 高码率，合成仅渲染标注，不需要高分辨率）
        synthCanvas.width = 640;
        synthCanvas.height = Math.round(640 * aspect);

        const ctx = synthCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { combinedReject(new Error('Canvas not supported')); return; }

        const timeline = markerTimelineRef.current;

        // 找到最接近 targetTime 的标注（取 <= targetTime 的最新一个）
        const findMarkers = (targetTime: number): Marker[] | null => {
          if (timeline.length === 0) return null;
          let best = timeline[0];
          for (const entry of timeline) {
            if (entry.time <= targetTime) best = entry;
            if (entry.time > targetTime) break;
          }
          return best.markers;
        };

        // 在 Canvas 上绘制标注
        const drawMarkers = (markersToDraw: Marker[]) => {
          const cw = synthCanvas.width;
          const ch = synthCanvas.height;
          for (const marker of markersToDraw) {
            const x = (marker.x / 100) * cw;
            const y = (marker.y / 100) * ch;
            const color = MARKER_COLORS[marker.type] || MARKER_COLORS.info;

            const gradient = ctx!.createRadialGradient(x, y, 2, x, y, 28);
            gradient.addColorStop(0, color.glow);
            gradient.addColorStop(1, 'transparent');
            ctx!.fillStyle = gradient;
            ctx!.beginPath();
            ctx!.arc(x, y, 28, 0, Math.PI * 2);
            ctx!.fill();

            ctx!.beginPath();
            ctx!.arc(x, y, 6, 0, Math.PI * 2);
            ctx!.fillStyle = '#ffffff';
            ctx!.fill();
            ctx!.shadowColor = '#ffffff';
            ctx!.shadowBlur = 12;
            ctx!.fill();
            ctx!.shadowBlur = 0;

            const label = marker.label.toUpperCase();
            ctx!.font = 'bold 12px Inter, system-ui, sans-serif';
            const textWidth = ctx!.measureText(label).width;
            const padX = 10, padY = 5;
            const labelW = textWidth + padX * 2;
            const labelH = 24;
            const labelX = x - labelW / 2;
            const labelY = y - 36;

            const r = 5;
            ctx!.beginPath();
            ctx!.moveTo(labelX + r, labelY);
            ctx!.lineTo(labelX + labelW - r, labelY);
            ctx!.quadraticCurveTo(labelX + labelW, labelY, labelX + labelW, labelY + r);
            ctx!.lineTo(labelX + labelW, labelY + labelH - r);
            ctx!.quadraticCurveTo(labelX + labelW, labelY + labelH, labelX + labelW - r, labelY + labelH);
            ctx!.lineTo(labelX + r, labelY + labelH);
            ctx!.quadraticCurveTo(labelX, labelY + labelH, labelX, labelY + labelH - r);
            ctx!.lineTo(labelX, labelY + r);
            ctx!.quadraticCurveTo(labelX, labelY, labelX + r, labelY);
            ctx!.closePath();
            ctx!.fillStyle = color.bg;
            ctx!.fill();
            ctx!.fillStyle = '#ffffff';
            ctx!.textAlign = 'center';
            ctx!.textBaseline = 'middle';
            ctx!.fillText(label, x, labelY + labelH / 2);
          }
        };

        const synthMimeType = getSupportedMimeType();
        const synthFps = Math.min(fps, 30);
        const captureInterval = 1000 / synthFps; // ms
        const stream = synthCanvas.captureStream(synthFps);
        // 🎯 6 Mbps 高码率
        const recorder = new MediaRecorder(stream, {
          mimeType: synthMimeType,
          videoBitsPerSecond: HIGH_BITRATE,
        });
        const synthChunks: Blob[] = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) synthChunks.push(e.data);
        };
        recorder.onstop = () => {
          URL.revokeObjectURL(url);
          combinedResolve(new Blob(synthChunks, { type: synthMimeType }));
        };

        // 开始录制
        recorder.start(100);

        // 自然播放 + rAF 捕获
        // playbackRate=1.5: 30s 视频 → 20s 合成，不触发解码器压力
        playbackVideo.playbackRate = 1.5;
        let lastCapture = -captureInterval;
        let synthRaf = 0;

        const synthTick = () => {
          if (playbackVideo.paused || playbackVideo.ended) {
            recorder.stop();
            return;
          }

          const now = playbackVideo.currentTime * 1000;
          if (now - lastCapture >= captureInterval) {
            lastCapture = now;
            ctx.drawImage(playbackVideo, 0, 0, synthCanvas.width, synthCanvas.height);
            const matched = findMarkers(playbackVideo.currentTime);
            if (matched && matched.length > 0) drawMarkers(matched);
            // 水印
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.font = 'bold 14px Inter, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('AI 抱石教练 · 专业版', 16, 16);
          }
          synthRaf = requestAnimationFrame(synthTick);
        };

        playbackVideo.onerror = () => { cancelAnimationFrame(synthRaf); URL.revokeObjectURL(url); combinedReject(new Error('Playback failed')); };
        playbackVideo.play().then(() => { synthRaf = requestAnimationFrame(synthTick); }).catch(combinedReject);
      };

      playbackVideo.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load raw video')); };
    });
  }, [fps]);

  // ── Canvas captureStream 兜底录制（iOS 上 video.captureStream 可能返回空流）
  // 在不可用的设备上降级为：rAF 持续 drawImage → canvas.captureStream → MediaRecorder
  const startRawCanvasCapture = useCallback((videoEl: HTMLVideoElement) => {
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = videoEl.videoWidth || 1280;
    rawCanvas.height = videoEl.videoHeight || 720;
    rawCanvasRef.current = rawCanvas;

    const ctx = rawCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const stream = rawCanvas.captureStream(30);
    if (stream.getVideoTracks().length === 0) return;

    try {
      const rawRecorder = new MediaRecorder(stream, {
        mimeType: mimeTypeRef.current,
        videoBitsPerSecond: HIGH_BITRATE,
      });
      rawRecorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) rawChunksRef.current.push(e.data);
      };
      rawRecorder.start(200);
      rawRecorderRef.current = rawRecorder;
    } catch (err) {
      console.warn('[VideoRecorder] Canvas兜底录制初始化失败:', err);
    }

    const draw = () => {
      if (!isRecordingRef.current) return;
      ctx.drawImage(videoEl, 0, 0, rawCanvas.width, rawCanvas.height);
      rawRafRef.current = requestAnimationFrame(draw);
    };
    rawRafRef.current = requestAnimationFrame(draw);
  }, []);

  // ── 录制主逻辑 ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;

    if (active) {
      // 重置状态
      chunksRef.current = [];
      rawChunksRef.current = [];
      markerTimelineRef.current = [];
      isRecordingRef.current = true;
      completedRef.current = false;

      // 检查 MediaRecorder 支持
      if (!window.MediaRecorder) {
        console.warn('MediaRecorder 不受支持，跳过视频录制');
        return;
      }

      const mimeType = getSupportedMimeType();
      mimeTypeRef.current = mimeType;

      // 【攀爬中】仅录制原始视频（硬件编码，不占 CPU）
      if (video.captureStream) {
        try {
          const rawStream = video.captureStream();
          // iOS Safari: captureStream 可能返回无 video track 的空流
          if (rawStream.getVideoTracks().length === 0) {
            console.warn('[VideoRecorder] captureStream empty tracks, fallback to canvas');
            startRawCanvasCapture(video);
          } else {
            const rawRecorder = new MediaRecorder(rawStream, {
              mimeType,
              videoBitsPerSecond: HIGH_BITRATE,
            });
            rawRecorderRef.current = rawRecorder;
            rawRecorder.ondataavailable = (e: BlobEvent) => {
              if (e.data.size > 0) rawChunksRef.current.push(e.data);
            };
            rawRecorder.start(200);
            console.log('[VideoRecorder] 原始视频录制已启动');
          }
        } catch (err) {
          console.error('启动原始视频录制失败:', err);
          startRawCanvasCapture(video);
        }
      } else {
        // 不支持 captureStream → 用 canvas 录制
        startRawCanvasCapture(video);
      }

      // 不在此处启动 Canvas 合成！全部在 offline 阶段完成
      // Canvas 仅用作合成标注版视频的离线容器
      const maxDim = 1280;
      let w = video.videoWidth || 1280;
      let h = video.videoHeight || 720;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      canvas.width = w;
      canvas.height = h;
    }

    // ── 停止录制 → 离线合成标注版 ──────────────────────
    return () => {
      isRecordingRef.current = false;
      cancelAnimationFrame(rawRafRef.current);
      if (completedRef.current) return;
      completedRef.current = true;

      // 停止原始录制，获取 rawBlob
      const rawBlobPromise = new Promise<Blob | null>((resolve) => {
        if (rawRecorderRef.current && rawRecorderRef.current.state !== 'inactive') {
          // 5 秒超时：如果 onstop 没触发，强行 resolve null
          const timeoutId = setTimeout(() => {
            console.warn('[VideoRecorder] 原始录制停止超时，跳过 rawBlob');
            resolve(null);
          }, 5000);
          rawRecorderRef.current.onstop = () => {
            clearTimeout(timeoutId);
            const rawBlob = new Blob(rawChunksRef.current, { type: mimeTypeRef.current });
            resolve(rawBlob);
          };
          rawRecorderRef.current.stop();
        } else {
          // 没有原始录制 → 获取失败，后续 fallback
          resolve(null);
        }
      });

      // 等待 raw blob 就绪，然后开始离线合成
      rawBlobPromise.then(async (rawBlob) => {
        if (rawBlob && rawBlob.size > 0) {
          try {
            // 离线 Canvas 合成标注版
            console.log('[VideoRecorder] 正在离线合成标注版视频...');
            const annotatedBlob = await synthesizeAnnotatedVideo(rawBlob);
            console.log(`[VideoRecorder] 合成完成: 标注版 ${(annotatedBlob.size / 1024 / 1024).toFixed(1)}MB, 原始版 ${(rawBlob.size / 1024 / 1024).toFixed(1)}MB`);
            onRecordingComplete({ annotatedBlob, rawBlob });
          } catch (err) {
            console.error('[VideoRecorder] 离线合成失败，回退到原始视频:', err);
            // 合成失败时，用 raw 作为 annotated 的 fallback
            onRecordingComplete({ annotatedBlob: rawBlob, rawBlob });
          }
        } else {
          // 没有原始视频（video.captureStream 不支持）→ 用空标注版
          console.warn('[VideoRecorder] 无原始视频，跳过离线合成');
          const emptyBlob = new Blob([], { type: mimeTypeRef.current });
          onRecordingComplete({ annotatedBlob: emptyBlob, rawBlob: emptyBlob });
        }
      });
    };
  }, [active, video, fps, onRecordingComplete, synthesizeAnnotatedVideo]);

  return (
    <canvas
      ref={canvasRef}
      className="hidden"
      width="1920"
      height="1080"
    />
  );
};
