/**
 * 岩点轮廓描边增强
 * 
 * 使用 Sobel 边缘检测在分析帧上叠加彩色轮廓线，
 * 帮助 AI 看清岩点边界，减少误判。
 * 
 * 纯前端 canvas 实现，零依赖。
 */

/**
 * 高斯模糊 5x5 kernel（归一化）
 */
function gaussianBlur5(imageData: ImageData): Uint8ClampedArray {
  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);

  // 5x5 Gaussian kernel (sigma ≈ 1.4)
  const kernel = [
    2, 4, 5, 4, 2,
    4, 9, 12, 9, 4,
    5, 12, 15, 12, 5,
    4, 9, 12, 9, 4,
    2, 4, 5, 4, 2,
  ];
  const kSum = 159;

  const off = 2;
  for (let y = off; y < h - off; y++) {
    for (let x = off; x < w - off; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const kVal = kernel[(ky + 2) * 5 + (kx + 2)];
          r += src[idx] * kVal;
          g += src[idx + 1] * kVal;
          b += src[idx + 2] * kVal;
        }
      }
      const oi = (y * w + x) * 4;
      dst[oi] = r / kSum;
      dst[oi + 1] = g / kSum;
      dst[oi + 2] = b / kSum;
      dst[oi + 3] = 255;
    }
  }
  return dst;
}

/**
 * 转换为灰度图
 */
function toGrayscale(data: Uint8ClampedArray): Float32Array {
  const len = data.length / 4;
  const gray = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const oi = i * 4;
    gray[i] = data[oi] * 0.299 + data[oi + 1] * 0.587 + data[oi + 2] * 0.114;
  }
  return gray;
}

/**
 * Sobel 边缘检测
 * 返回每个像素的边缘强度（0-1）
 */
function sobelEdgeDetect(gray: Float32Array, w: number, h: number): Float32Array {
  const edges = new Float32Array(gray.length);
  
  // Sobel kernels
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sumX = 0, sumY = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const i = (y + ky) * w + (x + kx);
          const ki = (ky + 1) * 3 + (kx + 1);
          sumX += gray[i] * gx[ki];
          sumY += gray[i] * gy[ki];
        }
      }
      edges[y * w + x] = Math.sqrt(sumX * sumX + sumY * sumY) / 255;
    }
  }
  return edges;
}

/**
 * 在 canvas 上叠加彩色轮廓线
 * @param canvas 要处理的 canvas（会被修改）
 * @param threshold 边缘阈值 0-1，默认 0.15
 * @param color 轮廓颜色，默认橙色
 */
export function applyContourOverlay(
  canvas: HTMLCanvasElement,
  threshold = 0.15,
  color = '#ff6600',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 读取原始像素
  const imageData = ctx.getImageData(0, 0, w, h);
  const blurred = gaussianBlur5(imageData);
  const gray = toGrayscale(blurred);
  const edges = sobelEdgeDetect(gray, w, h);

  // 在原图上叠加轮廓
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 解析颜色
  let cr = 255, cg = 102, cb = 0;
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    cr = parseInt(hex.substring(0, 2), 16);
    cg = parseInt(hex.substring(2, 4), 16);
    cb = parseInt(hex.substring(4, 6), 16);
  }

  // 绘制轮廓线
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] > threshold) {
      const oi = i * 4;
      // 混合：原图 50% + 轮廓色 50%
      data[oi] = Math.round(data[oi] * 0.5 + cr * 0.5);
      data[oi + 1] = Math.round(data[oi + 1] * 0.5 + cg * 0.5);
      data[oi + 2] = Math.round(data[oi + 2] * 0.5 + cb * 0.5);
    }
    // 非边缘区域：原图不变
  }

  ctx.putImageData(imgData, 0, 0);
}
