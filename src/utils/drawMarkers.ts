/** 在 canvas 上绘制 AI 标注覆盖层 */
import type { Marker } from '../types';

const MARKER_STYLES: Record<Marker['type'], { color: string; label: string }> = {
  error:   { color: '#ef4444', label: '错误' },
  warning: { color: '#f97316', label: '警告' },
  success: { color: '#10b981', label: '正确' },
  info:    { color: '#3b82f6', label: '提示' },
};

/**
 * 在 canvas 上绘制视频帧 + AI 标注
 * @param ctx — canvas 2D context
 * @param width — canvas 宽（px）
 * @param height — canvas 高（px）
 * @param markers — AI 标注数组
 * @param routeColor — 检测到的线路颜色（可选）
 */
export function drawMarkers(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  markers: Marker[],
  routeColor?: string,
) {
  // 水印
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = `${Math.max(10, Math.round(width * 0.025))}px "PingFang SC", sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText('AI 抱石教练 · 专业版', 6, height - 4);

  // 线路信息
  if (routeColor) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.font = `${Math.max(9, Math.round(width * 0.02))}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(`线路: ${routeColor}`, 6, 6);
  }

  // 绘制每个标注
  for (const m of markers) {
    const style = MARKER_STYLES[m.type] || { color: '#ffffff', label: '' };
    const cx = m.x * width;
    const cy = m.y * height;
    const radius = Math.max(8, Math.round(width * 0.025));

    // 外发光
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.5);
    gradient.addColorStop(0, style.color + '50');
    gradient.addColorStop(1, style.color + '00');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 空心圆
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(2, Math.round(width * 0.005));
    ctx.stroke();

    // 实心点
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, Math.round(radius * 0.3)), 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();

    // 标注标签
    if (m.label) {
      const fontSize = Math.max(10, Math.round(width * 0.022));
      ctx.font = `bold ${fontSize}px "PingFang SC", sans-serif`;
      const textW = ctx.measureText(m.label).width;

      const labelX = cx + radius + 4;
      const labelY = cy - fontSize - 2;
      const pad = 4;
      const bgW = textW + pad * 2;
      const bgH = fontSize + pad * 2;

      // 标签背景
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.beginPath();
      const r = 3;
      ctx.roundRect(labelX, labelY, bgW, bgH, r);
      ctx.fill();

      // 标签文字
      ctx.fillStyle = style.color;
      ctx.textBaseline = 'bottom';
      ctx.fillText(m.label, labelX + pad, labelY + bgH - pad);
    }
  }
}
