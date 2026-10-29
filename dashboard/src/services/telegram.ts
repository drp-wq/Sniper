/**
 * Telegram Mini App (TMA) Integration Service
 * Seamlessly integrates the Solana Sniper Terminal inside Telegram WebApp
 * Features:
 * - Viewport expansion & closing confirmation
 * - Native Telegram HapticFeedback (Buy, TP, SL, Halt)
 * - Safe Area insets and dark theme alignment
 * - Automatic zero-config handshake via StartParam or URL params
 */

import { StorageService } from './storage.ts';

export type TelegramHapticType = 'buy' | 'tp' | 'sl' | 'click' | 'warn' | 'halt';

export interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export const TelegramService = {
  getWebApp(): any {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      return (window as any).Telegram.WebApp;
    }
    return null;
  },

  isTma(): boolean {
    const wa = this.getWebApp();
    return Boolean(wa && (wa.initData || wa.initDataUnsafe?.user));
  },

  getUser(): TelegramUser | null {
    const wa = this.getWebApp();
    return wa?.initDataUnsafe?.user || null;
  },

  init(): void {
    const wa = this.getWebApp();
    if (!wa) return;

    try {
      // 1. Tell Telegram client the app is ready
      if (typeof wa.ready === 'function') {
        wa.ready();
      }

      // 2. Expand viewport to full height on mobile
      if (typeof wa.expand === 'function') {
        wa.expand();
      }

      // 3. Prevent accidental swipe-down closing while monitoring trades
      if (typeof wa.enableClosingConfirmation === 'function') {
        wa.enableClosingConfirmation();
      }

      // 4. Align header and background color to our dark theme
      if (typeof wa.setHeaderColor === 'function') {
        wa.setHeaderColor('#0B0F17');
      }
      if (typeof wa.setBackgroundColor === 'function') {
        wa.setBackgroundColor('#0B0F17');
      }

      // 5. Zero-config credential handshake:
      // Check query string or Telegram start_param for auto-configuration
      this.checkAndApplyAutoConfig();
    } catch (e) {
      console.warn('Telegram WebApp init non-fatal warning:', e);
    }
  },

  checkAndApplyAutoConfig(): void {
    try {
      if (typeof window === 'undefined') return;
      const urlParams = new URLSearchParams(window.location.search);
      const wa = this.getWebApp();

      const workerParam = urlParams.get('worker') || urlParams.get('workerUrl');
      const keyParam = urlParams.get('key') || urlParams.get('appKey');
      const startParam = wa?.initDataUnsafe?.start_param || urlParams.get('tgWebAppStartParam');

      let autoWorker = workerParam || '';
      let autoKey = keyParam || '';

      // If start_param is encoded (e.g., base64 or key:worker)
      if (startParam && (!autoWorker || !autoKey)) {
        try {
          if (startParam.startsWith('cfg_')) {
            const decoded = atob(startParam.slice(4));
            const parsed = JSON.parse(decoded);
            if (parsed.workerUrl) autoWorker = parsed.workerUrl;
            if (parsed.appKey) autoKey = parsed.appKey;
          }
        } catch {}
      }

      if (autoWorker || autoKey) {
        const current = StorageService.getConfig();
        const updated = {
          ...current,
          ...(autoWorker ? { workerUrl: autoWorker } : {}),
          ...(autoKey ? { appKey: autoKey } : {}),
        };
        StorageService.saveConfig(updated);
        console.log('[TMA] Auto-configured credentials from Telegram launch context');
      }
    } catch (err) {
      console.warn('[TMA] Auto-config check skipped:', err);
    }
  },

  haptic(type: TelegramHapticType): void {
    const wa = this.getWebApp();
    if (!wa || !wa.HapticFeedback) return;

    try {
      switch (type) {
        case 'buy':
          wa.HapticFeedback.notificationOccurred('success');
          break;
        case 'tp':
          wa.HapticFeedback.notificationOccurred('success');
          break;
        case 'sl':
          wa.HapticFeedback.notificationOccurred('error');
          break;
        case 'warn':
        case 'halt':
          wa.HapticFeedback.notificationOccurred('warning');
          break;
        case 'click':
          wa.HapticFeedback.impactOccurred('light');
          break;
      }
    } catch {}
  },

  close(): void {
    const wa = this.getWebApp();
    if (wa && typeof wa.close === 'function') {
      wa.close();
    }
  },
};
