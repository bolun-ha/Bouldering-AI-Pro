/**
 * CameraStream — 摄像头画面 + MediaPipe 骨骼追踪
 *
 * 职责：
 * 1. 打开摄像头
 * 2. 按间隔截帧（200ms）传给 AI 分析
 * 3. 运行 MediaPipe Pose 骨骼检测（~15fps）
 * 4. 规则引擎实时输出姿态标记
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { initPoseEngine, detectPose, landmarksToSnapshot } from '../utils/poseEngine';
import { analyzePose } from '../utils/poseRules';
import type { Marker } from '../types';

interface CameraStreamProps {
  /** 截帧回调（给 AI 分析的帧） */
  onFrame: (canvas: HTMLCanvasElement, landmarksSnapshot: string) => void;
  /** 实时姿态标记回调（MediaPipe 规则引擎输出） */
  onPoseMarkers?: (markers: Marker[], landmarks: NormalizedLandmark[]) => void;
  isRecording: boolean;
  captureInterval?: number; // ms
  onError?: (error: string) => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export const CameraStream: React.FC<CameraStreamProps> = ({
  onFrame,
  onPoseMarkers,
  isRecording,
  captureInterval = 2000,
  onError,
  onVideoReady,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarksRef = useRef<NormalizedLandmark[]>([]);
  const poseActiveRef = useRef(false);

  // ─── 摄像头初始化 ──────────────────────────────────────────
  useEffect(() => {
    async function setupCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const isHttps = window.location.protocol === 'https:';
          const msg = isHttps
            ? '您的浏览器不支持摄像头访问（getUserMedia 不可用），请使用现代浏览器并确保已授予摄像头权限。'
            : '摄像头需要 HTTPS 安全环境才能访问。当前页面为 HTTP。请使用 localhost 访问，或用 HTTPS 部署。';
          throw new Error(msg);
        }

        const constraints = {
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        };

        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          console.warn('Retrying with simpler constraints...');
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play();
              onVideoReady?.(videoRef.current);
            }
          };
        }
      } catch (err: any) {
        console.error('Camera access denied:', err);
        if (onError) {
          let msg = err.message || String(err);
          if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
            msg = '摄像头权限被拒绝。请在浏览器设置中允许摄像头访问，或检查是否有其他应用占用摄像头。';
          } else if (msg.includes('NotFoundError')) {
            msg = '未检测到摄像头设备，请确保摄像头已连接且在浏览器中已授权。';
          } else if (msg.includes('NotReadableError')) {
            msg = '摄像头被其他应用占用，请关闭其他使用摄像头的程序后重试。';
          }
          onError(msg);
        }
      }
    }
    setupCamera();
  }, [onError, onVideoReady]);

  // ─── MediaPipe 初始化 + 姿态检测循环 ──────────────────────
  useEffect(() => {
    let rafId = 0;
    let lastPoseTime = 0;
    const poseInterval = 66; // ~15fps

    async function startPose() {
      try {
        await initPoseEngine();
        poseActiveRef.current = true;

        const tick = (timestamp: number) => {
          if (!poseActiveRef.current) return;
          rafId = requestAnimationFrame(tick);

          const video = videoRef.current;
          if (!video || video.readyState < 2) return;

          // 按间隔检测（不每帧跑，省性能）
          if (timestamp - lastPoseTime < poseInterval) return;
          lastPoseTime = timestamp;

          const result = detectPose(video, timestamp);
          if (result) {
            poseLandmarksRef.current = result.landmarks;
            // 运行规则引擎，输出实时标记
            if (onPoseMarkers) {
              const ruleResult = analyzePose(result.landmarks);
              onPoseMarkers(ruleResult.markers, result.landmarks);
            }
          }
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.warn('[PoseEngine] 初始化失败，仅使用 AI 视觉分析:', err);
      }
    }

    startPose();

    return () => {
      poseActiveRef.current = false;
      cancelAnimationFrame(rafId);
    };
  }, [onPoseMarkers]);

  // ─── 截帧分析（提供给 AI 的帧 + 骨骼数据）───────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // 缩放分析帧到 1280×720
    const scale = Math.min(1280 / (video.videoWidth || 1280), 720 / (video.videoHeight || 720));
    canvas.width = Math.round((video.videoWidth || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 生成骨骼坐标快照
    let snapshot = '';
    if (poseLandmarksRef.current.length > 0) {
      snapshot = landmarksToSnapshot(
        poseLandmarksRef.current,
        canvas.width,
        canvas.height,
      );
    }

    onFrame(canvas, snapshot);
  }, [onFrame]);

  // ─── 录制时周期性截帧 ─────────────────────────────────────
  useEffect(() => {
    let intervalId: number;
    if (isRecording) {
      intervalId = window.setInterval(captureFrame, captureInterval);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isRecording, captureFrame, captureInterval]);

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
