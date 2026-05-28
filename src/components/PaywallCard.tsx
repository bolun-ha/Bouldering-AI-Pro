/**
 * 付费弹窗卡片
 *
 * 当用户用完免费次数后弹出：
 * - 3D 拟物风格（暗黑底 + 明黄色调）
 * - 两个 SKU 选择
 * - 当前仅 UI 就位，支付未接通
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Sparkles, Infinity } from 'lucide-react';
import { FEATURES } from '../config/features';

interface PaywallCardProps {
  isOpen: boolean;
  onClose: () => void;
}

const SKU_A = {
  title: '畅爬加油包',
  subtitle: '5 次专业复盘',
  price: '¥ 9.9',
  icon: Sparkles,
  color: 'from-amber-500 to-orange-500',
};

const SKU_B = {
  title: '无限次无限爽',
  subtitle: '永久无限次使用',
  price: '¥ 39.0',
  icon: Infinity,
  color: 'from-orange-500 to-rose-500',
};

export const PaywallCard: React.FC<PaywallCardProps> = ({ isOpen, onClose }) => {
  if (!FEATURES.PAYWALL_ENABLED && !isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative w-[320px] rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl shadow-orange-500/10"
            initial={{ scale: 0.85, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.85, y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 锁头装饰 */}
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center border border-orange-500/30">
                <Lock className="w-6 h-6 text-orange-400" />
              </div>
            </div>

            {/* 标题 */}
            <h2 className="text-center text-lg font-black text-white mb-1">
              免费次数已用完
            </h2>
            <p className="text-center text-xs text-slate-500 mb-6 leading-relaxed">
              单次岩馆门票 <span className="text-slate-400">¥100-¥180</span>
              <br />
              国家队教练复盘只要一杯奶茶钱
            </p>

            {/* SKU 选择 */}
            <div className="space-y-3 mb-6">
              {[SKU_A, SKU_B].map((sku) => (
                <button
                  key={sku.title}
                  className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-r from-slate-800 to-slate-800/80 border border-slate-700/50 p-4 text-left transition-all hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10 active:scale-[0.98]"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${sku.color} flex items-center justify-center shadow-lg`}>
                      <sku.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-sm">{sku.title}</span>
                        <span className={`text-sm font-black bg-gradient-to-r ${sku.color} bg-clip-text text-transparent`}>
                          {sku.price}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{sku.subtitle}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* 底部提示 */}
            <p className="text-[9px] text-slate-600 text-center leading-relaxed">
              支付功能接入中 · 当前为演示页面
              <br />
              觉得有用请联系开发者解锁
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
