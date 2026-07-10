import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ALLOWED_HOST_SUFFIX = '.nocookie.net';

function thumbProxyPlugin(): Plugin {
  return {
    name: 'thumb-proxy',
    configureServer(server) {
      server.middlewares.use('/thumb', async (req, res) => {
        await handleThumbProxy(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/thumb', async (req, res) => {
        await handleThumbProxy(req, res);
      });
    },
  };
}

async function handleThumbProxy(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    const target = url.searchParams.get('u');
    if (!target) {
      res.statusCode = 400;
      res.end('missing image url');
      return;
    }

    const parsed = new URL(target);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith(ALLOWED_HOST_SUFFIX)) {
      res.statusCode = 403;
      res.end('host not allowed');
      return;
    }

    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'ComicReadingList/1.0' },
    });

    res.statusCode = upstream.status;
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'public, max-age=86400');

    if (!upstream.ok || !upstream.body) {
      res.end();
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.end(buffer);
  } catch {
    res.statusCode = 502;
    res.end('proxy error');
  }
}

export default defineConfig({
  plugins: [react(), thumbProxyPlugin()],
});
