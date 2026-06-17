/**
 * 付费墙工具函数
 * 生成设备标识和分析请求头
 */

let deviceId: string | null = null;

/** 获取或生成设备 ID（基于 localStorage） */
export function getDeviceId(): string {
  if (deviceId) return deviceId;
  const stored = localStorage.getItem('bouldering_device_id');
  if (stored) {
    deviceId = stored;
    return stored;
  }
  // 生成随机 ID
  const id = 'device_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  localStorage.setItem('bouldering_device_id', id);
  deviceId = id;
  return id;
}

/** 生成分析请求头（含设备标识），付费墙需要 */
export function prepareAnalysisHeaders(): Record<string, string> {
  return {
    'X-Device-ID': getDeviceId(),
    'Content-Type': 'application/json',
  };
}
