/**
 * RouteGuide — Beta 路线
 *
 * 用户上传干净的岩墙照片，填写岩点颜色/预估难度/个人风格，
 * AI 在图上标记路线：1→2→3 带发光线条，绿色起点→蓝色难点→红色终点。
 */
import React, { useRef, useState, useCallback } from 'react';
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

  // 分析结果
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 用户标记（暂留，后续可用）
  const [marks, _setMarks] = useState<{ x: number; y: number; label: string }[]>([]);
  const marksRef = useRef(marks);
  const setMarks = (v: React.SetStateAction<{ x: number; y: number; label: string }[]>) => {
    marksRef.current = typeof v === 'function' ? v(marksRef.current) : v;
    _setMarks(v);
  };

  /** 上传图片 & 标记步骤点 */
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setImageUrl(url);
      setPhase('marking');
    };
    reader.readAsDataURL(file);
  }, []);

  /** 清除用户标记 */
  const clearMarks = useCallback(() => {
    setMarks([]);
  }, []);

  /** 提交分析（表单确认 → 发送 AI） */
  const handleSubmit = useCallback(async () => {
    if (!imageUrl) return;
    setPhase('analyzing');
    setError(null);

    try {
      // 把图片转为 canvas dataUrl 发送给 AI
      const canvas = imageRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imageUrl;
      });
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      const userMarksPrompt = marksRef.current.length > 0
        ? `\n用户初始位置（从这些点出发规划路线）:\n${marksRef.current.map(m => `- ${m.label}: (${(m.x * 100).toFixed(0)}%, ${(m.y * 100).toFixed(0)}%)`).join('\n')}`
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
5. 起攀点尽量从用户标注的手脚位置附近开始规划
6. 每个步骤只标注单个岩点（手或脚位置），不包含颜色字段，第 0 个是起攀手点
7. 如有难点卡关位，在该 step 的 tip 字段写技巧（如"转体发力"、"静力慢移"、"脚尖踩实"），不要写在 tips 数组里
8. steps 按攀爬顺序排列
9. tips 最多 3 条全局建议，每条简洁实用`;

      const response = await fetch('/api/route-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: [{ dataUrl }],
          prompt,
          model: 'glm-5v-turbo',
        }),
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
    setMarks([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // 回到视频模式（右上角按钮保持不变）
    onBack?.();
  }, [onBack]);

  /** 在标注图上绘制路线 */
  const drawRoute = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !routeData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!routeData.steps) return;

    const { steps, tips } = routeData;
    const cw = canvas.width, ch = canvas.height;
    if (cw === 0 || ch === 0) return;

    // ── 画发光连线 ──
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.25)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    steps.forEach((s, i) => {
      const x = s.x * cw, y = s.y * ch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // ── 分段颜色线 ──
    steps.forEach((s, i) => {
      if (i === 0) return;
      const prev = steps[i - 1];
      const px = prev.x * cw, py = prev.y * ch;
      const x = s.x * cw, y = s.y * ch;

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.strokeStyle = s.color || '#FFD700';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    // ── 步骤标记 ──
    steps.forEach((s, i) => {
      const px = s.x * cw, py = s.y * ch;
      
      // 起点特殊标记
      if (i === 0) {
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#22c55e';
        ctx.fillText('S', px, py + 1);
        return;
      }

      // 终点特殊标记
      if (s.label === '终点' || i === steps.length - 1) {
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ef4444';
        ctx.fillText('T', px, py + 1);
        return;
      }

      // 普通步骤
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
    });

    // ── 提示气泡 ──
    steps.forEach((s, i) => {
      if (!s.tip) return;
      const px = s.x * cw, py = s.y * ch;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const tipX = px + 18;
      const tipY = py - 14;
      const tipText = `💡 ${s.tip}`;
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
    });

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
  }, [routeData]);

  // 渲染 canvas 标注（通过 useEffect 重新绘制）
  React.useEffect(() => {
    if (phase === 'result' && imageRef.current) {
      const canvas = imageRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        drawRoute(canvas);
      };
      img.src = imageUrl;
    }
  }, [phase, imageUrl, drawRoute]);

  return (
    <div className="w-full h-full flex flex-col bg-slate-950">
      {/* ── 顶栏 ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            ← 返回视频分析
          </button>
        )}
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-auto">路线指南</span>
      </div>

      {/* ── 主体内容 ── */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {phase === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-24 h-24 bg-purple-600/20 rounded-3xl flex items-center justify-center mb-4">
              <MapPin className="w-12 h-12 text-purple-400" />
            </div>
            <h2 className="text-xl font-black text-white mb-2">路线规划</h2>
            <p className="text-sm text-slate-400 text-center mb-6 max-w-xs">
              上传一张岩壁照片，AI 将为你规划一条适合当前训练的攀爬路线
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageUpload}
              className="hidden"
              id="route-upload-input"
            />
            <label
              htmlFor="route-upload-input"
              className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 cursor-pointer transition-all active:scale-95 shadow-lg shadow-purple-600/20"
            >
              <Upload className="w-5 h-5" />
              上传岩壁图片
            </label>
            <p className="text-[10px] text-slate-600 mt-4">支持 JPG / PNG</p>
          </div>
        )}

        {phase === 'marking' && (
          <div className="flex-1 flex flex-col">
            <div className="relative flex-1 bg-slate-900/50">
              <img src={imageUrl} alt="岩壁" className="w-full h-full object-contain" />
              <canvas
                ref={imageRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </div>
            <div className="p-4 border-t border-slate-800">
              <button
                onClick={() => setPhase('form')}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-bold transition-all active:scale-[0.98]"
              >
                图片已上传，下一步
              </button>
              <button
                onClick={handleReset}
                className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                重新选择图片
              </button>
            </div>
          </div>
        )}

        {phase === 'form' && (
          <div className="flex-1 p-4 space-y-5">
            <h3 className="text-sm font-bold text-white">填写参数</h3>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-black tracking-wider">岩点颜色</label>
              <div className="flex gap-2 mt-2">
                {['橙', '红', '蓝', '绿', '粉', '紫', '黄', '白'].map(c => (
                  <button
                    key={c}
                    onClick={() => setRouteColor(c)}
                    className={`w-9 h-9 rounded-full text-[11px] font-bold transition-all ${
                      routeColor === c
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-110'
                        : 'opacity-50 hover:opacity-80'
                    }`}
                    style={{ backgroundColor: c === '橙' ? '#f97316' : c === '红' ? '#ef4444' : c === '蓝' ? '#3b82f6' : c === '绿' ? '#22c55e' : c === '粉' ? '#ec4899' : c === '紫' ? '#a855f7' : c === '黄' ? '#eab308' : '#94a3b8' }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-black tracking-wider">预估难度</label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'].map(v => (
                  <button
                    key={v}
                    onClick={() => setDifficulty(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      difficulty === v
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-black tracking-wider">身高</label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {['160', '165', '170', '175', '180', '185', '190'].map(h => (
                  <button
                    key={h}
                    onClick={() => setHeight(h)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      height === h
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {h}cm
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-500 uppercase font-black tracking-wider">个人风格</label>
              <div className="flex gap-2 mt-2">
                {(['静态', '动态', '均衡'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                      style === s
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* 用户位置标记区域 — 暂不实现，直接提交 */}
            <button
              onClick={handleSubmit}
              disabled={!routeColor || !difficulty || !height || !style}
              className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-600 text-white py-3 rounded-xl font-bold transition-all active:scale-[0.98] mt-2"
            >
              开始分析
            </button>
            {error && (
              <p className="text-xs text-red-400 mt-2">{error}</p>
            )}
          </div>
        )}

        {phase === 'analyzing' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" />
            <p className="text-sm text-slate-400">AI 正在分析岩壁，规划路线中...</p>
          </div>
        )}

        {phase === 'result' && routeData && (
          <div className="flex-1 flex flex-col">
            <div className="relative flex-1 bg-slate-900/50">
              <canvas
                ref={imageRef}
                className="absolute inset-0 w-full h-full"
              />
            </div>
            <div className="p-4 border-t border-slate-800 space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {routeData.steps?.map((s, i) => (
                  <div key={i} className="flex-shrink-0 bg-slate-800 rounded-lg px-2.5 py-1.5 text-center min-w-[50px]">
                    <div className="text-[9px] text-slate-500 font-bold">{s.label || `第${i}步`}</div>
                    <div className="text-xs font-mono text-white mt-0.5">({(s.x * 100).toFixed(0)}, {(s.y * 100).toFixed(0)})</div>
                  </div>
                ))}
              </div>
              {routeData.tips?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-500 uppercase font-black tracking-wider">小贴士</div>
                  {routeData.tips.map((t, i) => (
                    <p key={i} className="text-xs text-yellow-400/80 flex items-start gap-1">
                      <span>💡</span> {t}
                    </p>
                  ))}
                </div>
              )}
              <button
                onClick={handleReset}
                className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> 重新分析
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && !routeData && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-red-400">分析失败，请重试</p>
          </div>
        )}
      </div>
    </div>
  );
};
