import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';

const SITE_URL = 'https://boulderi.bolunta.top';

interface QRPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  xiaohongshuQR?: string;
}

export function QRPopover({ isOpen, onClose, xiaohongshuQR }: QRPopoverProps) {
  const [siteQR, setSiteQR] = useState('');
  const [linePath, setLinePath] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const lineRendered = useRef(false);

  useEffect(() => {
    QRCode.toDataURL(SITE_URL, {
      width: 240,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' },
    }).then(url => setSiteQR(url));
  }, []);

  // 计算 L 形连接线的路径
  useEffect(() => {
    if (!isOpen) {
      setLinePath('');
      lineRendered.current = false;
      return;
    }

    const t = setTimeout(() => {
      const logo = document.getElementById('b-logo');
      const card = cardRef.current;
      if (!logo || !card) return;

      const lr = logo.getBoundingClientRect();
      const cr = card.getBoundingClientRect();

      // 起点：logo 右下角
      const sx = lr.right;
      const sy = lr.bottom;
      // 终点：弹窗左侧中间
      const ex = cr.left;
      const ey = cr.top + cr.height / 2;

      // L 形：先垂直向下，再水平向右
      setLinePath(`M ${sx} ${sy} L ${sx} ${ey} L ${ex} ${ey}`);
      lineRendered.current = true;
    }, 120); // 等弹窗动画安顿后再测量

    return () => clearTimeout(t);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="qr-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {/* L 形连接线 */}
          {linePath && (
            <svg
              className="fixed inset-0 w-full h-full pointer-events-none z-[101]"
              style={{ overflow: 'visible' }}
            >
              <motion.path
                d={linePath}
                fill="none"
                stroke="rgba(148,163,184,0.35)"
                strokeWidth="2"
                strokeDasharray="6 4"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </svg>
          )}

          <motion.div
            key="qr-card"
            ref={cardRef}
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.3, y: 60 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.8 }}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-[260px] w-full mx-4 shadow-2xl relative"
          >
            {/* X 关闭按钮 */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors z-10"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>

            {/* 网站二维码 */}
            <div className="text-center pt-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                在手机上打开
              </p>
              {siteQR ? (
                <img
                  src={siteQR}
                  alt="网站二维码"
                  className="w-44 h-44 mx-auto rounded-xl bg-white p-2 shadow-inner"
                />
              ) : (
                <div className="w-44 h-44 mx-auto rounded-xl bg-slate-800 animate-pulse flex items-center justify-center">
                  <span className="text-[10px] text-slate-500">生成中...</span>
                </div>
              )}
              <p className="text-[10px] font-mono text-slate-600 mt-2">
                扫码打开或访问 boulderi.bolunta.top
              </p>
            </div>

            {/* 小红书二维码 */}
            {xiaohongshuQR && (
              <>
                <div className="border-t border-slate-800 my-4 mx-4" />
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">
                    小红书 · 关注获取更新
                  </p>
                  <div className="flex justify-center">
                    <img
                      src={xiaohongshuQR}
                      alt="小红书二维码"
                      className="max-w-[180px] max-h-[180px] rounded-xl shadow-inner object-contain"
                    />
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
