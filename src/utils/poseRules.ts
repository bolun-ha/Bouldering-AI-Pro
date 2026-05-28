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

  // ─── 1. 膝关节——降权处理（攀岩中挂脚/扭膝/Drop Knee 极度弯曲是高级技术）
  // 只检测极端膝内扣（> 100° 弯曲 + 明显内旋），避免误报 Drop Knee 等有效技术
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
      // 仅极端内扣触发（< 100° + 明显 z 轴内旋）
      if (kneeAngle < 100) {
        const inward = side === '左' ? k.z < h.z : k.z > h.z;
        if (inward) {
          markers.push({
            x: k.x * 100,
            y: k.y * 100,
            type: 'warning',
            label: `${side}膝内扣`,
            description: `${side}膝角 ${kneeAngle.toFixed(1)}° 且明显内旋。建议调整脚法，避免膝关节过度扭转。`,
          });
        }
      }
    }
  }

  // ─── 2. 肘部——删除单一角度检测，替换为「鸡翅膀（肘部外扩）」检测
  // 攀岩中折肘锁（lock-off）在屋檐/仰角墙上是标准技术
  // 真正的肘部 Error 是侧拉时肘关节向外支开，未内收夹紧，导致肩关节压力暴增
  // 不依赖臀部可见性（上肢检测 = 只看上肢）
  for (const [side, shoulder, elbow, wrist] of [
    ['左', LANDMARK.LEFT_SHOULDER, LANDMARK.LEFT_ELBOW, LANDMARK.LEFT_WRIST] as const,
    ['右', LANDMARK.RIGHT_SHOULDER, LANDMARK.RIGHT_ELBOW, LANDMARK.RIGHT_WRIST] as const,
  ]) {
    const s = get(shoulder);
    const e = get(elbow);
    const w = get(wrist);
    if (!s || !e || !w) continue;

    const elbowAngle = angleBetween(s, e, w);
    angleLogs.push(`${side}肘角=${elbowAngle.toFixed(1)}°`);

    // 鸡翅膀（Elbow Flaring）：肘部向外侧支开，比肩-手连线更远离身体中心
    // 侧拉时肘应指向身体/地面方向内收；肘向外支开 = 无效发力 + 肩峰撞击风险
    // 比对方法：肘关节 x 是否比肩和手腕中最内侧的点更"外侧"
    const innerPoint = side === '左'
      ? Math.min(s.x, w.x)   // 左臂：越小越外侧
      : Math.max(s.x, w.x);  // 右臂：越大越外侧
    const elbowOutside = side === '左'
      ? e.x < innerPoint - 0.04    // 肘比最内侧点还左 → 外扩
      : e.x > innerPoint + 0.04;   // 肘比最内侧点还右 → 外扩

    // 只在手臂有受力（手腕不在肩膀旁边：肘角 < 160° 表示手臂有折曲受力）
    // 抬手过顶（肘角 > 160°）时肘外扩是自然 relax 姿态，不算错误
    if (elbowOutside && elbowAngle < 155) {
      markers.push({
        x: e.x * 100,
        y: e.y * 100,
        type: 'error',
        label: `${side}肘外扩`,
        description: `${side}肘部向外支开（鸡翅膀），侧拉时未内收夹紧。建议肘关节指向身体发力，降低肩关节压力。`,
      });
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

    if (relDeviation > 0.45) {
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

  // ─── 4. 🥇 墙面距离（核心生命线）─────────────────────────────────
  // 攀岩铁律："屁股贴墙，省力一半"。臀部向后撅 → 核心崩溃 → 手臂代偿
  if (lHip && rHip) {
    const avgZ = (lHip.z + rHip.z) / 2;
    angleLogs.push(`臀深度z=${avgZ.toFixed(3)}`);
    // 正 z = 远离墙面（MediaPipe 深度坐标）
    if (avgZ > 0.12) {
      markers.push({
        x: ((lHip.x + rHip.x) / 2) * 100,
        y: ((lHip.y + rHip.y) / 2) * 100,
        type: 'error',
        label: '臀部远离墙面',
        description: '臀部距墙面过远，手臂在代偿核心发力。必须收紧核心，臀部贴墙！',
      });
    } else if (avgZ > 0.09) {
      markers.push({
        x: ((lHip.x + rHip.x) / 2) * 100,
        y: ((lHip.y + rHip.y) / 2) * 100,
        type: 'warning',
        label: '臀部远离墙面',
        description: '臀部距墙面较远，重心外移增加手臂负担。建议臀部贴近墙面收紧核心。',
      });
    }
  }
  // 用肩髋距离比替代耳朵/鼻子参考，不依赖面部器官，从背后也稳定
  // 原理：耸肩时肩膀上移，同侧肩髋距离增大 → 与另一侧的比例失衡
  // 不依赖臀部可见性：当臀不可见时，用双肩中点做 baseline 代替髋中点
  const lShoulderPt = get(LANDMARK.LEFT_SHOULDER);
  const rShoulderPt = get(LANDMARK.RIGHT_SHOULDER);
  if (lShoulderPt && rShoulderPt) {
    const lHipPt = get(LANDMARK.LEFT_HIP);
    const rHipPt = get(LANDMARK.RIGHT_HIP);
    const hipMidY = (lHipPt && rHipPt && lHipPt.visibility! > 0.3 && rHipPt.visibility! > 0.3)
      ? (lHipPt.y + rHipPt.y) / 2  // 髋可见 → 用髋中点（最准）
      : Math.max(lShoulderPt.y, rShoulderPt.y) + 0.15;  // 髋不可见 → 用肩下 15% 估测

    // 双肩各自到中点的垂直距离
    const lTorso = hipMidY - lShoulderPt.y;
    const rTorso = hipMidY - rShoulderPt.y;
    const avgTorso = (lTorso + rTorso) / 2;

    if (avgTorso > 0.02) {
      // 单侧耸肩：一侧肩髋距离显著大于另一侧
      for (const [side, torso, pt] of [
        ['左', lTorso, lShoulderPt] as const,
        ['右', rTorso, rShoulderPt] as const,
      ]) {
        if (torso > avgTorso * 1.3) {
          markers.push({
            x: pt.x * 100,
            y: pt.y * 100,
            type: 'warning',
            label: `${side}肩耸肩`,
            description: `${side}肩膀位置偏高，肩胛骨未下沉。建议沉肩收紧背肌，再发力移动。`,
          });
        }
      }

      // 双侧耸肩：平均肩髋距离异常大（参考：正常 ~0.08-0.12，耸肩 >0.16）
      if (avgTorso > 0.16 && markers.length === 0) {
        markers.push({
          x: ((lShoulderPt.x + rShoulderPt.x) / 2) * 100,
          y: ((lShoulderPt.y + rShoulderPt.y) / 2) * 100,
          type: 'warning',
          label: '双侧耸肩',
          description: '双肩明显抬高，肩胛骨未下沉。建议沉肩收紧背肌，再发力移动。',
        });
      }
    }
  }

  // ─── 5. 核心 tension 检测 ────────────────────────────────────
  // 粗略判断：肩膀中点和髋中点的水平错位
  const lShoulder = get(LANDMARK.LEFT_SHOULDER);
  const rShoulder = get(LANDMARK.RIGHT_SHOULDER);
  if (lShoulder && rShoulder && lHip && rHip) {
    const shoulderCenterX = (lShoulder.x + rShoulder.x) / 2;
    const hipCenterX = (lHip.x + rHip.x) / 2;
    const coreTwist = Math.abs(shoulderCenterX - hipCenterX);
    angleLogs.push(`核心扭转=${(coreTwist * 100).toFixed(1)}%`);
    if (coreTwist > 0.10) {
      markers.push({
        x: ((lHip.x + rHip.x) / 2) * 100,
        y: ((lHip.y + rHip.y) / 2) * 100,
        type: 'warning',
        label: '核心未收紧',
        description: '肩髋错位明显，核心 tension 不足导致身体扭转。建议收紧腹横肌保持身体稳定。',
      });
    }
  }

  // ─── 6. 折腕（手腕内扣）───────────────────────────────────────
  // 抓点时手腕向手心方向弯折 → 腕关节承压极大，易扭伤/腱鞘炎
  // 检测：肘-腕-手指基底三点角度 < 140° = 手腕过度弯曲
  for (const [side, elbow, wrist, handTip] of [
    ['左', LANDMARK.LEFT_ELBOW, LANDMARK.LEFT_WRIST, LANDMARK.LEFT_INDEX] as const,
    ['右', LANDMARK.RIGHT_ELBOW, LANDMARK.RIGHT_WRIST, LANDMARK.RIGHT_INDEX] as const,
  ]) {
    const e = get(elbow);
    const w = get(wrist);
    const h = get(handTip);
    if (e && w && h) {
      const wristAngle = angleBetween(e, w, h);
      angleLogs.push(`${side}腕角=${wristAngle.toFixed(1)}°`);
      if (wristAngle < 140) {
        markers.push({
          x: w.x * 100,
          y: w.y * 100,
          type: 'warning',
          label: `${side}折腕`,
          description: `${side}手腕向手心弯折（${wristAngle.toFixed(0)}°），腕关节受力过大。建议保持手腕中立伸直，调整站位而非硬扭手腕。`,
        });
      }
    }
  }

  // ─── 7. 只用脚尖踮踩 ──────────────────────────────────────────
  // 脚跟抬起过高，只有脚尖搭岩点 → 发力不稳易打滑
  // 检测：脚跟 y > 脚趾 y（脚跟比脚尖高），差值 > 3% 帧高
  for (const [side, heel, footIdx] of [
    ['左', LANDMARK.LEFT_HEEL, LANDMARK.LEFT_FOOT_INDEX] as const,
    ['右', LANDMARK.RIGHT_HEEL, LANDMARK.RIGHT_FOOT_INDEX] as const,
  ]) {
    const he = get(heel);
    const fi = get(footIdx);
    if (he && fi) {
      const tiptoe = fi.y - he.y; // 正 = 脚跟高于脚尖
      if (tiptoe > 0.03) {
        markers.push({
          x: fi.x * 100,
          y: fi.y * 100,
          type: 'warning',
          label: `${side}脚尖踮踩`,
          description: `${side}脚跟抬起过高，仅脚尖搭点。建议全脚掌/前脚掌踏实，脚跟下沉让岩鞋橡胶贴合岩面。`,
        });
      }
    }
  }

  // ─── 8. 身体外仰（胸口远离岩壁）─────────────────────────────
  // 胯部向后撅、胸口远离岩壁 → 全身重量压在手臂，小臂爆力
  // 检测：肩 z 比髋 z 明显更靠前（接近摄像头）= 上半身后仰
  if (lShoulder && rShoulder && lHip && rHip) {
    const avgShoulderZ = (lShoulder.z + rShoulder.z) / 2;
    const avgHipZ = (lHip.z + rHip.z) / 2;
    const leanZ = avgShoulderZ - avgHipZ;
    angleLogs.push(`身体仰角z=${leanZ.toFixed(3)}`);
    if (leanZ > 0.06) {
      markers.push({
        x: ((lShoulder.x + rShoulder.x) / 2) * 100,
        y: ((lShoulder.y + rShoulder.y) / 2) * 100,
        type: 'error',
        label: '身体外仰',
        description: '上半身后仰远离岩壁，全身重量压在手臂。建议胯贴墙面，把体重转移到腿上。',
      });
    }
  }

  // ─── 9. 手臂锁弯（全程不放松）─────────────────────────────
  // 双肘同时弯曲 > 硬拉型爬法，手臂肌群无法休息
  // 检测：双肘角同时 < 150° = 一直挂在手臂上
  const lElbowPt = get(LANDMARK.LEFT_ELBOW);
  const rElbowPt = get(LANDMARK.RIGHT_ELBOW);
  const lWristPt = get(LANDMARK.LEFT_WRIST);
  const rWristPt = get(LANDMARK.RIGHT_WRIST);
  if (lShoulderPt && rShoulderPt && lElbowPt && rElbowPt && lWristPt && rWristPt) {
    const lElbAng = angleBetween(lShoulderPt, lElbowPt, lWristPt);
    const rElbAng = angleBetween(rShoulderPt, rElbowPt, rWristPt);
    angleLogs.push(`左肘角=${lElbAng.toFixed(1)}° 右肘角=${rElbAng.toFixed(1)}° 双肘锁=${lElbAng < 150 && rElbAng < 150 ? '是' : '否'}`);
    if (lElbAng < 150 && rElbAng < 150) {
      markers.push({
        x: ((lElbowPt.x + rElbowPt.x) / 2) * 100,
        y: ((lElbowPt.y + rElbowPt.y) / 2) * 100,
        type: 'warning',
        label: '手臂锁弯',
        description: '双肘同时弯曲，靠手臂拉拽发力。建议蹬腿推起身体，手臂尽量伸直放松卸力。',
      });
    }
  }

  // ─── 10. 限制最大显示标注数 ────────────────────────────────────
  // 手机屏幕小，标注太多反而看不清。策略：最多 2 个，error 优先
  const MAX_MARKERS = 2;
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
