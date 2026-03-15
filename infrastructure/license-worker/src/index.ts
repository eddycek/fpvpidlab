import type { Env } from './types';
import { handleAdmin } from './admin';
import { handleActivate, handleValidate, handleSelfReset } from './license';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS headers for Electron app
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let response: Response;

    try {
      // License endpoints (public)
      if (pathname === '/license/activate' && request.method === 'POST') {
        response = await handleActivate(request, env);
      } else if (pathname === '/license/validate' && request.method === 'POST') {
        response = await handleValidate(request, env);
      } else if (pathname === '/license/reset' && request.method === 'POST') {
        response = await handleSelfReset(request, env);
      }
      // Admin endpoints (authenticated)
      else if (pathname.startsWith('/admin/')) {
        response = await handleAdmin(request, env, pathname);
      }
      // Health check
      else if (pathname === '/health') {
        response = Response.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
      } else {
        response = new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error('Worker error:', err);
      response = new Response('Internal server error', { status: 500 });
    }

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
