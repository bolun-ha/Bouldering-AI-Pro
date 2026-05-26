/**
 * CameraStream — 摄像头画面 + MediaPipe 骨骼+手势追踪
 *
 * 职责：
 * 1. 打开摄像头
 * 2. 按间隔截帧（~2s）传给 AI 分析（含骨骼+手势数据）
 * 3. 运行 MediaPipe Pose(~15fps) + Hands(~10fps)
 * 4. 规则引擎实时输出姿态标记
 * 5. 帧缓冲区（持续保存最近帧 + 骨骼数据）
 * 6. 卡关检测（3秒无纵向位移）和掉落检测
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  initAllEngines,
  detectPose,
  detectHands,
  landmarksToSnapshot,
  handLandmarksToSnapshot,
  LANDMARK,
} from '../utils/poseEngine';
import { applyContourOverlay } from '../utils/contourOverlay';
import { analyzePose } from '../utils/poseRules';
import { Overlay } from './Overlay';
import type { Marker, HandResult } from '../types';

/** 帧缓冲区条目 */
interface FrameBufferEntry {
  timestamp: number;
  base64: string;
  poseSnapshot: string;
  handSnapshot: string;
  /** 髋部中心 Y 坐标（归一化 0-1） */
  hipCenterY: number;
}

// 临时 HandResult 类型，避免跨文件依赖
interface HandRes {
  landmarks: NormalizedLandmark[];
  handedness: 'Left' | 'Right';
  score: number;
}

/**
 * 调整 MediaPipe 坐标 → 显示容器坐标
 * video 使用 object-cover（中心裁剪），MediaPipe 0-1 是全帧坐标
 * 需将全帧坐标映射到可见裁切区域
 */
function adjustCoords(video: HTMLVideoElement, x: number, y: number): { x: number; y: number } {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = video.offsetWidth, ch = video.offsetHeight;
  if (!vw || !vh || !cw || !ch) return { x, y };

  const vAR = vw / vh;
  const cAR = cw / ch;

  let adjX = x, adjY = y;

  if (vAR > cAR) {
    // 视频更宽：object-cover 裁切左右
    const visibleRatio = cAR / vAR; // 可见宽度占全帧比例
    const cropStart = (1 - visibleRatio) / 2;
    adjX = Math.max(0, Math.min(1, (x - cropStart) / visibleRatio));
    // Y 方向无裁剪
    adjY = y;
  } else {
    // 容器更宽/更高：object-cover 裁切上下
    const visibleRatio = vAR / cAR; // 可见高度占全帧比例
    const cropStart = (1 - visibleRatio) / 2;
    adjY = Math.max(0, Math.min(1, (y - cropStart) / visibleRatio));
    // X 方向无裁剪
    adjX = x;
  }

  return { x: adjX, y: adjY };
}

interface CameraStreamProps {
  onFrame: (canvas: HTMLCanvasElement, poseSnapshot: string, handSnapshot: string) => void;
  /** 实时姿态标记回调（MediaPipe 规则引擎输出） */
  onPoseMarkers?: (markers: Marker[], landmarks: NormalizedLandmark[], hands?: HandRes[]) => void;
  /** 卡关时触发：传入缓冲区帧供 5v 分析 */
  onStuck?: (buffer: FrameBufferEntry[]) => void;
  /** 掉落时触发：传入缓冲区帧供自动复盘 */
  onFall?: (buffer: FrameBufferEntry[]) => void;
  isRecording: boolean;
  captureInterval?: number;
  onError?: (error: string) => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export const CameraStream: React.FC<CameraStreamProps> = ({
  onFrame,
  onPoseMarkers,
  onStuck,
  onFall,
  isRecording,
  captureInterval = 2000,
  onError,
  onVideoReady,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseLandmarksRef = useRef<NormalizedLandmark[]>([]);
  const handResultsRef = useRef<HandRes[]>([]);
  const poseActiveRef = useRef(false);

  // ─── 帧缓冲区（供卡关/掉落触发时截取） ────────────────────
  const frameBufferRef = useRef<FrameBufferEntry[]>([]);
  const FRAME_BUFFER_SECONDS = 8; // 保留最近 8 秒
  const FRAME_BUFFER_INTERVAL = 1200; // ~0.8fps
  const STUCK_Y_THRESHOLD = 0.008; // Y 轴变化 < 0.8% 视为静止
  const STUCK_TIME_MS = 3000;     // 持续 3 秒视为卡关
  const FALL_Y_DROP = 0.15;       // Y 快速下降 > 15%

  // 卡关状态机
  const stillTimerRef = useRef<number>(0);  // 持续静止的毫秒数
  const lastHipYRef = useRef<number>(-1);   // 上次有效髋部 Y
  const stuckTriggeredRef = useRef(false);  // 已触发卡关提示（防重复）
  const lastStuckTimestampRef = useRef(0);  // 最后卡关触发时间

  // 掉落状态机
  const fallTriggeredRef = useRef(false);

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

  // ─── MediaPipe Pose + Hands 检测循环 ──────────────────────
  useEffect(() => {
    let rafId = 0;
    let lastPoseTime = 0;
    let lastHandTime = 0;
    let lastBufferTime = 0;
    const poseInterval = 66;  // ~15fps
    const handInterval = 100; // ~10fps（比 pose 低频，省电）

    /** 计算髋部中心 Y 坐标（归一化 0-1） */
    function calcHipCenterY(landmarks: NormalizedLandmark[]): number {
      const left = landmarks[LANDMARK.LEFT_HIP];
      const right = landmarks[LANDMARK.RIGHT_HIP];
      if (!left || !right) return -1;
      return (left.y + right.y) / 2;
    }

    /** 截帧并存入缓冲区 */
    function captureBufferFrame(video: HTMLVideoElement) {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const scale = Math.min(640 / (video.videoWidth || 640), 480 / (video.videoHeight || 480));
      canvas.width = Math.round((video.videoWidth || 640) * scale);
      canvas.height = Math.round((video.videoHeight || 480) * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.6).replace(/^data:image\/jpeg;base64,/, '');

      const hipCenterY = poseLandmarksRef.current.length > 0
        ? calcHipCenterY(poseLandmarksRef.current) : -1;

      let poseSnapshot = '';
      if (poseLandmarksRef.current.length > 0) {
        poseSnapshot = landmarksToSnapshot(poseLandmarksRef.current, canvas.width, canvas.height);
      }
      let handSnapshot = '';
      if (handResultsRef.current.length > 0) {
        handSnapshot = handLandmarksToSnapshot(handResultsRef.current as any, canvas.width, canvas.height);
      }

      const entry: FrameBufferEntry = {
        timestamp: Date.now(),
        base64,
        poseSnapshot,
        handSnapshot,
        hipCenterY,
      };
      frameBufferRef.current.push(entry);
      // 裁剪超出窗口的旧帧
      const cutoff = Date.now() - FRAME_BUFFER_SECONDS * 1000;
      frameBufferRef.current = frameBufferRef.current.filter(e => e.timestamp > cutoff);

      return entry;
    }

    async function startDetection() {
      try {
        await initAllEngines();
        poseActiveRef.current = true;

        // MediaPipe 要求严格单调递增的时间戳，requestAnimationFrame 可能送回退值
        const monotonicTsRef = { current: 0 };

        const tick = (timestamp: number) => {
          if (!poseActiveRef.current) return;
          rafId = requestAnimationFrame(tick);

          const video = videoRef.current;
          if (!video || video.readyState < 2) return;

          // 保证时间戳严格单调递增
          const mediapipeTs = Math.floor(Math.max(timestamp, monotonicTsRef.current + 1));
          monotonicTsRef.current = mediapipeTs;

          // Pose 检测
          if (timestamp - lastPoseTime >= poseInterval) {
            lastPoseTime = timestamp;
            const poseRes = detectPose(video, mediapipeTs);
            if (poseRes) {
              poseLandmarksRef.current = poseRes.landmarks;
            }
          }

          // Hand 检测
          let handsThisFrame: HandRes[] | undefined;
          if (timestamp - lastHandTime >= handInterval) {
            lastHandTime = timestamp;
            const handRes = detectHands(video, mediapipeTs);
            handResultsRef.current = handRes as unknown as HandRes[];
            handsThisFrame = handRes.length > 0 ? (handRes as unknown as HandRes[]) : undefined;
          }

          // ── 帧缓冲区（周期性截帧） ──────────────────────────
          if (timestamp - lastBufferTime >= FRAME_BUFFER_INTERVAL) {
            lastBufferTime = timestamp;
            captureBufferFrame(video);
          }

          // 规则引擎 + 回调
          // 仅在录制中时才发送姿态标注（防止未开始攀爬就显示）
          if (isRecording && onPoseMarkers && poseLandmarksRef.current.length > 0) {
            const ruleResult = analyzePose(poseLandmarksRef.current);
            // 校正坐标：考虑 object-contain 黑边，使标注贴合实际身体部位
            const adjusted = ruleResult.markers.map(m => {
              const { x, y } = adjustCoords(video, m.x / 100, m.y / 100);
              return { ...m, x: x * 100, y: y * 100 };
            });
            onPoseMarkers(adjusted, poseLandmarksRef.current, handsThisFrame);
          }

          // ── 卡关检测 ────────────────────────────────────────
          if (poseLandmarksRef.current.length > 0) {
            const currentHipY = calcHipCenterY(poseLandmarksRef.current);
            if (currentHipY >= 0) {
              // Y 轴位移判断
              if (lastHipYRef.current >= 0) {
                const deltaY = Math.abs(currentHipY - lastHipYRef.current);
                if (deltaY < STUCK_Y_THRESHOLD) {
                  stillTimerRef.current += poseInterval; // 约 66ms
                } else {
                  stillTimerRef.current = 0;
                  stuckTriggeredRef.current = false;
                }
              }
              lastHipYRef.current = currentHipY;

              // 持续静止 >= STUCK_TIME_MS → 卡关
              const now = Date.now();
              if (
                stillTimerRef.current >= STUCK_TIME_MS &&
                !stuckTriggeredRef.current &&
                (now - lastStuckTimestampRef.current) > 15000 && // 15 秒冷却
                onStuck
              ) {
                stuckTriggeredRef.current = true;
                lastStuckTimestampRef.current = now;
                console.warn('[CameraStream] 卡关检测触发!');
                // 取缓冲区中最近 4 秒的帧
                const recent = frameBufferRef.current
                  .filter(e => e.timestamp > now - 5000);
                onStuck(recent);
              }

              // 掉落检测：Y 快速下降
              if (onFall) {
                const buf = frameBufferRef.current;
                if (buf.length >= 2 && !fallTriggeredRef.current) {
                  const prev = buf[buf.length - 2];
                  const curr = buf[buf.length - 1];
                  if (prev.hipCenterY >= 0 && curr.hipCenterY >= 0) {
                    const yDelta = curr.hipCenterY - prev.hipCenterY;
                    if (yDelta > FALL_Y_DROP) {
                      fallTriggeredRef.current = true;
                      console.warn('[CameraStream] 掉落检测触发! Y drop:', yDelta);
                      onFall(buf);
                    }
                  }
                }
                // 复位：如果用户重新上墙（姿态存在且 hip Y 回到高位置）
                if (fallTriggeredRef.current && currentHipY < 0.5) {
                  fallTriggeredRef.current = false;
                }
              }
            }
          } else {
            // 姿态丢失 → 可能刚落地
            const buf = frameBufferRef.current;
            if (
              !fallTriggeredRef.current &&
              buf.length > 3 &&
              lastHipYRef.current >= 0 &&
              onFall
            ) {
              const prevEntry = buf[buf.length - 1];
              if (prevEntry.hipCenterY >= 0) {
                const midIdx = Math.max(0, buf.length - 4);
                const midY = buf[midIdx].hipCenterY;
                const lastY = prevEntry.hipCenterY;
                if (lastY - midY > FALL_Y_DROP * 0.8) {
                  fallTriggeredRef.current = true;
                  console.warn('[CameraStream] 姿态丢失+向下趋势 → 掉落');
                  onFall(buf);
                }
              }
            }
          }
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.warn('[PoseEngine] 初始化失败，仅使用 AI 视觉分析:', err);
      }
    }

    startDetection();

    return () => {
      poseActiveRef.current = false;
      cancelAnimationFrame(rafId);
    };
  }, [onPoseMarkers, onStuck, onFall]);

  // ─── 截帧分析（帧 + 骨骼 + 手势）─────────────────────────
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const scale = Math.min(1280 / (video.videoWidth || 1280), 720 / (video.videoHeight || 720));
    canvas.width = Math.round((video.videoWidth || 1280) * scale);
    canvas.height = Math.round((video.videoHeight || 720) * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 岩点轮廓描边增强（帮助 AI 看清岩点边界）
    try {
      applyContourOverlay(canvas, 0.15, '#ff6600');
    } catch (_) { /* 轮廓增强失败不影响截帧 */ }

    let poseSnapshot = '';
    if (poseLandmarksRef.current.length > 0) {
      poseSnapshot = landmarksToSnapshot(poseLandmarksRef.current, canvas.width, canvas.height);
    }

    let handSnapshot = '';
    if (handResultsRef.current.length > 0) {
      handSnapshot = handLandmarksToSnapshot(handResultsRef.current as any, canvas.width, canvas.height);
    }

    onFrame(canvas, poseSnapshot, handSnapshot);
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
        className="w-full h-full object-contain"
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
