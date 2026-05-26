import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Marker } from '../types';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface OverlayProps {
  markers: Marker[];
}

const MarkerIcon = ({ type }: { type: Marker['type'] }) => {
  switch (type) {
    case 'error': return <AlertCircle className="text-red-500 w-5 h-5" />;
    case 'warning': return <AlertTriangle className="text-yellow-500 w-5 h-5" />;
    case 'success': return <CheckCircle className="text-green-500 w-5 h-5" />;
    default: return <Info className="text-blue-500 w-5 h-5" />;
  }
};

/**
 * 防重叠布局：将距离 <10% 的标注垂直错开，从上到下排列
 */
function layoutMarkers(markers: Marker[]): (Marker & { offsetY: number })[] {
  if (markers.length === 0) return [];

  // 按 y 排序
  const sorted = [...markers].sort((a, b) => a.y - b.y);
  const result: (Marker & { offsetY: number })[] = [];

  for (const m of sorted) {
    // 检查是否与已有标注重叠（x/y 距离 < 10%）
    let offsetY = 0;
    for (const existing of result) {
      const dx = Math.abs(m.x - existing.x);
      const dy = Math.abs(m.y - existing.y) + offsetY; // 叠加偏移后判断
      if (dx < 12 && dy < 8) {
        offsetY += 7; // 每个冲突下移 7%
      }
    }
    result.push({ ...m, offsetY });
  }

  return result;
}

export const Overlay: React.FC<OverlayProps> = ({ markers }) => {
  const laidOut = useMemo(() => layoutMarkers(markers), [markers]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {laidOut.map((marker) => (
          <motion.div
            key={`${marker.x}-${marker.y}-${marker.label}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ 
              left: `${marker.x}%`, 
              top: `${marker.y + marker.offsetY}%`, 
              transform: 'translate(-50%, -50%)' 
            }}
            className="absolute flex flex-col items-center"
          >
            <div className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold text-white whitespace-nowrap shadow-lg ${
              marker.type === 'error' ? 'bg-red-500/90' : 
              marker.type === 'warning' ? 'bg-orange-500/90' : 
              marker.type === 'success' ? 'bg-emerald-500/90 shadow-[0_0_15px_rgba(16,185,129,0.5)] border border-emerald-400' :
              'bg-blue-500/90'
            }`}>
              <MarkerIcon type={marker.type} />
              <span>{marker.label.toUpperCase()}</span>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_white] mt-0.5" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
