import type { Env, LicenseRow, KeyStats } from './types';
import { generateLicenseKey } from './keygen';
import { validateGenerateRequest } from './validation';

/** Authenticate admin requests via X-Admin-Key header (constant-time) */
function authenticateAdmin(request: Request, env: Env): boolean {
  const key = request.headers.get('X-Admin-Key');
  if (!key || !env.ADMIN_KEY) return false;
  if (key.length !== env.ADMIN_KEY.length) return false;
  let result = 0;
  for (let i = 0; i < key.length; i++) {
    result |= key.charCodeAt(i) ^ env.ADMIN_KEY.charCodeAt(i);
  }
  return result === 0;
}

/** POST /admin/keys/generate — create a new license key */
async function handleGenerate(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (!validateGenerateRequest(body)) {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const licenseKey = generateLicenseKey();
  const keyType = body.type || 'paid';

  const result = await env.LICENSE_DB.prepare(
    `INSERT INTO licenses (license_key, email, type, stripe_payment_id, trivi_document_id, note)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, license_key, email, type, status, created_at`
  )
    .bind(
      licenseKey,
      body.email,
      keyType,
      body.stripePaymentId || null,
      body.triviDocumentId || null,
      body.note || null
    )
    .first();

  if (!result) {
    return Response.json({ error: 'Failed to create key' }, { status: 500 });
  }

  return Response.json({
    id: result.id,
    licenseKey: result.license_key,
    email: result.email,
    type: result.type,
    status: result.status,
    createdAt: result.created_at,
  });
}

/** GET /admin/keys — list keys with optional filters */
async function handleList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const email = url.searchParams.get('email');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  let query = 'SELECT * FROM licenses WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (email) {
    query += ' AND email = ?';
    params.push(email);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await env.LICENSE_DB.prepare(query)
    .bind(...params)
    .all<LicenseRow>();

  return Response.json({
    keys: result.results.map(formatKeyResponse),
    meta: { limit, offset },
  });
}

/** GET /admin/keys/:id — single key details */
async function handleGetKey(env: Env, keyId: string): Promise<Response> {
  const row = await env.LICENSE_DB.prepare('SELECT * FROM licenses WHERE id = ?')
    .bind(keyId)
    .first<LicenseRow>();

  if (!row) {
    return Response.json({ error: 'Key not found' }, { status: 404 });
  }

  return Response.json(formatKeyResponse(row));
}

/** PUT /admin/keys/:id/revoke — revoke a key */
async function handleRevoke(env: Env, keyId: string): Promise<Response> {
  const result = await env.LICENSE_DB.prepare(
    `UPDATE licenses SET status = 'revoked' WHERE id = ? AND status = 'active' RETURNING id, status`
  )
    .bind(keyId)
    .first();

  if (!result) {
    return Response.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  return Response.json({ id: result.id, status: 'revoked' });
}

/** PUT /admin/keys/:id/reset — clear installation binding */
async function handleReset(env: Env, keyId: string): Promise<Response> {
  const result = await env.LICENSE_DB.prepare(
    `UPDATE licenses SET installation_id = NULL, activated_at = NULL
     WHERE id = ? RETURNING id, installation_id`
  )
    .bind(keyId)
    .first();

  if (!result) {
    return Response.json({ error: 'Key not found' }, { status: 404 });
  }

  return Response.json({ id: result.id, installationId: null, message: 'Installation reset' });
}

/** GET /admin/keys/stats — aggregate statistics */
async function handleStats(env: Env): Promise<Response> {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [total, active, revoked, tester, last24h, last7d] = await Promise.all([
    env.LICENSE_DB.prepare('SELECT COUNT(*) as count FROM licenses').first<{ count: number }>(),
    env.LICENSE_DB.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'active'").first<{
      count: number;
    }>(),
    env.LICENSE_DB.prepare(
      "SELECT COUNT(*) as count FROM licenses WHERE status = 'revoked'"
    ).first<{ count: number }>(),
    env.LICENSE_DB.prepare("SELECT COUNT(*) as count FROM licenses WHERE type = 'tester'").first<{
      count: number;
    }>(),
    env.LICENSE_DB.prepare(
      'SELECT COUNT(*) as count FROM licenses WHERE activated_at >= ?'
    )
      .bind(h24)
      .first<{ count: number }>(),
    env.LICENSE_DB.prepare(
      'SELECT COUNT(*) as count FROM licenses WHERE activated_at >= ?'
    )
      .bind(d7)
      .first<{ count: number }>(),
  ]);

  const stats: KeyStats = {
    total: total?.count ?? 0,
    active: active?.count ?? 0,
    revoked: revoked?.count ?? 0,
    tester: tester?.count ?? 0,
    activatedLast24h: last24h?.count ?? 0,
    activatedLast7d: last7d?.count ?? 0,
  };

  return Response.json(stats);
}

function formatKeyResponse(row: LicenseRow) {
  return {
    id: row.id,
    licenseKey: row.license_key,
    email: row.email,
    type: row.type,
    stripePaymentId: row.stripe_payment_id,
    triviDocumentId: row.trivi_document_id,
    installationId: row.installation_id,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    lastValidatedAt: row.last_validated_at,
    resetCount: row.reset_count,
    maxResets: row.max_resets,
  };
}

/** Route admin requests */
export async function handleAdmin(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  if (!authenticateAdmin(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // POST /admin/keys/generate
  if (pathname === '/admin/keys/generate' && request.method === 'POST') {
    return handleGenerate(request, env);
  }

  // GET /admin/keys/stats (must come before /admin/keys/:id)
  if (pathname === '/admin/keys/stats' && request.method === 'GET') {
    return handleStats(env);
  }

  // GET /admin/keys
  if (pathname === '/admin/keys' && request.method === 'GET') {
    return handleList(request, env);
  }

  // Routes with key ID parameter
  const keyIdMatch = pathname.match(/^\/admin\/keys\/([a-f0-9]+)(?:\/(revoke|reset))?$/);
  if (keyIdMatch) {
    const keyId = keyIdMatch[1];
    const action = keyIdMatch[2];

    if (!action && request.method === 'GET') {
      return handleGetKey(env, keyId);
    }
    if (action === 'revoke' && request.method === 'PUT') {
      return handleRevoke(env, keyId);
    }
    if (action === 'reset' && request.method === 'PUT') {
      return handleReset(env, keyId);
    }
  }

  return new Response('Not found', { status: 404 });
}
