/**
 * Cloudflare Workers 入口。
 *
 * 同时承担：
 * - /api/*：交给 functions/api/[[path]].js 的 onRequest
 * - 其余请求：由 Workers Static Assets 返回 public/ 中的文件
 *
 * 这样 Workers Builds 的 `npx wrangler deploy` 既能识别静态目录，
 * 也能部署 API，不会再报 “Could not detect a directory containing static files”。
 */
import { onRequest } from './functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return onRequest({ request, env, ctx });
    }
    if (env?.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Static assets binding is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
