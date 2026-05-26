import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Marker } from '../types';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface OverlayProps {
  markers: Marker[];
}

const MarkerIcon = ({ type }: { type: Marker['type'] }) => {
  switch (type) {
    case 'error': return <AlertCircle className="text-red-500 w-6 h-6" />;
    case 'warning': return <AlertTriangle className="text-yellow-500 w-6 h-6" />;
    case 'success': return <CheckCircle className="text-green-500 w-6 h-6" />;
    default: return <Info className="text-blue-500 w-6 h-6" />;
  }
};

export const Overlay: React.FC<OverlayProps> = ({ markers }) => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {markers.map((marker, index) => (
          <motion.div
            key={`${index}-${marker.label}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ 
              left: `${marker.x}%`, 
              top: `${marker.y}%`, 
              transform: 'translate(-50%, -50%)' 
            }}
            className="absolute flex flex-col items-center"
          >
            <div className={`p-2 rounded rounded-br-none text-[10px] font-bold text-white whitespace-nowrap shadow-lg ${
              marker.type === 'error' ? 'bg-red-500/90' : 
              marker.type === 'warning' ? 'bg-orange-500/90' : 
              marker.type === 'success' ? 'bg-emerald-500/90 shadow-[0_0_15px_rgba(16,185,129,0.5)] border border-emerald-400' :
              'bg-blue-500/90'
            }`}>
              {marker.label.toUpperCase()}
            </div>
            <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_white] mt-1"></div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
