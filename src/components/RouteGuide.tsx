import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, Image as ImageIcon, Loader2 } from 'lucide-react';

interface RouteData {
  points: { x: number; y: number }[];
  description?: string;
  difficulty?: string;
  route_color?: string;
}

interface RouteGuideProps {
  imageUrl: string | null;
  routeData: RouteData | null;
}

const RouteGuide: React.FC<RouteGuideProps> = ({ imageUrl, routeData }) => {
  const imageRef = useRef<HTMLCanvasElement>(null);

  const drawRoute = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !routeData || !imageUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      if (routeData.points && routeData.points.length > 0) {
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.beginPath();
        routeData.points.forEach((pt, i) => {
          const x = pt.x * canvas.width;
          const y = pt.y * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    };
    img.src = imageUrl;
  }, [routeData, imageUrl]);

  useEffect(() => {
    drawRoute(imageRef.current);
  }, [drawRoute]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={imageRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      {!imageUrl && (
        <div className="flex items-center justify-center h-full text-gray-400">
          请先上传岩壁图片
        </div>
      )}
    </div>
  );
};

interface RouteGuideUploaderProps {
  onAnalysisComplete?: (result: { imageUrl: string; routeData: RouteData }) => void;
}

export const RouteGuideUploader: React.FC<RouteGuideUploaderProps> = ({ onAnalysisComplete }) => {
  const [phase, setPhase] = useState<'upload' | 'analyzing' | 'result'>('upload');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setPhase('analyzing');
    setError(null);

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/route-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: [{ dataUrl }],
          prompt: "你是一位专业的抱石攀岩路线设定师。请分析这张岩墙图片，标记出一条合理的攀爬路线，返回路径点坐标（归一化 0-1）。",
          model: "glm-5v-turbo"
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`分析失败 (${response.status}): ${errText.slice(0, 200)}`);
      }

      const result = await response.json();
      const rd: RouteData = {
        points: result.points || result.route?.points || [],
        description: result.description || result.route?.description,
        difficulty: result.difficulty || result.route?.difficulty,
        route_color: result.route_color || result.route?.color,
      };

      setRouteData(rd);
      setPhase('result');
      onAnalysisComplete?.({ imageUrl: url, routeData: rd });
    } catch (err: any) {
      setError(err.message || '分析失败');
      setPhase('upload');
    }
  }, [onAnalysisComplete]);

  const handleReset = useCallback(() => {
    setPhase('upload');
    setImageUrl(null);
    setRouteData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Upload Controls */}
      <div className="p-4 flex items-center gap-3 border-b border-slate-800">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
          id="route-image-input"
        />
        <label
          htmlFor="route-image-input"
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all active:scale-95"
        >
          <Upload className="w-4 h-4" />
          上传岩壁图片
        </label>
        {phase === 'result' && (
          <button
            onClick={handleReset}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            重新上传
          </button>
        )}
        {phase === 'analyzing' && (
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 分析路线中...
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Canvas Area */}
      <div className="flex-1 relative overflow-hidden bg-slate-900">
        <RouteGuide imageUrl={imageUrl} routeData={routeData} />
      </div>

      {/* Result Info */}
      {phase === 'result' && routeData && (
        <div className="p-4 border-t border-slate-800 space-y-2">
          {routeData.difficulty && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 uppercase font-black">难度</span>
              <span className="text-sm font-bold text-orange-400">{routeData.difficulty}</span>
            </div>
          )}
          {routeData.description && (
            <p className="text-xs text-slate-400 leading-relaxed">{routeData.description}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default RouteGuide;
