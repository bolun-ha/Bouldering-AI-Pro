/**
 * 智能筛选关键帧：减少重复，保多样性
 *
 * 策略：
 * 1. 分出问题帧（有 error/warning）和干净帧（仅 success/info 或无标记）
 * 2. 按标记标签聚类，每种最多 2 帧
 * 3. 保证每种问题类型至少出现 1 帧
 * 4. 上限 12 帧 + 1 张好帧对照
 */
import type { HistoryEntry } from '../types';

interface ScoredFrame {
  entry: HistoryEntry;
  origIdx: number;
  severity: number;
  uniqueLabels: string[];
}

export function smartFilterSnapshots(history: HistoryEntry[]): { entry: HistoryEntry; origIdx: number }[] {
  if (history.length <= 12) {
    // < 12 帧不做筛选，只排序
    return history.map((entry, i) => ({ entry, origIdx: i }));
  }

  // 1. 分解：问题帧 vs 干净帧
  const problemFrames: ScoredFrame[] = [];
  const cleanFrames: ScoredFrame[] = [];

  history.forEach((entry, i) => {
    const markers = entry.result.markers || [];
    const errors = markers.filter(m => m.type === 'error');
    const warnings = markers.filter(m => m.type === 'warning');
    const successes = markers.filter(m => m.type === 'success');

    const uniqueLabels = [...new Set(markers.map(m => m.label))];
    const severity = errors.length * 10 + warnings.length * 5 + successes.length * 1;

    const scored: ScoredFrame = { entry, origIdx: i, severity, uniqueLabels };

    if (errors.length > 0 || warnings.length > 0) {
      problemFrames.push(scored);
    } else {
      cleanFrames.push(scored);
    }
  });

  // 2. 问题帧：按严重度降序
  problemFrames.sort((a, b) => b.severity - a.severity);

  // 3. 收集所有问题标签
  const allLabels = [...new Set(problemFrames.flatMap(f => f.uniqueLabels))];

  // 4. 多样性优先：每种标签至少包含 1 帧
  const selected = new Set<number>(); // 存 origIdx
  const labelCount = new Map<string, number>();

  // 第一轮：每种标签选最严重的那一帧
  for (const label of allLabels) {
    const candidates = problemFrames.filter(f => f.uniqueLabels.includes(label) && !selected.has(f.origIdx));
    if (candidates.length === 0) continue;
    const best = candidates.reduce((a, b) => a.severity >= b.severity ? a : b);
    selected.add(best.origIdx);
    labelCount.set(label, 1);
  }

  // 第二轮：每个标签再加 1 帧（共 2 帧），按严重度降序填充，总量不超 12
  const maxFrames = 12;
  let round2 = problemFrames.filter(f => !selected.has(f.origIdx));
  round2.sort((a, b) => b.severity - a.severity);

  for (const frame of round2) {
    if (selected.size >= maxFrames) break;
    // 检查是否有某个标签还可以再加（不超过 2 帧）
    const canAdd = frame.uniqueLabels.some(label => (labelCount.get(label) || 0) < 2);
    if (!canAdd) continue;
    // 增加选中计数
    for (const label of frame.uniqueLabels) {
      labelCount.set(label, (labelCount.get(label) || 0) + 1);
    }
    selected.add(frame.origIdx);
  }

  // 5. 补一张好帧（带 most success markers）
  let goodFrame: ScoredFrame | null = null;
  if (cleanFrames.length > 0) {
    cleanFrames.sort((a, b) => b.severity - a.severity);
    goodFrame = cleanFrames[0];
  }

  // 6. 组装结果：问题帧（按原始顺序）+ 好帧
  const result: { entry: HistoryEntry; origIdx: number }[] = [];
  for (const frame of problemFrames) {
    if (selected.has(frame.origIdx)) {
      result.push({ entry: frame.entry, origIdx: frame.origIdx });
    }
  }

  // 按原始顺序重排
  result.sort((a, b) => a.origIdx - b.origIdx);

  if (goodFrame) {
    result.push({ entry: goodFrame.entry, origIdx: goodFrame.origIdx });
  }

  return result;
}
