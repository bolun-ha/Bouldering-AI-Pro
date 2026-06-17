/**
 * 功能开关配置
 * 默认所有付费相关功能不生效
 */

export const FEATURES = {
  /** 付费墙开关（默认关闭） */
  PAYWALL_ENABLED: false,
  /** 免费使用次数（PAYWALL_ENABLED=true 时生效） */
  PAYWALL_FREE_LIMIT: 7,
  /** 卡关分析（实验性） */
  STUCK_ANALYSIS: false,
  /** 掉落检测 */
  FALL_DETECTION: false,
} as const;
