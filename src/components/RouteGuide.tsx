/**
 * RouteGuide — Beta 路线
 *
 * 用户上传干净的岩墙照片，填写岩点颜色/预估难度/个人风格，
 * AI 在图上标记路线：1→2→3 带发光线条，绿色起点→蓝色难点→红色终点。
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, MapPin, Loader2, Image as ImageIcon, RotateCcw } from 'lucide-react';

interface RouteData {
  /** AI 返回的坐标标注（归一化 0-1） */
  steps: {
    index: number;
    label: string;         // "起点" | "第1步" | "难点" | "终点" 等
    x: number;
    y: number;
    color: string;
    tip?: string;          // 难点提示信息
  }[];
  /** 智能小贴士（纯文本） */
  tips: string[];
  /** AI 返回的完整原始文本（用于调试） */
  rawResponse?: string;
}

export const RouteGuide: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'upload' | 'form' | 'marking' | 'analyzing' | 'result'>('upload');
  const [imageUrl, setImageUrl] = useState<string>('');

  // 表单
  const [routeColor, setRouteColor] = useState('橙');
  const [difficulty, setDifficulty] = useState('V3');
  const [height, setHeight] = useState('170');
  const [style, setStyle] = useState<'静态' | '动态' | '均衡'>('均衡');

  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 用户初始位置标注
  const [userMarks, setUserMarks] = useState<{ x: number; y: number; label: string }[]>([]);
  const userMarksRef = useRef<{ x: number; y: number; label: string }[]>([]);
  const [activeMarkType, setActiveMarkType] = useState<'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot'>('leftHand');
  const markingImgRef = useRef<HTMLImageElement>(null);
  const markingCanvasRef = useRef<HTMLCanvasElement>(null);
  const markingContainerRef = useRef<HTMLDivElement>(null);

  /** 选择图片 → 显示表单弹窗 */
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setPhase('form');
  }, []);

  /** 表单提交 → 进入标注阶段 */
  const handleFormSubmit = useCallback(() => {
    // 预加载图片到标注 canvas
    const canvas = markingCanvasRef.current;
    const img = markingImgRef.current;
    if (canvas && img && img.complete) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    setPhase('marking');
  }, []);

  /** 标注提交 → AI 分析 */
  const handleSubmit = useCallback(async () => {
    setPhase('analyzing');
    setError(null);

    // 用 ref 取最新 userMarks，防止闭包过期
    const marksSnapshot = userMarksRef.current;

    try {
      // 获取 canvas 上的图片 dataURL
      const canvas = imageRef.current;
      if (!canvas || !imageUrl) throw new Error('图片未加载');

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 不可用');

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          // 限制最大尺寸 1024px
          const maxDim = 2048;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);

          // 把用户标注的初始位置画到图片上（加上大箭头让 AI 一眼看到）
          const colorMap: Record<string, string> = {
            '左手': '#3b82f6', '右手': '#f97316', '左脚': '#22c55e', '右脚': '#ef4444'
          };
          if (marksSnapshot.length > 0) {
            for (const m of marksSnapshot) {
              const sx = m.x * w;
              const sy = m.y * h;
              const color = colorMap[m.label] || '#fff';

              // 大箭头指向起攀点
              const arrowSize = Math.max(w * 0.05, 24);
              const arrowX = sx + arrowSize * 0.4;
              const arrowY = sy - arrowSize * 0.5;
              ctx.save();
              ctx.translate(arrowX, arrowY);
              ctx.rotate(-Math.PI * 0.75);
              ctx.beginPath();
              ctx.moveTo(0, -arrowSize * 0.5);
              ctx.lineTo(-arrowSize * 0.25, 0);
              ctx.lineTo(arrowSize * 0.25, 0);
              ctx.closePath();
              ctx.fillStyle = color;
              ctx.globalAlpha = 0.7;
              ctx.fill();
              ctx.restore();

              // 外圈光晕
              const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, 22 * w / 1024);
              gradient.addColorStop(0, color + '60');
              gradient.addColorStop(1, color + '00');
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(sx, sy, 22 * w / 1024, 0, Math.PI * 2);
              ctx.fill();
              // 实心圆点
              ctx.beginPath();
              ctx.arc(sx, sy, 7 * w / 1024, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              ctx.stroke();
              // 文字标签
              ctx.font = `bold ${12 * w / 1024}px system-ui, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';
              ctx.fillStyle = '#fff';
              ctx.shadowColor = 'rgba(0,0,0,0.9)';
              ctx.shadowBlur = 4;
              ctx.fillText(m.label, sx, sy - 12 * w / 1024);
              ctx.shadowBlur = 0;
            }
          }

          resolve();
        };
        img.onerror = reject;
        img.src = imageUrl;
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      const userMarksPrompt = marksSnapshot.length > 0
        ? `\n用户初始位置（从这些点出发规划路线）:\n${marksSnapshot.map(m => `- ${m.label}: (${(m.x * 100).toFixed(0)}%, ${(m.y * 100).toFixed(0)}%)`).join('\n')}`
        : '';

      const prompt = `你是一位专业的抱石攀岩路线设定师。用户上传了一张干净的岩墙照片，请分析并在图上标记一条 ${difficulty} 难度的路线。

岩点颜色：${routeColor}色
用户身高：${height}cm
用户风格：${style}
${userMarksPrompt}

请严格按照以下 JSON 格式返回（不要包含其他文字）：
{
  "steps": [
    { "index": 0, "x": <0-1归一化x>, "y": <0-1归一化y>, "tip": "" },
    { "index": 1, "x": <0-1归一化x>, "y": <0-1归一化y>, "tip": "静态慢移重心到左腿" },
    ...
  ],
  "tips": [
    "身高${height}cm建议第3步用左脚高踩",
    "..."
  ]
}

要求：
1. 仔细辨认${routeColor}色的岩点，只使用该颜色的岩点标记路线，不要使用非指定颜色的岩点
2. 每个 step 的 x,y 是归一化坐标（0-1，相对图片宽高），精度到小数点后 3 位，必须对准岩点中心
3. 难度${difficulty}：合理分配难度，避免过于简单或过难，步骤数 4-8 步为宜
4. 用户身高${height}cm + 风格${style}：路线规划要考虑用户身高和风格特点
5. 起攀点尽量从用户标注的手脚位置附近开始规划（即图上带彩色圆点+箭头标记的位置）
6. 每个步骤只标注单个岩点（手或脚位置），不包含颜色字段，第 0 个是起攀手点
7. 如有难点卡关位，在该 step 的 tip 字段写技巧（如"转体发力"、"静力慢移"、"脚尖踩实"），不要写在 tips 数组里
8. steps 按攀爬顺序排列
9. tips 最多 3 条全局建议，每条简洁实用`;

      const body = {
        frames: [{ dataUrl }],
        prompt,
        model: 'glm-5v-turbo',
      };

      const response = await fetch('/api/route-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`分析失败 (${response.status}): ${errText.slice(0, 200)}`);
      }

      const result = await response.json();
      setRouteData(result);
      setPhase('result');
    } catch (err: any) {
      setError(err.message || '分析失败');
      setPhase('form');
    }
  }, [imageUrl, routeColor, difficulty, height, style]);

  /** 重新上传 */
  const handleReset = useCallback(() => {
    setPhase('upload');
    setImageUrl('');
    setRouteData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // 回到视频模式（右上角按钮保持不变）
    onBack?.();
  }, [onBack]);

  /** 在标注图上绘制路线 */
  const drawRoute = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !routeData || !imageUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const { steps, tips } = routeData;
      if (steps.length < 2) return;

      const cw = canvas.width;
      const ch = canvas.height;

      // ── 辅助：计算两点距离 ──
      function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
        return Math.hypot((a.x - b.x) * cw, (a.y - b.y) * ch);
      }

      // ███████████████████████████████████████████████████████████
      // 第一步：用用户标注的 4 个手脚点，构建初始三角形
      // 规则：找最近的两个点取中点 → 剩下 3 个最远的点连成三角形
      // ███████████████████████████████████████████████████████████

      // 从 userMarksRef 获取 4 个手脚标注点（已在标注阶段采集）
      const marks = userMarksRef.current;
      if (marks.length >= 4) {
        // 寻找最近的两个点
        let minDist = Infinity;
        let pairA = 0, pairB = 1;
        for (let i = 0; i < marks.length; i++) {
          for (let j = i + 1; j < marks.length; j++) {
            const d = dist(marks[i], marks[j]);
            if (d < minDist) {
              minDist = d;
              pairA = i;
              pairB = j;
            }
          }
        }

        // 取最近两点的中点
        const midX = (marks[pairA].x + marks[pairB].x) / 2;
        const midY = (marks[pairA].y + marks[pairB].y) / 2;

        // 剩下的两个点（非最近对的那两个）
        const remaining = marks.filter((_, idx) => idx !== pairA && idx !== pairB);
        // 三个点：剩余的两个 + 中点 = 最远三个点
        const triPts = [
          { x: remaining[0].x, y: remaining[0].y },
          { x: remaining[1].x, y: remaining[1].y },
          { x: midX, y: midY },
        ];

        // 画初始三角形（橙色粗虚线）
        const tsx = triPts.map(p => p.x * cw);
        const tsy = triPts.map(p => p.y * ch);
        ctx.save();
        ctx.setLineDash([8, 5]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)';
        ctx.shadowColor = 'rgba(249, 115, 22, 0.3)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(tsx[0], tsy[0]);
        for (let j = 1; j < 3; j++) ctx.lineTo(tsx[j], tsy[j]);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(249, 115, 22, 0.04)';
        ctx.fill();
        ctx.restore();

        // 初始三角形顶点标记
        for (let j = 0; j < 3; j++) {
          ctx.beginPath();
          ctx.arc(tsx[j], tsy[j], 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(249, 115, 22, 0.5)';
          ctx.fill();
        }
      }

      // ███████████████████████████████████████████████████████████
      // 后续每一步：在相邻步骤岩点之间标记三角形
      // 每步三角形 = 上一步岩点 + 当前步岩点 + 下一步岩点（最后一步以终点为顶点）
      // ███████████████████████████████████████████████████████████
      for (let i = 0; i < steps.length; i++) {
        const cur = steps[i];

        // ── 三角形顶点（每步 3 个点） ──
        let triVerts: { x: number; y: number }[] = [];

        if (i === 0 && steps.length >= 3) {
          // 第 0 步：步0 + 步1 + 步2
          triVerts = [steps[0], steps[1], steps[2]];
        } else if (i > 0 && i < steps.length - 1) {
          // 中间步：上一步 + 当前步 + 下一步
          triVerts = [steps[i - 1], steps[i], steps[i + 1]];
        } else if (i === steps.length - 1 && steps.length >= 3) {
          // 最后一步：倒数第3步 + 倒数第2步 + 当前步（终点）
          triVerts = [steps[i - 2], steps[i - 1], steps[i]];
        }

        if (triVerts.length === 3) {
          const tvx = triVerts.map(p => p.x * cw);
          const tvy = triVerts.map(p => p.y * ch);

          // 计算重心
          const cx = (tvx[0] + tvx[1] + tvx[2]) / 3;
          const cy = (tvy[0] + tvy[1] + tvy[2]) / 3;

          // ── 三角形连线（虚线，白色半透明） ──
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.beginPath();
          ctx.moveTo(tvx[0], tvy[0]);
          ctx.lineTo(tvx[1], tvy[1]);
          ctx.lineTo(tvx[2], tvy[2]);
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.fill();
          ctx.restore();

          // ── 三角形顶点小圆点 ──
          for (let j = 0; j < 3; j++) {
            ctx.beginPath();
            ctx.arc(tvx[j], tvy[j], 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.fill();
          }

          // ── 重心标记（小菱形） ──
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.fillRect(-3, -3, 6, 6);
          ctx.restore();

          // ── 橙色箭头：重心 → 下一步目标 ──
          const nextIdx = Math.min(i + 1, steps.length - 1);
          const target = steps[nextIdx];
          if (nextIdx !== i) {
            const tx = target.x * cw;
            const ty = target.y * ch;
            const angle = Math.atan2(ty - cy, tx - cx);
            const len = Math.hypot(tx - cx, ty - cy);
            const arrLen = Math.min(len * 0.88, Math.max(cw, ch) * 0.12);

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(arrLen, 0);
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 3;
            ctx.shadowColor = 'rgba(249, 115, 22, 0.5)';
            ctx.shadowBlur = 8;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(arrLen, 0);
            ctx.lineTo(arrLen - 12, -6);
            ctx.lineTo(arrLen - 12, 6);
            ctx.closePath();
            ctx.fillStyle = '#f97316';
            ctx.shadowBlur = 10;
            ctx.fill();

            ctx.restore();
          }
        }

        // ── 步骤序号标记 ──
        const px = cur.x * cw;
        const py = cur.y * ch;
        const isStart = i === 0;
        const isEnd = i === steps.length - 1;

        if (isStart) {
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(34, 197, 94, 0.4)';
          ctx.fill();
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#22c55e';
          ctx.fillText('S', px, py + 1);
        } else if (isEnd) {
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.fill();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.font = 'bold 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#ef4444';
          ctx.fillText('T', px, py + 1);
        } else {
          ctx.beginPath();
          ctx.arc(px, py, 10, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#FFD700';
          ctx.fillText(String(i), px, py + 1);
        }

        // ── 提示气泡 ──
        if (cur.tip) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const tipX = px + 18;
          const tipY = py - 14;
          const tipText = `💡 ${cur.tip}`;
          const textW = ctx.measureText(tipText).width + 12;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
          ctx.shadowBlur = 0;
          const maxW = Math.min(textW, cw - tipX - 8);
          const lines: string[] = [];
          let line = '';
          for (const char of tipText) {
            const test = line + char;
            if (ctx.measureText(test).width > maxW - 8) {
              lines.push(line);
              line = char;
            } else {
              line = test;
            }
          }
          if (line) lines.push(line);
          const bh = lines.length * 16 + 6;
          ctx.fillRect(tipX - 4, tipY - 2, maxW, bh);
          ctx.fillStyle = '#fbbf24';
          lines.forEach((l, li) => {
            ctx.fillText(l, tipX + 2, tipY + 2 + li * 16);
          });
        }
      }

      // ── 底部图例 ──
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      const legendY = ch - 28;
      ctx.fillRect(8, legendY, 210, 22);
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#22c55e';
      ctx.fillText('S', 16, legendY + 11);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('起攀', 26, legendY + 11);
      ctx.fillStyle = '#FFD700';
      ctx.fillText('●', 66, legendY + 11);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('步骤', 78, legendY + 11);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('T', 112, legendY + 11);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('终点', 122, legendY + 11);
      ctx.fillStyle = '#f97316';
      ctx.fillText('△→', 158, legendY + 11);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('重心→目标', 178, legendY + 11);
      ctx.restore();
    };
    img.src = imageUrl;
  }, [routeData, imageUrl]);
  return (
    <canvas
      ref={imageRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

// 全局辅助函数（供 onClick 内 setTimeout 调用）
