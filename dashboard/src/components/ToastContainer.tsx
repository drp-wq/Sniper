/**
 * Toast Notification Container
 * Renders high-contrast, unobtrusive notification toasts for paper trade events.
 */

import React from 'react';
import { ToastMessage } from '../types';
import {
  Zap,
  TrendingUp,
  AlertTriangle,
  Info,
  CheckCircle,
  X,
} from 'lucide-react';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-14 right-3 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none font-mono text-xs">
      {toasts.map(toast => {
        let borderClass = 'border-zinc-700 bg-zinc-900';
        let Icon = Info;
        let iconColor = 'text-zinc-400';

        if (toast.type === 'buy') {
          borderClass = 'border-emerald-500/50 bg-[#0B1A12] shadow-emerald-950/40';
          Icon = Zap;
          iconColor = 'text-emerald-400';
        } else if (toast.type === 'tp') {
          borderClass = 'border-purple-500/50 bg-[#160B24] shadow-purple-950/40';
          Icon = TrendingUp;
          iconColor = 'text-purple-400';
        } else if (toast.type === 'sl') {
          borderClass = 'border-red-500/50 bg-[#210B0E] shadow-red-950/40';
          Icon = AlertTriangle;
          iconColor = 'text-red-400';
        } else if (toast.type === 'warn') {
          borderClass = 'border-amber-500/50 bg-[#21160B] shadow-amber-950/40';
          Icon = AlertTriangle;
          iconColor = 'text-amber-400';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 p-3 rounded-xl border shadow-xl transition-all duration-300 animate-in slide-in-from-top-2 ${borderClass}`}
          >
            <div className={`p-1.5 rounded-lg bg-black/40 ${iconColor} shrink-0 mt-0.5`}>
              <Icon className="w-4 h-4" />
            </div>

            <div className="flex-1 pr-1">
              <div className="font-bold text-white text-xs leading-tight">{toast.title}</div>
              <div className="text-[11px] text-zinc-300 mt-0.5 leading-snug whitespace-pre-line">{toast.message}</div>
              <div className="text-[9px] text-zinc-500 mt-1">
                {new Date(toast.timestamp).toLocaleTimeString()}
              </div>
            </div>

            <button
              onClick={() => onDismiss(toast.id)}
              className="text-zinc-500 hover:text-white p-1 rounded-md shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
