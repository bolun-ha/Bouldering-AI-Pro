/**
 * 浏览器端 WebM → MP4 转码
 * 使用 ffmpeg.wasm（纯 WASM，零服务器）
 * 仅在导出/保存时按需调用
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;

/** 获取或初始化 ffmpeg 实例（懒加载，单例） */
async function getFFmpeg(onProgress?: (pct: number) => void): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) {
    await loadPromise;
    return ffmpeg!;
  }

  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

  ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.round(progress * 100));
  });

  loadPromise = (async () => {
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
    await ffmpeg!.load({ coreURL, wasmURL });
  })();

  await loadPromise;
  return ffmpeg!;
}

/**
 * 将 WebM blob 转码为 MP4 blob
 * @param webmBlob 输入视频 (WebM)
 * @param onProgress 进度回调 (0-100)
 * @param onLoadEngine 「引擎加载中」回调
 * @returns MP4 blob
 */
export async function webmToMp4(
  webmBlob: Blob,
  onProgress?: (pct: number) => void,
  onLoadEngine?: () => void,
): Promise<Blob> {
  onLoadEngine?.();
  const ff = await getFFmpeg(onProgress);

  onProgress?.(0);

  // 写到 ffmpeg 虚拟文件系统
  const inputName = `input_${Date.now()}.webm`;
  const outputName = `output_${Date.now()}.mp4`;

  await ff.writeFile(inputName, await fetchFile(webmBlob));

  // 转码：webm → h264 + aac in mp4
  await ff.exec([
    '-i', inputName,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-y',
    outputName,
  ]);

  // 读取结果
  const data = await ff.readFile(outputName);
  const mp4Blob = new Blob([data], { type: 'video/mp4' });

  // 清理虚拟文件
  try { await ff.deleteFile(inputName); } catch { /* ignore */ }
  try { await ff.deleteFile(outputName); } catch { /* ignore */ }

  return mp4Blob;
}

/** 判断 blob 是否需要转码 */
export function needsTranscode(blob: Blob | null): blob is Blob {
  return blob !== null && blob.type.startsWith('video/webm');
}
