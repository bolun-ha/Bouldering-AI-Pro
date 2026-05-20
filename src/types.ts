export interface Marker {
  x: number;
  y: number;
  type: 'error' | 'warning' | 'info' | 'success';
  label: string;
  description?: string;
}

export interface HoldPosition {
  x: number;
  y: number;
  color: string;       // 颜色，如"红色""蓝色"
  type: string;        // 类型，如"大把手""深扣""小点""脚点"
  used: boolean;       // 是否被攀爬者使用
}

export interface AnalysisResult {
  markers: Marker[];
  instruction: string;
  detected_route_color?: string;
  detailed_feedback: string;
  climb_status: 'moving' | 'steady' | 'stuck' | 'falling' | 'finished';
  hold_positions?: HoldPosition[];  // AI 标出的岩点坐标
}

/** 保存到历史记录中的条目：AI 分析结果 + 当时的缩略图 */
export interface HistoryEntry {
  result: AnalysisResult;
  snapshot?: string; // base64 jpeg thumbnail (320px wide)
}

export interface SessionData {
  startTime: number;
  endTime?: number;
  totalErrors: number;
  history: HistoryEntry[];
}

/** AI 生成的攀爬报告 */
export interface ReportData {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  trend: string;
}
