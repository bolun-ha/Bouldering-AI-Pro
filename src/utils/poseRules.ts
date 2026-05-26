/**
 * 骨骼点规则引擎
 * 根据 MediaPipe 33 个骨骼点坐标，计算关节角 → 检测常见攀爬错误
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Marker } from '../types';
import { LANDMARK, angleBetween, distance } from './poseEngine';

export interface RuleResult {
  markers: Marker[];
  /** 关节角快照（供 AI prompt 使用） */
  angles: string;
}

/**
 * 从 33 个骨骼点提取攀爬姿态分析标记
 */
export function analyzePose(landmarks: NormalizedLandmark[]): RuleResult {
  const markers: Marker[] = [];
  const angleLogs: string[] = [];

  const get = (idx: number): NormalizedLandmark | null =>
    landmarks[idx] && landmarks[idx].visibility !== undefined && landmarks[idx].visibility! > 0.3
      ? landmarks[idx]
      : null;

  // ─── 左右通用辅助 ─────────────────────────────────────────────
  const checkSymmetrical = (
    label: string,
    leftIdx: number,
    rightIdx: number,
    reason: (l: NormalizedLandmark, r: NormalizedLandmark) => string | null,
    type: 'error' | 'warning' = 'warning',
  ) => {
    const l = get(leftIdx);
    const r = get(rightIdx);
    if (!l || !r) return;
    for (const [side, pt, idx] of [['左', l, leftIdx] as const, ['右', r, rightIdx] as const]) {
      const desc = reason(l, r);
      if (desc) {
        markers.push({
          x: pt.x * 100,
          y: pt.y * 100,
          type,
          label: `${side}${label}`,
          description: desc,
        });
      }
    }
  };

  // ─── 1. 膝关节角度（膝盖内扣检测）─────────────────────────────
  for (const [side, hip, knee, ankle] of [
    ['左', LANDMARK.LEFT_HIP, LANDMARK.LEFT_KNEE, LANDMARK.LEFT_ANKLE] as const,
    ['右', LANDMARK.RIGHT_HIP, LANDMARK.RIGHT_KNEE, LANDMARK.RIGHT_ANKLE] as const,
  ]) {
    const h = get(hip);
    const k = get(knee);
    const a = get(ankle);
    if (h && k && a) {
      const kneeAngle = angleBetween(h, k, a);
      angleLogs.push(`${side}膝角=${kneeAngle.toFixed(1)}°`);
      // 膝角 < 150° 且 脚在髋外侧（踩高脚点）→ 可能内扣，检查 z 轴
      if (kneeAngle < 150) {
        // 膝盖向内偏移（z 值负方向）
        const inward = side === '左' ? k.z < h.z : k.z > h.z;
        if (inward && kneeAngle < 140) {
          markers.push({
            x: k.x * 100,
            y: k.y * 100,
            type: 'error',
            label: `${side}膝盖内扣`,
            description: `${side}膝角 ${kneeAngle.toFixed(1)}°，膝盖明显内旋。建议外旋髋关节使膝盖朝前，降低重心。`,
          });
        } else if (inward) {
          markers.push({
            x: k.x * 100,
            y: k.y * 100,
            type: 'warning',
            label: `${side}膝角偏小`,
            description: `${side}膝角 ${kneeAngle.toFixed(1)}°，注意不要过度内旋。`,
          });
        }
      }
    }
  }

  // ─── 2. 肘关节角度（手臂锁死检测）─────────────────────────────
  for (const [side, shoulder, elbow, wrist] of [
    ['左', LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_ELBOW, LANDMARK.LEFT_WRIST] as const,
    ['右', LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_ELBOW, LANDMARK.RIGHT_WRIST] as const,
  ]) {
    const s = get(shoulder);
    const e = get(elbow);
    const w = get(wrist);
    if (s && e && w) {
      const elbowAngle = angleBetween(s, e, w);
      angleLogs.push(`${side}肘角=${elbowAngle.toFixed(1)}°`);
      if (elbowAngle > 150) {
        markers.push({
          x: e.x * 100,
          y: e.y * 100,
          type: 'warning',
          label: `${side}手臂锁死`,
          description: `${side}肘角 ${elbowAngle.toFixed(1)}°（>150°），手臂接近伸直。建议放松手臂，多用腿力支撑。`,
        });
      }
    }
  }

  // ─── 3. 重心偏移检测 ──────────────────────────────────────────
  const lHip = get(LANDMARK.LEFT_HIP);
  const rHip = get(LANDMARK.RIGHT_HIP);
  const lAnkle = get(LANDMARK.LEFT_ANKLE);
  const rAnkle = get(LANDMARK.RIGHT_ANKLE);

  if (lHip && rHip && lAnkle && rAnkle) {
    // 重心（左右髋中点）
    const centerX = (lHip.x + rHip.x) / 2;
    const centerY = (lHip.y + rHip.y) / 2;

    // 支撑面（左右脚踝之间）
    const stanceMin = Math.min(lAnkle.x, rAnkle.x);
    const stanceMax = Math.max(lAnkle.x, rAnkle.x);
    const stanceWidth = stanceMax - stanceMin;

    // 重心水平偏移
    const deviation = Math.abs(centerX - (lAnkle.x + rAnkle.x) / 2);
    const relDeviation = stanceWidth > 0 ? deviation / stanceWidth : 1;

    angleLogs.push(`重心x=${(centerX * 100).toFixed(1)}%, 支撑面宽=${(stanceWidth * 100).toFixed(1)}%, 偏移比=${relDeviation.toFixed(2)}`);

    if (relDeviation > 0.4) {
      // 重心偏向一边
      const side = centerX < (lAnkle.x + rAnkle.x) / 2 ? '左' : '右';
      markers.push({
        x: centerX * 100,
        y: centerY * 100,
        type: 'error',
        label: `重心偏${side}`,
        description: `重心偏向${side}侧（偏移比 ${(relDeviation * 100).toFixed(0)}%），超出支撑面稳定范围。建议向${side === '左' ? '右' : '左'}调整重心，臀部贴近墙面。`,
      });
    }
  }

  // ─── 4. 肩部耸肩检测 ──────────────────────────────────────────
  const nose = get(LANDMARK.NOSE);
  for (const [side, shoulder] of [
    ['左', LANDMARK.LEFT_SHOULDER] as const,
    ['右', LANDMARK.RIGHT_SHOULDER] as const,
  ]) {
    const s = get(shoulder);
    if (s && nose) {
      // 耸肩简单判断：肩膀 y 坐标接近或高于鼻尖 y（正常应明显低于鼻尖）
      if (s.y < nose.y + 0.05) {
        markers.push({
          x: s.x * 100,
          y: s.y * 100,
          type: 'warning',
          label: `${side}肩耸肩`,
          description: `${side}肩膀位置偏高，肩胛骨未下沉。建议沉肩收紧背肌，再发力移动。`,
        });
      }
    }
  }

  // ─── 5. 身体与墙面距离估算 ────────────────────────────────────
  // 通过髋关节 z 值（相对深度）估算
  if (lHip && rHip) {
    const avgZ = (lHip.z + rHip.z) / 2;
    angleLogs.push(`臀深度z=${avgZ.toFixed(3)}`);
    // 正 z 表示远离墙（MediaPipe 坐标系统）
    if (avgZ > 0.07) {
      markers.push({
        x: ((lHip.x + rHip.x) / 2) * 100,
        y: ((lHip.y + rHip.y) / 2) * 100,
        type: 'warning',
        label: '臀部远离墙面',
        description: '臀部距墙面较远，重心外移增加手臂负担。建议臀部贴近墙面收紧核心。',
      });
    }
  }

  // ─── 6. 核心 tension 检测 ────────────────────────────────────
  // 粗略判断：肩膀中点和髋中点的水平错位
  const lShoulder = get(LANDMARK.LEFT_SHOULDER);
  const rShoulder = get(LANDMARK.RIGHT_SHOULDER);
  if (lShoulder && rShoulder && lHip && rHip) {
    const shoulderCenterX = (lShoulder.x + rShoulder.x) / 2;
    const hipCenterX = (lHip.x + rHip.x) / 2;
    const coreTwist = Math.abs(shoulderCenterX - hipCenterX);
    angleLogs.push(`核心扭转=${(coreTwist * 100).toFixed(1)}%`);
    if (coreTwist > 0.06) {
      markers.push({
        x: ((lHip.x + rHip.x) / 2) * 100,
        y: ((lHip.y + rHip.y) / 2) * 100,
        type: 'warning',
        label: '核心未收紧',
        description: '肩髋错位明显，核心 tension 不足导致身体扭转。建议收紧腹横肌保持身体稳定。',
      });
    }
  }

  // ─── 7. 限制最大显示标注数 ─────────────────────────────────────
  // 手机屏幕小，标注太多反而看不清。策略：最多 4 个，error 优先 + warning 补满
  const MAX_MARKERS = 4;
  const errors = markers.filter(m => m.type === 'error');
  const warnings = markers.filter(m => m.type === 'warning');

  // 去重：同一身体部位产出的同类型标注只保留第一个
  const dedupedWarnings: Marker[] = [];
  const seenLabels = new Set(errors.map(m => m.label));
  for (const w of warnings) {
    if (!seenLabels.has(w.label)) {
      dedupedWarnings.push(w);
      seenLabels.add(w.label);
    }
  }

  const finalMarkers: Marker[] = [];
  // 先填 error
  for (const e of errors) {
    if (finalMarkers.length >= MAX_MARKERS) break;
    finalMarkers.push(e);
  }
  // 再填 warning 补满
  for (const w of dedupedWarnings) {
    if (finalMarkers.length >= MAX_MARKERS) break;
    finalMarkers.push(w);
  }

  return {
    markers: finalMarkers,
    angles: angleLogs.join(', '),
  };
}
