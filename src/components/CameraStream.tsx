/**
 * CameraStream — 摄像头画面 + 骨骼标注 + 卡关/掉落检测
 *
 * 职责：
 * 1. 打开摄像头
 * 2. 实时三角形标注（手腕+脚踝支撑三点）
 * 3. 按间隔截帧（~2s）传给 AI 分析（含骨骼+手势数据）
 * 4. 运行 MediaPipe Pose(~15fps) + Hands(~10fps)
 * 5. 规则引擎实时输出姿态标记
 * 6. 帧缓冲区（持续保存最近帧 + 骨骼数据）
 * 7. 卡关检测（3秒无纵向位移）和掉落检测
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
import type { Marker, HandResult } from '../types';

// 临时 HandResult 类型，避免跨文件依赖
interface HandRes {
  landmarks: NormalizedLandmark[];
  handedness: 'Left' | 'Right';
  score: number;
}

interface CameraStreamProps {
  onFrame: (canvas: HTMLCanvasElement, poseSnapshot: string, handSnapshot: string) => void;
  /** 实时姿态标记回调（MediaPipe 规则引擎输出） */
  onPoseMarkers?: (markers: Marker[], landmarks: NormalizedLandmark[], hands?: HandRes[]) => void;
  /** 卡关时触发：传入缓冲区帧供 AI 分析 */
  onStuck?: (buffer: FrameBufferEntry[]) => void;
  /** 掉落时触发：传入缓冲区帧供自动复盘 */
  onFall?: (buffer: FrameBufferEntry[]) => void;
  isRecording: boolean;
  captureInterval?: number;
  onError?: (error: string) => void;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

// ─── 帧缓冲区条目 ────────────────────────────────────────────
interface FrameBufferEntry {
  timestamp: number;
  base64: string;
  poseSnapshot: string;
  handSnapshot: string;
  /** 髋部中心 Y 坐标（归一化 0-1） */
  hipCenterY: number;
}

// ─── 人体合理性校验 ──────────────────────────────────────────
function isBodyPlausible(lm: NormalizedLandmark[]): boolean {
  if (lm.length < 33) return false;

  const sL = lm[LANDMARK.LEFT_SHOULDER];
  const sR = lm[LANDMARK.RIGHT_SHOULDER];
  if (!sL || !sR || (sL.visibility !== undefined && sL.visibility < 0.5)) return false;

  const sWidth = Math.abs(sL.x - sR.x);
  if (sWidth < 0.05 || sWidth > 0.50) return false;

  const hL = lm[LANDMARK.LEFT_HIP];
  const hR = lm[LANDMARK.RIGHT_HIP];
  if (hL && hR && hL.visibility !== undefined && hL.visibility >= 0.5) {
    const hWidth = Math.abs(hL.x - hR.x);
    if (hWidth < 0.03 || hWidth > 0.50 || hWidth / sWidth > 2) return false;
  }

  const nose = lm[LANDMARK.NOSE];
  if (nose && nose.visibility !== undefined && nose.visibility >= 0.5) {
    const ankleL = lm[LANDMARK.LEFT_ANKLE];
    const ankleR = lm[LANDMARK.RIGHT_ANKLE];
    const ankleY = Math.min(
      ankleL && ankleL.y < 1 ? ankleL.y : 99,
      ankleR && ankleR.y < 1 ? ankleR.y : 99,
    );
    if (ankleY < 1) {
      const bodyH = ankleY - nose.y;
      if (bodyH < 0.20 || bodyH > 0.95) return false;
    }
  }

  return true;
}

// ─── 坐标校正（object-cover 缩放适配） ──────────────────────
function adjustCoords(video: HTMLVideoElement, x: number, y: number): { x: number; y: number } {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = video.offsetWidth, ch = video.offsetHeight;
  if (!vw || !vh || !cw || !ch) return { x, y };
  const vAR = vw / vh;
  const cAR = cw / ch;
  let adjX = x, adjY = y;
  if (vAR > cAR) {
    const visibleRatio = cAR / vAR;
    const cropStart = (1 - visibleRatio) / 2;
    adjX = Math.max(0, Math.min(1, (x - cropStart) / visibleRatio));
    adjY = y;
  } else {
    const visibleRatio = vAR / cAR;
    const cropStart = (1 - visibleRatio) / 2;
    adjY = Math.max(0, Math.min(1, (y - cropStart) / visibleRatio));
    adjX = x;
  }
  return { x: adjX, y: adjY };
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
  const canvasRef = useRef<HTMLCanvasElement>(null);          // 隐藏截帧画布
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);   // 可见三角形标注画布
  const poseLandmarksRef = useRef<NormalizedLandmark[]>([]);
  const handResultsRef = useRef<HandRes[]>([]);
  const poseActiveRef = useRef(false);

  // ─── 帧缓冲区 ──────────────────────────────────────────────
  const frameBufferRef = useRef<FrameBufferEntry[]>([]);
  const STUCK_Y_THRESHOLD = 0.008; // Y 轴变化 < 0.8% 视为静止
  const STUCK_TIME_MS = 3000;      // 持续 3 秒视为卡关
  const FALL_Y_DROP = 0.15;        // Y 快速下降 > 15%
  const FALL_MAX_SANE = 0.5;       // 单帧 Y 下降 > 50% → 姿态突变（挂脚/倒吊），非掉落
  const lastHipYRef = useRef(-1);
  const lastMoveTimeRef = useRef(Date.now());
  const stuckTriggeredRef = useRef(false);
  const lastStuckTimestampRef = useRef(0);

  // ─── 摄像头初始化 ──────────────────────────────────────────
  useEffect(() => {
    async function setupCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          const isHttps = window.location.protocol === 'https:';
          const msg = isHttps
            ? '您的浏览器不支持摄像头访问'
            : '摄像头需要 HTTPS 安全环境才能访问';
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
            msg = '摄像头权限被拒绝。请在浏览器设置中允许摄像头访问。';
          } else if (msg.includes('NotFoundError')) {
            msg = '未检测到摄像头设备。';
          } else if (msg.includes('NotReadableError')) {
            msg = '摄像头被其他应用占用。';
          }
          onError(msg);
        }
      }
    }
    setupCamera();
  }, [onError, onVideoReady]);

  // ─── 绘制支撑三角形标注（旧版风格：仅红色三角 + 红色/白色圆点） ──
  const drawTriangle = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const parent = canvas.parentElement;
    if (parent && (canvas.width !== parent.clientWidth || canvas.height !== parent.clientHeight)) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lm = poseLandmarksRef.current;
    if (lm.length < 33) return;
    const cW = canvas.width;
    const cH = canvas.height;

    const lWrist = lm[LANDMARK.LEFT_WRIST];
    const rWrist = lm[LANDMARK.RIGHT_WRIST];
    const lAnkle = lm[LANDMARK.LEFT_ANKLE];
    const rAnkle = lm[LANDMARK.RIGHT_ANKLE];
    if (!lWrist || !rWrist || !lAnkle || !rAnkle) return;

    const vis = (l: NormalizedLandmark) => l.visibility === undefined || l.visibility! > 0.3;
    const lwOk = vis(lWrist), rwOk = vis(rWrist);
    const laOk = vis(lAnkle), raOk = vis(rAnkle);
    if (!lwOk && !rwOk && !laOk && !raOk) return;

    const wristMid = { x: (lWrist.x + rWrist.x) / 2, y: (lWrist.y + rWrist.y) / 2 };
    const ankleMid = { x: (lAnkle.x + rAnkle.x) / 2, y: (lAnkle.y + rAnkle.y) / 2 };

    const tryCombos = (): { pts: { x: number; y: number }[] } | null => {
      if (lwOk && rwOk && laOk) return { pts: [lWrist, rWrist, lAnkle] };
      if (lwOk && rwOk && raOk) return { pts: [lWrist, rWrist, rAnkle] };
      if (lwOk && laOk && raOk) return { pts: [lWrist, lAnkle, rAnkle] };
      if (rwOk && laOk && raOk) return { pts: [rWrist, lAnkle, rAnkle] };
      if ((lwOk || rwOk) && laOk && raOk) {
        const h = lwOk && rwOk ? wristMid : (lwOk ? lWrist : rWrist);
        return { pts: [h, lAnkle, rAnkle] };
      }
      if (lwOk && rwOk && (laOk || raOk)) {
        const f = laOk && raOk ? ankleMid : (laOk ? lAnkle : rAnkle);
        return { pts: [lWrist, rWrist, f] };
      }
      return null;
    };

    const combo = tryCombos();
    if (!combo) return;

    const pts = combo.pts.map(p => {
      const { x, y } = adjustCoords(video, p.x, p.y);
      return { x: x * cW, y: y * cH };
    });

    ctx.strokeStyle = 'rgba(255, 40, 40, 0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.closePath();
    ctx.stroke();

    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3344';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, []);

  // ─── 髋部中心 Y 坐标 ─────────────────────────────────────
  const calcHipCenterY = useCallback((landmarks: NormalizedLandmark[]): number => {
    if (landmarks.length < 33) return -1;
    const lHip = landmarks[LANDMARK.LEFT_HIP];
    const rHip = landmarks[LANDMARK.RIGHT_HIP];
    if (lHip && rHip &&
      (lHip.visibility === undefined || lHip.visibility > 0.3) &&
      (rHip.visibility === undefined || rHip.visibility > 0.3)) {
      return (lHip.y + rHip.y) / 2;
    }
    return -1;
  }, []);

  // ─── 缓存一帧到缓冲区 ────────────────────────────────────
  const captureBufferFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = Math.round(320 / (video.videoWidth / video.videoHeight || 1));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.6);

    const poseStr = poseLandmarksRef.current.length > 0
      ? landmarksToSnapshot(poseLandmarksRef.current, canvas.width, canvas.height)
      : '';
    const handStr = handResultsRef.current.length > 0
      ? handLandmarksToSnapshot(handResultsRef.current as any, canvas.width, canvas.height)
      : '';

    const hipCenterY = poseLandmarksRef.current.length > 0
      ? calcHipCenterY(poseLandmarksRef.current) : -1;

    const entry: FrameBufferEntry = {
      timestamp: Date.now(),
      base64,
      poseSnapshot: poseStr,
      handSnapshot: handStr,
      hipCenterY,
    };
    frameBufferRef.current.push(entry);

    // 最多保留 5 秒（~75 帧 @15fps）
    const cutoff = Date.now() - 5000;
    frameBufferRef.current = frameBufferRef.current.filter(e => e.timestamp > cutoff);
  }, [calcHipCenterY]);

  // ─── MediaPipe Pose + Hands 检测循环 ──────────────────────
  useEffect(() => {
    let rafId = 0;
    let lastPoseTime = 0;
    let lastHandTime = 0;
    let lastBufferTime = 0;
    const poseInterval = 66;  // ~15fps
    const handInterval = 100; // ~10fps
    const bufferInterval = 66; // 同样 ~15fps 缓存

    async function startDetection() {
      try {
        await initAllEngines();
        poseActiveRef.current = true;

        const tick = (timestamp: number) => {
          if (!poseActiveRef.current) return;
          rafId = requestAnimationFrame(tick);

          const video = videoRef.current;
          if (!video || video.readyState < 2) return;

          // Pose 检测
          if (timestamp - lastPoseTime >= poseInterval) {
            lastPoseTime = timestamp;
            const poseRes = detectPose(video, timestamp);
            if (poseRes) {
              // 骨骼合理性校验：防止墙壁纹理误识别
              if (isBodyPlausible(poseRes.landmarks)) {
                poseLandmarksRef.current = poseRes.landmarks;
              } else {
                // 不合理帧保持上一帧有效数据
              }
            }
          }

          // Hand 检测
          let handsThisFrame: HandRes[] | undefined;
          if (timestamp - lastHandTime >= handInterval) {
            lastHandTime = timestamp;
            const handRes = detectHands(video, timestamp);
            handResultsRef.current = handRes as unknown as HandRes[];
            handsThisFrame = handRes.length > 0 ? (handRes as unknown as HandRes[]) : undefined;
          }

          // 绘制三角形标注
          drawTriangle();

          // 规则引擎 + 回调
          if (onPoseMarkers && poseLandmarksRef.current.length > 0) {
            const ruleResult = analyzePose(poseLandmarksRef.current);
            const adjusted = ruleResult.markers.map(m => {
              const { x, y } = adjustCoords(video, m.x / 100, m.y / 100);
              return { ...m, x: x * 100, y: y * 100 };
            });
            onPoseMarkers(adjusted, poseLandmarksRef.current, handsThisFrame);
          }

          // ── 帧缓存 + 卡关/掉落检测 ──────────────────────────
          if (timestamp - lastBufferTime >= bufferInterval) {
            lastBufferTime = timestamp;
            captureBufferFrame();

            if (poseLandmarksRef.current.length > 0) {
              const currentHipY = calcHipCenterY(poseLandmarksRef.current);
              if (currentHipY >= 0) {
                if (lastHipYRef.current >= 0) {
                  const now = Date.now();
                  const deltaY = Math.abs(currentHipY - lastHipYRef.current);

                  // 卡关检测
                  if (deltaY < STUCK_Y_THRESHOLD) {
                    // 持续静止
                    if (!stuckTriggeredRef.current && (now - lastMoveTimeRef.current) >= STUCK_TIME_MS) {
                      stuckTriggeredRef.current = true;
                      lastStuckTimestampRef.current = now;
                      if (onStuck) {
                        onStuck([...frameBufferRef.current]);
                      }
                    }
                  } else {
                    // 有移动 → 重置计时
                    lastMoveTimeRef.current = now;
                    stuckTriggeredRef.current = false;
                  }

                  // 掉落检测
                  if (deltaY > FALL_Y_DROP && deltaY < FALL_MAX_SANE) {
                    // Y 明显下降但没超过突变阈值 → 视作掉落
                    if (onFall) {
                      onFall([...frameBufferRef.current]);
                    }
                  }
                }
                lastHipYRef.current = currentHipY;
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
  }, [onPoseMarkers, drawTriangle, captureBufferFrame, calcHipCenterY, onStuck, onFall]);

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

    // 岩点轮廓描边增强
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
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 10 }}
      />
    </div>
  );
};
