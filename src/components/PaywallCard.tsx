/**
 * 付费弹窗
 *
 * 免费次数用尽后弹窗提示用户付费
 */

import React from 'react';
import { motion } from 'motion/react';
import { Lock, ChevronRight, X } from 'lucide-react';
import { FEATURES } from '../config/features';

interface PaywallCardProps {
  onClose?: () => void;
}

export const PaywallCard: React.FC<PaywallCardProps> = ({ onClose }) => {
  if (!FEATURES.PAYWALL_ENABLED) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end justify-center pb-24"
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-slate-900 rounded-3xl border border-slate-800 p-6 mx-4 max-w-sm w-full"
      >
        {/* 关闭按钮 */}
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        )}

        {/* 图标 */}
        <div className="w-16 h-16 bg-orange-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-orange-500" />
        </div>

        {/* 标题 */}
        <h2 className="text-xl font-black text-white text-center mb-2">
          {FEATURES.PAYWALL_FREE_LIMIT} 次免费已用完
        </h2>
        <p className="text-sm text-slate-400 text-center mb-6">
          升级后继续享受 AI 攀爬训练分析、实时姿态检测等专业功能
        </p>

        {/* 付费选项 */}
        <div className="space-y-3">
          <button className="w-full bg-orange-600 hover:bg-orange-500 text-white py-4 rounded-2xl font-bold flex items-center justify-between px-5 active:scale-[0.97] transition-all">
            <span>月付 ¥29.9</span>
            <div className="flex items-center gap-1">
              <span className="text-xs opacity-70">无限次分析</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
          <button className="w-full bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-2xl font-bold flex items-center justify-between px-5 active:scale-[0.97] transition-all border border-slate-700">
            <span>年付 ¥199</span>
            <div className="flex items-center gap-1">
              <span className="text-xs opacity-70">无限次分析</span>
              <ChevronRight className="w-4 h-4" />
            </div>
          </button>
        </div>

        <p className="text-[10px] text-slate-600 text-center mt-4">
          随时取消 · 自动续费
        </p>
      </motion.div>
    </motion.div>
  );
};
