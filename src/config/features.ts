/**
 * 特性开关 — 商业功能灰度控制
 * 
 * 所有付费/限制相关功能默认关闭，翻转即可上线。
 */
export const FEATURES = {
  /** 付费墙：7 次免费 → 第 8 次拦截 */
  PAYWALL_ENABLED: false,
  /** 免费次数上限 */
  PAYWALL_FREE_LIMIT: 7,
} as const;
