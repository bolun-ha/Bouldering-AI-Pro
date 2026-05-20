/**
 * MediaPipe Pose 引擎
 * 加载 PoseLandmarker 模型，在浏览器端本地实时检测人体骨骼点
 */
import { PoseLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';

// 骨骼点索引常量
export const LANDMARK = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
} as const;

export interface PoseResult {
  /** 33 个归一化骨骼点 [0-32] */
  landmarks: NormalizedLandmark[];
  /** 检测置信度 */
  score: number;
}

let poseLandmarker: PoseLandmarker | null = null;
let loadingPromise: Promise<void> | null = null;

/** 初始化 PoseLandmarker（仅首次调用时下载模型，后续复用） */
export async function initPoseEngine(): Promise<void> {
  if (poseLandmarker) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
      );
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      console.log('[PoseEngine] 模型加载完成');
    } catch (err) {
      console.error('[PoseEngine] 模型加载失败:', err);
      loadingPromise = null;
      throw err;
    }
  })();

  return loadingPromise;
}

/** 在视频帧上运行姿态检测，返回 33 个骨骼点 */
export function detectPose(
  video: HTMLVideoElement,
  timestamp: number,
): PoseResult | null {
  if (!poseLandmarker || !video || video.readyState < 2) return null;

  try {
    const result = poseLandmarker.detectForVideo(video, timestamp);
    if (!result.landmarks || result.landmarks.length === 0) return null;

    const landmarks = result.landmarks[0];
    const score = (result.landmarks[0] as any).score ?? 1.0;

    return { landmarks, score };
  } catch (err) {
    // 静默跳过检测失败的帧
    return null;
  }
}

/** 计算关节角度（度数），三点：A-B-C，顶点在 B */
export function angleBetween(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark,
): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };

  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

  if (mag1 === 0 || mag2 === 0) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.acos(cos) * (180 / Math.PI);
}

/** 计算两点间距离（归一化坐标空间） */
export function distance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2,
  );
}

/** 获取骨骼点快照（用于传给 AI 增强 prompt） */
export function landmarksToSnapshot(
  landmarks: NormalizedLandmark[],
  videoWidth: number,
  videoHeight: number,
): string {
  const parts: string[] = [];
  const add = (idx: number, label: string) => {
    const l = landmarks[idx];
    if (l && l.visibility !== undefined && l.visibility > 0.3) {
      parts.push(
        `${label} (${(l.x * videoWidth).toFixed(0)}, ${(l.y * videoHeight).toFixed(0)})`,
      );
    }
  };

  add(LANDMARK.NOSE, '鼻');
  add(LANDMARK.LEFT_SHOULDER, '左肩'); add(LANDMARK.RIGHT_SHOULDER, '右肩');
  add(LANDMARK.LEFT_ELBOW, '左肘'); add(LANDMARK.RIGHT_ELBOW, '右肘');
  add(LANDMARK.LEFT_WRIST, '左手腕'); add(LANDMARK.RIGHT_WRIST, '右手腕');
  add(LANDMARK.LEFT_HIP, '左髋'); add(LANDMARK.RIGHT_HIP, '右髋');
  add(LANDMARK.LEFT_KNEE, '左膝'); add(LANDMARK.RIGHT_KNEE, '右膝');
  add(LANDMARK.LEFT_ANKLE, '左踝'); add(LANDMARK.RIGHT_ANKLE, '右踝');
  add(LANDMARK.LEFT_HEEL, '左脚跟'); add(LANDMARK.RIGHT_HEEL, '右脚跟');
  add(LANDMARK.LEFT_FOOT_INDEX, '左脚尖'); add(LANDMARK.RIGHT_FOOT_INDEX, '右脚尖');

  return parts.join(', ');
}

/** 释放引擎 */
export function closePoseEngine(): void {
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
  }
  loadingPromise = null;
}
