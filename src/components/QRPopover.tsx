import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import { X } from 'lucide-react';

const SITE_URL = 'https://boulderi.netlify.app';

interface QRPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  xiaohongshuQR?: string; // base64 data URL
}

export function QRPopover({ isOpen, onClose, xiaohongshuQR }: QRPopoverProps) {
  const [siteQR, setSiteQR] = useState('');

  useEffect(() => {
    QRCode.toDataURL(SITE_URL, {
      width: 240,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' },
    }).then(url => setSiteQR(url));
  }, []);

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
          <motion.div
            key="qr-card"
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
                扫码打开或访问 boulderi.netlify.app
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
                  <img
                    src={xiaohongshuQR}
                    alt="小红书二维码"
                    className="w-44 h-44 mx-auto rounded-xl shadow-inner"
                  />
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
