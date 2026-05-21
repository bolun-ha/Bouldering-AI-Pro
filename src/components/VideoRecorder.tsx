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
 * 隐藏 canvas 合成器：将摄像头画面 + AI 标记绘制到画布上，
 * 并用 MediaRecorder 录制为带标注的视频。
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
  const rafRef = useRef<number>(0);
  const markersRef = useRef<Marker[]>(markers);
  const isRecordingRef = useRef<boolean>(false);

  // 保持 markers 引用最新，避免闭包捕获旧值
  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {

    // 1. 绘制视频帧
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#020617'; // slate-950
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. 绘制 AI 标记
    const currentMarkers = markersRef.current;
    const cw = canvas.width;
    const ch = canvas.height;

    currentMarkers.forEach((marker) => {
      const x = (marker.x / 100) * cw;
      const y = (marker.y / 100) * ch;
      const color = MARKER_COLORS[marker.type] || MARKER_COLORS.info;

      // --- 圆形发光环 ---
      const gradient = ctx.createRadialGradient(x, y, 2, x, y, 28);
      gradient.addColorStop(0, color.glow);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, 28, 0, Math.PI * 2);
      ctx.fill();

      // --- 实心圆点 ---
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      // --- 标记标签（带背景色的圆角矩形） ---
      const label = marker.label.toUpperCase();
      ctx.font = 'bold 12px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const padX = 10;
      const padY = 5;
      const labelW = textWidth + padX * 2;
      const labelH = 24;
      const labelX = x - labelW / 2;
      const labelY = y - 36;

      // 背景圆角矩形
      const r = 5;
      ctx.beginPath();
      ctx.moveTo(labelX + r, labelY);
      ctx.lineTo(labelX + labelW - r, labelY);
      ctx.quadraticCurveTo(labelX + labelW, labelY, labelX + labelW, labelY + r);
      ctx.lineTo(labelX + labelW, labelY + labelH - r);
      ctx.quadraticCurveTo(labelX + labelW, labelY + labelH, labelX + labelW - r, labelY + labelH);
      ctx.lineTo(labelX + r, labelY + labelH);
      ctx.quadraticCurveTo(labelX, labelY + labelH, labelX, labelY + labelH - r);
      ctx.lineTo(labelX, labelY + r);
      ctx.quadraticCurveTo(labelX, labelY, labelX + r, labelY);
      ctx.closePath();
      ctx.fillStyle = color.bg;
      ctx.fill();

      // 文字
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, labelY + labelH / 2);
    });

    // 3. 水印
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('AI 抱石教练 · 专业版', 16, 16);

    // 4. 继续下一帧
    } catch (_) { /* draw 失败不影响录制 */ }
    rafRef.current = requestAnimationFrame(drawFrame);
  }, [video]);

  // 开始/停止录制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;

    let rawBlobResult: Blob | undefined;

    if (active) {
      // 重置状态
      chunksRef.current = [];
      rawChunksRef.current = [];
      isRecordingRef.current = true;

      // 匹配 video 尺寸
      // 设为摄像头原生分辨率，上限 1080p
      const maxDim = 1080;
      let w = video.videoWidth || 1280;
      let h = video.videoHeight || 720;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      canvas.width = w;
      canvas.height = h;

      // 检查 MediaRecorder 支持
      if (!window.MediaRecorder) {
        console.warn('MediaRecorder 不受支持，跳过视频录制');
        return;
      }

      const getMimeType = () => {
        // iOS Safari: 首选 MP4（手机可直接播放/保存到相册）
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264,aac'))
          return 'video/mp4;codecs=h264,aac';
        if (MediaRecorder.isTypeSupported('video/mp4'))
          return 'video/mp4';
        // Chrome/Android: 次选 H.264 in WebM（部分设备可播放）
        if (MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus'))
          return 'video/webm;codecs=h264,opus';
        // 兜底 VP9 / VP8
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus'))
          return 'video/webm;codecs=vp9,opus';
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus'))
          return 'video/webm;codecs=vp8,opus';
        return 'video/webm';
      };

      // 标注版录制（canvas 合成流）
      try {
        const stream = canvas.captureStream(Math.min(fps, 30));
        const mimeType = getMimeType();
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.start(200);
      } catch (err) {
        console.error('启动标注版录制失败:', err);
      }

      // 原始无标注版录制（直接从 video 元素捕获）
      if (video.captureStream) {
        try {
          const rawStream = video.captureStream();
          const mimeType = getMimeType();
          const rawRecorder = new MediaRecorder(rawStream, { mimeType });
          rawRecorderRef.current = rawRecorder;

          rawRecorder.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) rawChunksRef.current.push(e.data);
          };

          rawRecorder.start(200);
        } catch (err) {
          console.error('启动原始版录制失败:', err);
          rawRecorderRef.current = null;
        }
      }

      // 开始绘制循环
      rafRef.current = requestAnimationFrame(drawFrame);
    }

    return () => {
      // 清理：停止绘制循环 + 停止录制
      cancelAnimationFrame(rafRef.current);

      let annotatedDone = false;
      let rawDone = false;
      rawBlobResult = undefined;

      const tryComplete = () => {
        if (!annotatedDone || !rawDone) return;
        isRecordingRef.current = false;
        const annotatedBlob = new Blob(chunksRef.current, { type: 'video/webm' });
        console.log(`录制完成: 标注版 ${(annotatedBlob.size / 1024 / 1024).toFixed(1)}MB, 原始版 ${(rawBlobResult?.size || 0) / 1024 / 1024}MB`);
        onRecordingComplete({ annotatedBlob, rawBlob: rawBlobResult || annotatedBlob });
      };

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = () => {
          annotatedDone = true;
          tryComplete();
        };
        mediaRecorderRef.current.stop();
      } else {
        annotatedDone = true;
      }

      if (rawRecorderRef.current && rawRecorderRef.current.state !== 'inactive') {
        rawRecorderRef.current.onstop = () => {
          rawBlobResult = new Blob(rawChunksRef.current, { type: 'video/webm' });
          rawDone = true;
          tryComplete();
        };
        rawRecorderRef.current.stop();
      } else {
        rawDone = true;
      }

      // 如果没有异步 recorder 需要等待，立即触发
      if (annotatedDone && rawDone) {
        isRecordingRef.current = false;
        const annotatedBlob = new Blob(chunksRef.current, { type: 'video/webm' });
        onRecordingComplete({
          annotatedBlob,
          rawBlob: rawBlobResult || annotatedBlob,
        });
      }
    };
  }, [active, video, fps, drawFrame, onRecordingComplete]);

  return (
    <canvas
      ref={canvasRef}
      className="hidden"
      width="1920"
      height="1080"
    />
  );
};
