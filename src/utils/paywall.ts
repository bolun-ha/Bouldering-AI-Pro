/**
 * 付费墙核心逻辑
 * 
 * 设备指纹 → API 调用次数检查 → 付费拦截
 * 
 * 当前处于「接口就位、功能关闭」状态（见 config/features.ts）。
 * 上线日只需翻转 PAYWALL_ENABLED=true 即可全量生效。
 */

import { FEATURES } from '../config/features';

const DEVICE_ID_KEY = 'bouldering_device_id';

/**
 * 获取设备唯一标识（UUID）
 * - 首次生成后永久存入 localStorage
 * - 不依赖任何第三方指纹库
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** 检查是否需要禁止本次分析（与后端双确认） */
export interface UsageStatus {
  /** 当前剩余次数（-1 = 无限） */
  remaining: number;
  /** 是否被封禁 */
  blocked: boolean;
  /** 封禁原因 */
  reason?: string;
}

/**
 * 尝试准备分析请求的 headers
 * - 当 PAYWALL_ENABLED=true 时，带上 x-device-id
 * - 同时返回当前已知的本地使用状态（用于 UI 展示）
 */
export function prepareAnalysisHeaders(): HeadersInit {
  if (!FEATURES.PAYWALL_ENABLED) {
    return {}; // 功能未启用，不携带任何设备标识
  }
  return {
    'x-device-id': getDeviceId(),
  };
}

/**
 * 解析后端返回的剩余次数信息（来自响应头）
 */
export function parseUsageHeaders(headers: Headers): UsageStatus {
  const remainingStr = headers.get('x-usage-remaining');
  const blocked = headers.get('x-usage-blocked') === 'true';
  const reason = headers.get('x-usage-reason') || undefined;

  if (remainingStr === null) {
    return { remaining: FEATURES.PAYWALL_FREE_LIMIT, blocked: false };
  }

  return {
    remaining: parseInt(remainingStr, 10),
    blocked,
    reason,
  };
}
