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
  // 视频模式移植的终局字段（可选，实时模式用不到的不会出现）
  climb_result?: 'SUCCESS' | 'FAIL' | 'UNKNOWN';
  end_game_reason?: string;
  top_control_score?: number;
  top_hand_match_status?: 'perfect_match' | 'struggling_match' | 'no_match';
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

/** 爬升阶段（固定名称枚举，AI 只分配时间范围和评估，不发明阶段名） */
export interface ClimbingPhase {
  phase_name: '起步(Start)' | '过渡(Transition)' | '核心发力(Crux)' | '完攀/结束(Finish)';
  time_range: [number, number]; // [start, end] 秒
  summary: string; // 该阶段表现评估，不超过 30 字
  status: 'good' | 'warning' | 'critical';
}

/** 异步视频分析的完整输出 */
export interface VideoAnalysisResult {
  issues: TimestampedIssue[];
  overall_score: number;
  summary: string;
  sequence_analysis: string;       // 完整动作叙事，不超过 150 字
  phases: ClimbingPhase[];         // 阶段分解（最多 4 段）
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  climb_result?: 'SUCCESS' | 'FAIL' | 'UNKNOWN';           // 终局判定
  end_game_reason?: string;                                 // 终局裁判依据
  top_control_score?: number;                               // 顶端动作控制分 0-100
  top_hand_match_status?: 'perfect_match' | 'struggling_match' | 'no_match';  // 双手合分状态
}

/** MediaPipe 骨骼补充数据（喂给 AI 的手部小抄） */
export interface ArmSupplement {
  timestamp: number;
  left_elbow_angle?: number;   // 度
  right_elbow_angle?: number;  // 度
  note?: string;               // 观测备注
}

export interface MotionMetadata {
  arm_analysis_supplement: ArmSupplement[];
}
