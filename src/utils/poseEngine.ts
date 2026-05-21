/**
 * MediaPipe Pose + Hands 引擎
 * 加载 PoseLandmarker + HandLandmarker 模型，在浏览器端实时检测骨骼+手势
 */
import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

// ─── 身体骨骼点索引 ──────────────────────────────────────────
export const LANDMARK = {
  NOSE: 0, LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8, MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
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

// ─── 手部关键点索引（每只手 21 个）─────────────────────────
export const HAND = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
} as const;

export interface PoseResult {
  landmarks: NormalizedLandmark[];
  score: number;
}

export interface HandResult {
  landmarks: NormalizedLandmark[];  // 21 个关键点
  handedness: 'Left' | 'Right';
  score: number;
}

export interface GripType {
  /** 抓握类型 */
  type: 'crimp' | 'pinch' | 'open' | 'sloper' | 'unknown';
  /** 置信度 0-1 */
  confidence: number;
  /** 手指屈曲角平均值 */
  curlAngle: number;
}

let poseLandmarker: PoseLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;
let loadingPromise: Promise<void> | null = null;
let handLoadingPromise: Promise<void> | null = null;

/** 初始化 PoseLandmarker */
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
      console.log('[PoseEngine] PoseLandmarker 加载完成');
    } catch (err) {
      console.error('[PoseEngine] PoseLandmarker 加载失败:', err);
      loadingPromise = null;
      throw err;
    }
  })();

  return loadingPromise;
}

/** 初始化 HandLandmarker */
export async function initHandEngine(): Promise<void> {
  if (handLandmarker) return;
  if (handLoadingPromise) return handLoadingPromise;

  handLoadingPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
      );
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/hand_landmarker.task', // 本地托管，不受 CDN 封锁影响
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        numHands: 2,
      });
      console.log('[PoseEngine] HandLandmarker 加载完成');
    } catch (err) {
      console.error('[PoseEngine] HandLandmarker 加载失败:', err);
      handLoadingPromise = null;
      throw err;
    }
  })();

  return handLoadingPromise;
}

/** 同时初始化 Pose + Hands */
export async function initAllEngines(): Promise<void> {
  await Promise.all([initPoseEngine(), initHandEngine()]);
}

// ─── 姿态检测 ──────────────────────────────────────────────────

export function detectPose(
  video: HTMLVideoElement,
  timestamp: number,
): PoseResult | null {
  if (!poseLandmarker || !video || video.readyState < 2) return null;
  try {
    const result = poseLandmarker.detectForVideo(video, timestamp);
    if (!result.landmarks || result.landmarks.length === 0) return null;
    return {
      landmarks: result.landmarks[0],
      score: (result.landmarks[0] as any).score ?? 1.0,
    };
  } catch {
    return null;
  }
}

// ─── 手势检测 ──────────────────────────────────────────────────

export function detectHands(
  video: HTMLVideoElement,
  timestamp: number,
): HandResult[] {
  if (!handLandmarker || !video || video.readyState < 2) return [];
  try {
    const result = handLandmarker.detectForVideo(video, timestamp);
    if (!result.landmarks || result.landmarks.length === 0) return [];
    return result.landmarks.map((lm, i) => ({
      landmarks: lm,
      handedness: (result.handedness?.[i]?.[0]?.categoryName as 'Left' | 'Right') || 'Left',
      score: lm[0].visibility ?? 1.0,
    }));
  } catch {
    return [];
  }
}

// ─── 关节角计算 ──────────────────────────────────────────────

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

/** 计算两点间距离 */
export function distance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2,
  );
}

// ─── 抓握类型识别 ──────────────────────────────────────────

/**
 * 从手部 21 个关键点识别抓握类型
 */
export function detectGripType(hand: NormalizedLandmark[]): GripType {
  const get = (idx: number) => hand[idx];
  if (!get(HAND.INDEX_TIP) || !get(HAND.WRIST)) {
    return { type: 'unknown', confidence: 0, curlAngle: 0 };
  }

  // 计算 4 根手指的屈曲角：MCP→PIP→TIP
  const fingerAngles = [
    { mcp: HAND.INDEX_MCP, pip: HAND.INDEX_PIP, tip: HAND.INDEX_TIP },
    { mcp: HAND.MIDDLE_MCP, pip: HAND.MIDDLE_PIP, tip: HAND.MIDDLE_TIP },
    { mcp: HAND.RING_MCP, pip: HAND.RING_PIP, tip: HAND.RING_TIP },
    { mcp: HAND.PINKY_MCP, pip: HAND.PINKY_PIP, tip: HAND.PINKY_TIP },
  ];

  const curls = fingerAngles.map(({ mcp, pip, tip }) => {
    const a = get(mcp), b = get(pip), c = get(tip);
    if (!a || !b || !c) return 0;
    // PIP 关节角 < 90° = 屈曲很深，> 150° = 接近伸直
    return Math.min(180, angleBetween(a, b, c));
  });

  const avgCurl = curls.reduce((s, v) => s + v, 0) / curls.length;

  // 拇指 vs 食指距离（判断 pinch）
  const thumbTip = get(HAND.THUMB_TIP);
  const indexTip = get(HAND.INDEX_TIP);
  const thumbIndexDist = thumbTip && indexTip ? distance(thumbTip, indexTip) : 1;

  // 手指间距（判断 sloper — 手指并拢）
  const midTip = get(HAND.MIDDLE_TIP);
  const ringTip = get(HAND.RING_TIP);
  const fingerSpread = midTip && ringTip ? distance(midTip, ringTip) : 0;

  // ── 抓握类型判定 ──
  // crimp: 手指深屈（curl < 90°），指尖接近手掌
  if (avgCurl < 90) {
    return { type: 'crimp', confidence: Math.max(0, 1 - avgCurl / 90), curlAngle: avgCurl };
  }

  // pinch: 拇指与食指间距小（捏），curl 中等
  if (thumbIndexDist < 0.06) {
    return { type: 'pinch', confidence: Math.max(0, 1 - thumbIndexDist / 0.06), curlAngle: avgCurl };
  }

  // sloper: 手指并拢 + 轻度屈曲
  if (fingerSpread < 0.02 && avgCurl > 90 && avgCurl < 140) {
    return { type: 'sloper', confidence: Math.max(0, 1 - fingerSpread / 0.02), curlAngle: avgCurl };
  }

  // open: 手指伸直 + 自然张开
  if (avgCurl >= 140) {
    return { type: 'open', confidence: Math.min(1, (avgCurl - 140) / 40), curlAngle: avgCurl };
  }

  return { type: 'unknown', confidence: 0.5, curlAngle: avgCurl };
}

// ─── 骨骼坐标序列化 ──────────────────────────────────────────

/** 身体骨骼点快照 */
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

/** 手部关键点快照（供 AI 分析使用） */
export function handLandmarksToSnapshot(
  hands: HandResult[],
  videoWidth: number,
  videoHeight: number,
): string {
  if (hands.length === 0) return '';
  return hands.map((hand) => {
    const lm = hand.landmarks;
    const grip = detectGripType(lm);
    const wrist = lm[HAND.WRIST];
    const tip = lm[HAND.INDEX_TIP];
    if (!wrist || !tip) return '';
    const side = hand.handedness === 'Left' ? '左手' : '右手';
    const wx = (wrist.x * videoWidth).toFixed(0);
    const wy = (wrist.y * videoHeight).toFixed(0);
    const tx = (tip.x * videoWidth).toFixed(0);
    const ty = (tip.y * videoHeight).toFixed(0);
    return `${side}腕(${wx},${wy})食指尖(${tx},${ty})抓握=${grip.type}(置信${(grip.confidence * 100).toFixed(0)}%)`;
  }).filter(Boolean).join('; ');
}

// ─── 手到最近岩点的距离分析 ──────────────────────────────────

export interface HoldDistance {
  hand: 'left' | 'right';
  handPos: { x: number; y: number };
  grip: GripType;
  nearestHoldIdx: number;
  distance: number; // 归一化距离
  isOnHold: boolean; // 距离 < 阈值
}

/**
 * 计算手到岩点的距离
 * @param hands MediaPipe 手部结果
 * @param holdPositions AI 检测出的岩点坐标（百分比 0-100）
 * @param videoWidth 视频宽度（像素）
 * @param videoHeight 视频高度（像素）
 */
export function computeHoldDistances(
  hands: HandResult[],
  holdPositions: { x: number; y: number; color?: string; type?: string }[],
  videoWidth: number,
  videoHeight: number,
): HoldDistance[] {
  if (hands.length === 0 || holdPositions.length === 0) return [];

  return hands.map((hand) => {
    const wrist = hand.landmarks[HAND.WRIST];
    const indexTip = hand.landmarks[HAND.INDEX_TIP];
    if (!wrist || !indexTip) return null;

    // 以食指尖为手部位置
    const hx = indexTip.x * 100; // 转换为百分比 0-100（与 hold_positions 单位一致）
    const hy = indexTip.y * 100;

    let minDist = Infinity;
    let minIdx = -1;
    holdPositions.forEach((h, i) => {
      const dx = hx - h.x;
      const dy = hy - h.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    });

    const grip = detectGripType(hand.landmarks);
    // 阈值：手握岩点约 8% 的归一化距离（对应 ~60px at 720p 视频）
    const threshold = 8;
    const isOnHold = minDist <= threshold;

    return {
      hand: hand.handedness === 'Left' ? 'left' as const : 'right' as const,
      handPos: { x: hx, y: hy },
      grip,
      nearestHoldIdx: minIdx,
      distance: minDist,
      isOnHold,
    };
  }).filter((d): d is HoldDistance => d !== null);
}

// ─── 释放 ──────────────────────────────────────────────────────

export function closePoseEngine(): void {
  if (poseLandmarker) {
    poseLandmarker.close();
    poseLandmarker = null;
  }
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
  loadingPromise = null;
  handLoadingPromise = null;
}
