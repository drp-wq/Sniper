/**
 * Worker API Client
 * Connects directly to Cloudflare Worker SignalQueueDO SQLite Durable Object
 * Enforces headers: `x-key: <APP_KEY>` and `content-type: application/json`
 * Automatically falls back to /api/proxy in browser environments if CORS is restricted.
 */

import type { AppConfig, SignalsResponse, WorkerExportKv } from '../types/index.ts';
import { TelegramService } from './telegram.ts';

export function getBaseUrl(config?: AppConfig): string {
  const custom = config?.workerUrl?.trim();
  if (custom && custom.startsWith('http')) {
    return custom.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http')) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'https://sniper-relay.pjdebnath01.workers.dev';
}

export function getAppKey(config?: AppConfig): string {
  const custom = config?.appKey?.trim();
  if (custom) return custom;
  return '';
}

interface FetchResult<T> {
  data: T | null;
  error?: string;
  latencyMs: number;
}

async function requestWithFallback<T>(
  url: string,
  options: RequestInit,
  config: AppConfig
): Promise<FetchResult<T>> {
  const start = performance.now();
  const absoluteUrl = url.startsWith('http')
    ? url
    : `${getBaseUrl(config)}${url.startsWith('/') ? '' : '/'}${url}`;

  const appKey = getAppKey(config);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (appKey) {
    headers['x-key'] = appKey;
  }
  const initData = TelegramService.getWebApp()?.initData;
  if (initData) {
    headers['x-init'] = initData;
  }

  // 0. If running inside our native Android APK WebView with AndroidBridge, use native Java HttpURLConnection
  const bridge = typeof window !== 'undefined' ? (window as any).AndroidBridge : null;
  if (bridge && typeof bridge.httpRequest === 'function') {
    try {
      const mergedHeaders = {
        ...headers,
        ...(options.headers as Record<string, string>),
      };
      const bodyStr = options.body ? String(options.body) : '';
      const rawRes = bridge.httpRequest(
        absoluteUrl,
        options.method || 'GET',
        JSON.stringify(mergedHeaders),
        bodyStr
      );
      const parsed = JSON.parse(rawRes);
      const latencyMs = Math.round(performance.now() - start);
      if (parsed.ok && parsed.body) {
        return { data: JSON.parse(parsed.body) as T, latencyMs };
      }
      if (!parsed.ok) {
        return {
          data: null,
          error: parsed.error || `HTTP ${parsed.status}`,
          latencyMs,
        };
      }
    } catch {
      // Fall through to standard fetch / proxy
    }
  }

  // 1. Attempt direct request first (Native APK / Capacitor / Direct CORS)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const directRes = await fetch(absoluteUrl, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers as Record<string, string>),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Math.round(performance.now() - start);

    if (!directRes.ok) {
      const errText = await directRes.text().catch(() => '');
      return {
        data: null,
        error: `HTTP ${directRes.status}: ${errText.slice(0, 80) || directRes.statusText}`,
        latencyMs,
      };
    }

    const data = await directRes.json();
    return { data, latencyMs };
  } catch (err: any) {
    // If browser CORS error or fetch failed, fallback to Worker /api/proxy
    try {
      const proxyHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-target-url': absoluteUrl,
      };
      if (appKey) {
        proxyHeaders['x-key'] = appKey;
      }

      const proxyRes = await fetch('/api/proxy', {
        ...options,
        headers: {
          ...proxyHeaders,
          ...(options.headers as Record<string, string>),
        },
      });

      const latencyMs = Math.round(performance.now() - start);
      if (!proxyRes.ok) {
        const errText = await proxyRes.text().catch(() => '');
        return {
          data: null,
          error: `Proxy HTTP ${proxyRes.status}: ${errText.slice(0, 80)}`,
          latencyMs,
        };
      }

      const data = await proxyRes.json();
      return { data, latencyMs };
    } catch (fallbackErr: any) {
      const latencyMs = Math.round(performance.now() - start);
      return {
        data: null,
        error: 'Network connection failed: Worker unreachable',
        latencyMs,
      };
    }
  }
}

export const WorkerApi = {
  /**
   * GET {WORKER_URL}/signals?since={cursor}
   */
  async getSignals(config: AppConfig, since: number): Promise<FetchResult<SignalsResponse>> {
    const base = getBaseUrl(config);
    const url = `${base}/signals?since=${since}`;
    return requestWithFallback<SignalsResponse>(url, { method: 'GET' }, config);
  },

  /**
   * GET {WORKER_URL}/export-kv
   */
  async exportKv(config: AppConfig): Promise<FetchResult<WorkerExportKv>> {
    const base = getBaseUrl(config);
    const url = `${base}/export-kv`;
    return requestWithFallback<WorkerExportKv>(url, { method: 'GET' }, config);
  },

  /**
   * POST {WORKER_URL}/api/halt?on={1|0} (or /halt?on={1|0})
   */
  async toggleHalt(config: AppConfig, haltOn: boolean): Promise<FetchResult<{ halt: boolean }>> {
    const base = getBaseUrl(config);
    const initData = TelegramService.getWebApp()?.initData;
    const url = initData ? `${base}/api/halt?on=${haltOn ? 1 : 0}` : `${base}/halt?on=${haltOn ? 1 : 0}`;
    return requestWithFallback<{ halt: boolean }>(url, { method: 'POST' }, config);
  },

  /**
   * GET {WORKER_URL}/api/state
   */
  async getState(config: AppConfig): Promise<FetchResult<any>> {
    const base = getBaseUrl(config);
    const url = `${base}/api/state`;
    return requestWithFallback<any>(url, { method: 'GET' }, config);
  },

  /**
   * POST {WORKER_URL}/api/rules
   */
  async setRules(config: AppConfig, rules: Record<string, number>): Promise<FetchResult<any>> {
    const base = getBaseUrl(config);
    const url = `${base}/api/rules`;
    return requestWithFallback<any>(url, { method: 'POST', body: JSON.stringify(rules) }, config);
  },

  /**
   * GET {WORKER_URL}/api/audit
   */
  async getAudit(config: AppConfig): Promise<FetchResult<any>> {
    const base = getBaseUrl(config);
    const url = `${base}/api/audit`;
    return requestWithFallback<any>(url, { method: 'GET' }, config);
  },

  /**
   * POST {WORKER_URL}/heartbeat
   * Body: { open: number }
   */
  async sendHeartbeat(config: AppConfig, openPositionsCount: number): Promise<FetchResult<{ ok: boolean }>> {
    const base = getBaseUrl(config);
    const url = `${base}/heartbeat`;
    return requestWithFallback<{ ok: boolean }>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({ open: openPositionsCount }),
      },
      config
    );
  },

  /**
   * POST {WORKER_URL}/notify
   * Body: { text: "PAPER BUY <mint>..." }
   */
  async sendNotify(config: AppConfig, text: string): Promise<FetchResult<{ ok: boolean }>> {
    const base = getBaseUrl(config);
    const url = `${base}/notify`;
    return requestWithFallback<{ ok: boolean }>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
      config
    );
  },

  /**
   * POST {WORKER_URL}/api/telegram-config
   * Body: { tgToken: string, tgChat: string }
   */
  async saveTelegramConfig(
    config: AppConfig,
    tgToken: string,
    tgChat: string
  ): Promise<FetchResult<{ ok: boolean; sent?: boolean }>> {
    const base = getBaseUrl(config);
    const url = `${base}/api/telegram-config`;
    return requestWithFallback<{ ok: boolean; sent?: boolean }>(
      url,
      {
        method: 'POST',
        body: JSON.stringify({ tgToken, tgChat }),
      },
      config
    );
  },
};
