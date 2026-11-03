/**
 * Cloudflare Workers 入口。
 *
 * 同时承担：
 * - /api/*：交给 functions/api/handler.js 的 onRequest
 * - 其余请求：由 Workers Static Assets 返回 public/ 中的文件
 *
 * Workers Builds 的 `npx wrangler deploy` 会读取 wrangler.toml 的 main 与 [assets]。
 */
import { onRequest } from './functions/api/handler.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function withHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  if (pathname === '/sw.js') {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (pathname === '/manifest.webmanifest') {
    headers.set('Cache-Control', 'no-cache');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return withHeaders(await onRequest({ request, env, ctx }), url.pathname);
    }
    if (env?.ASSETS?.fetch) {
      return withHeaders(await env.ASSETS.fetch(request), url.pathname);
    }
    return new Response('Static assets binding is not configured.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...SECURITY_HEADERS,
      },
    });
  },
};
