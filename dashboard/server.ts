import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const HOST = process.env.HOST || '127.0.0.1';
  const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);

  app.use(express.json({ limit: '256kb' }));

  // Strict local-origin CORS headers: reject untrusted cross-origin requests
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isLocal = origin === `http://${HOST}:${PORT}` ||
        origin === `http://127.0.0.1:${PORT}` ||
        origin === `http://localhost:${PORT}`;
      if (!isLocal) {
        res.status(403).json({ error: 'Cross-origin requests forbidden' });
        return;
      }
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key, x-target-url');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Universal Proxy Endpoint for CORS-restricted Worker or RPC requests during web preview
  app.all('/api/proxy', async (req: Request, res: Response) => {
    if (!ALLOWED_METHODS.has(req.method)) {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const targetUrl = (req.headers['x-target-url'] as string) || (req.query.url as string);
    if (!targetUrl) {
      res.status(400).json({ error: 'Missing x-target-url header or url query param' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: 'Invalid target URL' });
      return;
    }

    if (parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Only HTTPS targets are allowed' });
      return;
    }
    if (parsed.username || parsed.password) {
      res.status(400).json({ error: 'Credentials in URL are forbidden' });
      return;
    }

    // IP literal and cloud metadata rejection (IPv4, IPv6, octal, hex, loopback, link-local)
    const host = parsed.hostname.toLowerCase();
    if (/^(?:\d+|0x[0-9a-f]+|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(host) ||
        host === '169.254.169.254' || host === 'metadata.google.internal' || host === 'localhost') {
      res.status(403).json({ error: 'Direct IP literals and metadata hosts are forbidden' });
      return;
    }

    // Route-specific method and exact-origin destination validation
    let configuredWorkerOrigin: string | null = null;
    try {
      if (process.env.WORKER_URL) {
        const wUrl = new URL(process.env.WORKER_URL);
        if (wUrl.protocol === 'https:' && !wUrl.username && !wUrl.password) {
          configuredWorkerOrigin = wUrl.origin;
        }
      }
    } catch {}

    let configuredRpcOrigin = 'https://api.mainnet-beta.solana.com';
    try {
      if (process.env.RPC_URL) {
        const rUrl = new URL(process.env.RPC_URL);
        if (rUrl.protocol === 'https:' && !rUrl.username && !rUrl.password) {
          configuredRpcOrigin = rUrl.origin;
        }
      }
    } catch {}

    const isDex = parsed.origin === 'https://api.dexscreener.com' && parsed.pathname.startsWith('/latest/dex/tokens/') && req.method === 'GET';
    const isWorkerOrigin = configuredWorkerOrigin !== null && parsed.origin === configuredWorkerOrigin;
    const isWorkerRead = isWorkerOrigin && (parsed.pathname === '/signals' || parsed.pathname === '/export-kv') && req.method === 'GET';
    const isWorkerMutation = isWorkerOrigin && (parsed.pathname === '/heartbeat' || parsed.pathname === '/halt' || parsed.pathname === '/notify') && req.method === 'POST';
    const isRpc = parsed.origin === configuredRpcOrigin && req.method === 'POST';

    if (!isDex && !isWorkerRead && !isWorkerMutation && !isRpc) {
      res.status(403).json({ error: 'Target destination, method, or path is not permitted' });
      return;
    }

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };

      // Forward x-key only to approved Worker paths
      const xKey = req.headers['x-key'] as string;
      if (xKey && (isWorkerRead || isWorkerMutation)) {
        headers['x-key'] = xKey;
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      };

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const contentType = response.headers.get('content-type') || '';
      
      res.status(response.status);
      if (contentType.includes('application/json')) {
        const data = await response.json();
        res.json(data);
      } else {
        const text = await response.text();
        res.send(text);
      }
    } catch (err: any) {
      console.error('[Proxy Error]: upstream request failed');
      res.status(502).json({ error: 'Proxy request failed' });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Sniper Paper Bot Server running on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
