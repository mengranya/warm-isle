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

async function proxyControl(request, env, url) {
  const origin = String(env?.CONTROL_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!origin) {
    return new Response(JSON.stringify({ ok: true, announcements: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  try {
    const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        Accept: 'application/json',
      },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ ok: true, announcements: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // API Key 加密依赖 WebCrypto，必须优先进入安全上下文。
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/api/control/')) {
      return withHeaders(await proxyControl(request, env, url), url.pathname);
    }
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
