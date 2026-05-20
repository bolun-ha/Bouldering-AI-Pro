import React, { useRef, useEffect, useCallback } from 'react';
import { Marker } from '../types';

interface VideoRecorderProps {
  /** 摄像头 video 元素（用于获取实时画面） */
  video: HTMLVideoElement | null;
  /** 当前帧的 AI 标记（每 1.8s 更新一次） */
  markers: Marker[];
  /** 是否正在录制 */
  active: boolean;
  /** 录制完成回调（返回 webm blob） */
  onRecordingComplete: (blob: Blob) => void;
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
  const chunksRef = useRef<Blob[]>([]);
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
    rafRef.current = requestAnimationFrame(drawFrame);
  }, [video]);

  // 开始/停止录制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;

    if (active) {
      // 重置状态
      chunksRef.current = [];
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

      // 创建 canvas 流并录制
      try {
        const stream = canvas.captureStream(Math.min(fps, 30));
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm';

        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          isRecordingRef.current = false;
          const blob = new Blob(chunksRef.current, { type: 'video/webm' });
          console.log(`录制完成: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
          onRecordingComplete(blob);
        };

        mediaRecorder.start(200); // 每 200ms 收集一次数据
      } catch (err) {
        console.error('启动录制失败:', err);
        return;
      }

      // 开始绘制循环
      rafRef.current = requestAnimationFrame(drawFrame);
    }

    return () => {
      // 清理：停止绘制循环 + 停止录制
      cancelAnimationFrame(rafRef.current);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        mediaRecorderRef.current.stop();
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
