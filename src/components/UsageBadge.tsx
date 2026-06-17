/**
 * 剩余次数看板
 *
 * 页面右上角常驻显示剩余免费分析次数
 * 默认隐藏（由 FEATURES.PAYWALL_ENABLED 控制）
 */

import React from 'react';
import { Zap } from 'lucide-react';
import { FEATURES } from '../config/features';

interface UsageBadgeProps {
  /** 当前剩余次数（-1 = 无限，null = 未知） */
  remaining: number | null;
  /** 是否正在加载 */
  loading?: boolean;
}

export const UsageBadge: React.FC<UsageBadgeProps> = ({ remaining, loading }) => {
  if (!FEATURES.PAYWALL_ENABLED) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-800/50 border border-slate-700/30 animate-pulse">
        <Zap className="w-2.5 h-2.5 text-slate-500" />
        <span className="text-[9px] font-bold text-slate-500">···</span>
      </div>
    );
  }

  if (remaining === -1) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-900/30 border border-emerald-700/30">
        <Zap className="w-2.5 h-2.5 text-emerald-400" />
        <span className="text-[9px] font-bold text-emerald-400">无限次</span>
      </div>
    );
  }

  if (remaining === null) return null;

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-900/30 border border-red-700/30">
        <Zap className="w-2.5 h-2.5 text-red-400" />
        <span className="text-[9px] font-bold text-red-400">已用尽</span>
      </div>
    );
  }

  const isCritical = remaining <= 1;

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-md border ${isCritical ? 'bg-amber-900/30 border-amber-600/40 animate-pulse' : 'bg-slate-800/50 border-slate-700/30'}`}>
      <Zap className={`w-2.5 h-2.5 ${isCritical ? 'text-amber-400' : 'text-orange-400'}`} />
      <span className={`text-[9px] font-bold ${isCritical ? 'text-amber-300' : 'text-slate-300'}`}>
        剩 {remaining} 次
      </span>
    </div>
  );
};
