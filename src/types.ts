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
  difficulty?: {
    category: 'simple' | 'medium' | 'hard';
    grade: string; // 'V0' | 'V1' | ... | 'V8+'
  };
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

// ─── 异步视频分析（GLM-5V-Turbo 多帧）类型 ───────────────────

/** 前端抽帧结果（发送给分析 API） */
export interface ExtractedFrame {
  base64: string;
  timestamp: number; // 秒
}

/** 单帧压缩配置 */
export const FRAME_CONFIG = {
  WIDTH: 640,
  HEIGHT: 480,
  QUALITY: 0.7,
} as const;

/** 分析结果中的单条问题 */
export interface TimestampedIssue {
  timestamp: number;  // 秒，精确到 0.1
  issue_type: string; // "膝盖内扣"
  severity: 'high' | 'mid' | 'low';
  bbox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  suggestion: string; // 不超过 50 字
  correction_keywords: string[];
}

/** 异步视频分析的完整输出 */
export interface VideoAnalysisResult {
  issues: TimestampedIssue[];
  overall_score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
}
