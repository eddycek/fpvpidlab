import type { Env } from './types';
import { isValidUUID, checkPayloadSize } from './validation';

/** Diagnostic report metadata stored in R2 */
interface DiagnosticMetadata {
  reportId: string;
  installationId: string;
  userEmail?: string;
  status: 'new' | 'reviewing' | 'resolved' | 'needs-bbl';
  createdAt: string;
  reviewedAt?: string;
  resolvedAt?: string;
  resolution?: 'fixed' | 'user-error' | 'known-limitation' | 'wontfix';
  resolutionMessage?: string;
  internalNote?: string;
  /** Whether BBL flight data is attached */
  hasBbl?: boolean;
  /** BBL file size in bytes */
  bblSizeBytes?: number;
  /** When BBL was uploaded */
  bblUploadedAt?: string;
  /** When BBL was expired by retention cron */
  bblExpiredAt?: string;
  preview: {
    mode: string;
    droneSize?: string;
    bfVersion?: string;
    dataQualityTier: string;
    recCount: number;
    userNote?: string;
  };
}

const DEFAULT_BBL_MAX_SIZE = 50 * 1024 * 1024; // 50 MB

const DEFAULT_RATE_LIMIT_WINDOW_MIN = 60;
const DEFAULT_RATE_LIMIT_MAX = 5;

/** POST /v1/diagnostic — submit a diagnostic report */
export async function handleDiagnosticUpload(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await request.text();
  if (!checkPayloadSize(body)) {
    return new Response('Payload too large', { status: 413 });
  }

  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Validate required fields
  if (!data.reportId || !data.installationId || !data.mode || !data.timestamp) {
    return new Response('Missing required fields', { status: 400 });
  }
  if (!isValidUUID(data.reportId) || !isValidUUID(data.installationId)) {
    return new Response('Invalid ID format', { status: 400 });
  }

  // Rate limit: configurable via env (default 5 per 60 min)
  const rateLimitMax = parseInt(env.DIAGNOSTIC_RATE_LIMIT_MAX ?? '', 10) || DEFAULT_RATE_LIMIT_MAX;
  const rateLimitWindowMs =
    (parseInt(env.DIAGNOSTIC_RATE_LIMIT_WINDOW_MIN ?? '', 10) || DEFAULT_RATE_LIMIT_WINDOW_MIN) *
    60 *
    1000;
  try {
    const recentKey = `diagnostics/_rate/${data.installationId}.json`;
    const now = Date.now();
    let timestamps: number[] = [];
    const existing = await env.TELEMETRY_BUCKET.get(recentKey);
    if (existing) {
      const meta: { timestamps: number[] } = await existing.json();
      timestamps = (meta.timestamps ?? []).filter((t) => now - t < rateLimitWindowMs);
    }
    if (timestamps.length >= rateLimitMax) {
      return new Response(
        `Rate limited — max ${rateLimitMax} diagnostic reports per ${Math.round(rateLimitWindowMs / 60000)} min`,
        { status: 429 }
      );
    }
    timestamps.push(now);
    await env.TELEMETRY_BUCKET.put(recentKey, JSON.stringify({ timestamps }), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    // Rate limit check failed, allow the upload
  }

  const reportId = data.reportId;
  const prefix = `diagnostics/${reportId}`;

  // Store bundle
  await env.TELEMETRY_BUCKET.put(`${prefix}/bundle.json`, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  // Store metadata
  const metadata: DiagnosticMetadata = {
    reportId,
    installationId: data.installationId,
    userEmail: data.userEmail,
    status: 'new',
    createdAt: new Date().toISOString(),
    preview: {
      mode: data.mode,
      droneSize: data.droneSize,
      bfVersion: data.bfVersion,
      dataQualityTier: data.dataQuality?.tier ?? 'unknown',
      recCount: data.recommendations?.length ?? 0,
      userNote: data.userNote?.substring(0, 200),
    },
  };

  await env.TELEMETRY_BUCKET.put(`${prefix}/metadata.json`, JSON.stringify(metadata), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Send email notification
  await sendNewReportEmail(env, metadata);

  return Response.json({ reportId, status: 'ok' });
}

/** Send notification email for new diagnostic report */
async function sendNewReportEmail(env: Env, meta: DiagnosticMetadata): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL || !env.REPORT_FROM_EMAIL) return;

  const p = meta.preview;
  const subject = `[FPVPIDlab] New diagnostic report — ${p.mode} ${p.droneSize ?? ''}`.trim();
  const text = `New Diagnostic Report
${'═'.repeat(40)}
Report ID:      ${meta.reportId}
Mode:           ${p.mode}
Drone:          ${p.droneSize ?? 'N/A'}
BF Version:     ${p.bfVersion ?? 'N/A'}
Data Quality:   ${p.dataQualityTier}
Recommendations: ${p.recCount}
User Email:     ${meta.userEmail ?? '(not provided)'}
User Note:      ${p.userNote ?? '(none)'}

Review: /diagnose ${meta.reportId}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: [env.REPORT_EMAIL],
        subject,
        text,
      }),
    });
  } catch (err) {
    console.error('Failed to send diagnostic notification email:', err);
  }
}

/** Send resolution email to user */
async function sendResolutionEmail(
  env: Env,
  userEmail: string,
  message: string
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_FROM_EMAIL) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: [userEmail],
        subject: 'Your FPVPIDlab report has been resolved',
        text: `Hi,

Thanks for reporting the tuning issue. We've investigated and here's what we found:

${message}

If you update FPVPIDlab, this should work better on your next tuning session.
Let us know if you have any other issues!

— FPVPIDlab Team`,
      }),
    });
  } catch (err) {
    console.error('Failed to send resolution email:', err);
  }
}

/** PATCH /v1/diagnostic/{reportId} — add user details to existing (auto) report */
export async function handleDiagnosticPatch(request: Request, env: Env, reportId: string): Promise<Response> {
  if (request.method !== 'PATCH') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!isValidUUID(reportId)) {
    return new Response('Invalid report ID', { status: 400 });
  }

  // Verify report exists
  const prefix = `diagnostics/${reportId}`;
  const metaObj = await env.TELEMETRY_BUCKET.get(`${prefix}/metadata.json`);
  if (!metaObj) {
    return new Response('Report not found', { status: 404 });
  }

  // Verify installation ID matches (only report creator can patch)
  const metadata: DiagnosticMetadata = await metaObj.json();
  const installationId = request.headers.get('X-Installation-Id');
  if (!installationId || installationId !== metadata.installationId) {
    return new Response('Forbidden', { status: 403 });
  }

  // Parse patch body with size guard
  const body = await request.text();
  if (!checkPayloadSize(body)) {
    return new Response('Payload too large', { status: 413 });
  }

  let patch: { userEmail?: string; userNote?: string };
  try {
    patch = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Enforce reasonable field lengths
  const email = patch.userEmail?.substring(0, 320);
  const note = patch.userNote?.substring(0, 2000);

  // Update metadata
  if (email) {
    metadata.userEmail = email;
  }
  if (note) {
    metadata.preview.userNote = note.substring(0, 200);
  }

  await env.TELEMETRY_BUCKET.put(`${prefix}/metadata.json`, JSON.stringify(metadata), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Also update the bundle with user details
  const bundleObj = await env.TELEMETRY_BUCKET.get(`${prefix}/bundle.json`);
  if (bundleObj) {
    const bundle: Record<string, unknown> = await bundleObj.json();
    if (email) bundle.userEmail = email;
    if (note) bundle.userNote = note;
    await env.TELEMETRY_BUCKET.put(`${prefix}/bundle.json`, JSON.stringify(bundle), {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  // Send notification email about user-added details
  if (patch.userEmail || patch.userNote) {
    await sendPatchNotificationEmail(env, metadata);
  }

  return Response.json({ status: 'ok', reportId });
}

/** Send notification email when user adds details to auto-report */
async function sendPatchNotificationEmail(
  env: Env,
  meta: DiagnosticMetadata
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL || !env.REPORT_FROM_EMAIL) return;

  const subject = `[FPVPIDlab] User added details to auto-report ${meta.reportId.slice(0, 8)}`;
  const text = `User Details Added to Auto-Report
${'═'.repeat(40)}
Report ID:   ${meta.reportId}
User Email:  ${meta.userEmail ?? '(not provided)'}
User Note:   ${meta.preview.userNote ?? '(none)'}

Original Mode: ${meta.preview.mode}
Drone:         ${meta.preview.droneSize ?? 'N/A'}

Review: /diagnose ${meta.reportId}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.REPORT_FROM_EMAIL,
        to: [env.REPORT_EMAIL],
        subject,
        text,
      }),
    });
  } catch (err) {
    console.error('Failed to send patch notification email:', err);
  }
}

/** PUT /v1/diagnostic/{reportId}/bbl — upload BBL flight data */
export async function handleBBLUpload(request: Request, env: Env, reportId: string): Promise<Response> {
  if (request.method !== 'PUT') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!isValidUUID(reportId)) {
    return new Response('Invalid report ID', { status: 400 });
  }

  // Verify report exists
  const metaObj = await env.TELEMETRY_BUCKET.get(`diagnostics/${reportId}/metadata.json`);
  if (!metaObj) {
    return new Response('Report not found', { status: 404 });
  }

  // Verify installation ID matches (only report creator can upload BBL)
  const metadata: DiagnosticMetadata = await metaObj.json();
  const installationId = request.headers.get('X-Installation-Id');
  if (!installationId || installationId !== metadata.installationId) {
    return new Response('Forbidden', { status: 403 });
  }

  // Require valid Content-Length (reject streamed/chunked requests without it)
  const contentLength = parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (!contentLength || contentLength <= 0) {
    return new Response('Content-Length header required', { status: 411 });
  }
  const maxSize = parseInt(env.BBL_MAX_SIZE_BYTES ?? '', 10) || DEFAULT_BBL_MAX_SIZE;
  if (contentLength > maxSize) {
    return new Response(`BBL file too large (max ${Math.round(maxSize / 1024 / 1024)} MB)`, { status: 413 });
  }

  // Check if already uploaded (idempotent)
  if (metadata.hasBbl) {
    return Response.json({ status: 'ok', message: 'BBL already uploaded' });
  }

  // Stream request body directly to R2
  if (!request.body) {
    return new Response('No body', { status: 400 });
  }

  await env.TELEMETRY_BUCKET.put(`diagnostics/${reportId}/flight.bbl`, request.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  // Update metadata (clear expired state on re-upload)
  metadata.hasBbl = true;
  metadata.bblSizeBytes = contentLength;
  metadata.bblUploadedAt = new Date().toISOString();
  delete metadata.bblExpiredAt;

  await env.TELEMETRY_BUCKET.put(
    `diagnostics/${reportId}/metadata.json`,
    JSON.stringify(metadata),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return Response.json({ status: 'ok' });
}

/** Authenticate admin requests */
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

/** Route diagnostic admin requests */
export async function handleDiagnosticAdmin(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  if (!authenticateAdmin(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // GET /admin/diagnostics — list reports
  if (pathname === '/admin/diagnostics' && request.method === 'GET') {
    return handleListDiagnostics(request, env);
  }

  // GET /admin/diagnostics/summary — counts for weekly report
  if (pathname === '/admin/diagnostics/summary' && request.method === 'GET') {
    return handleDiagnosticsSummary(env);
  }

  // GET /admin/diagnostics/{reportId}/bbl — download BBL file
  const bblMatch = pathname.match(/^\/admin\/diagnostics\/([0-9a-f-]+)\/bbl$/);
  if (bblMatch && request.method === 'GET') {
    return handleAdminBBLDownload(env, bblMatch[1]);
  }

  // GET/PATCH /admin/diagnostics/{reportId}
  const match = pathname.match(/^\/admin\/diagnostics\/([0-9a-f-]+)$/);
  if (match) {
    const reportId = match[1];
    if (request.method === 'GET') {
      return handleGetDiagnostic(env, reportId);
    }
    if (request.method === 'PATCH') {
      return handleUpdateDiagnostic(request, env, reportId);
    }
  }

  return new Response('Not found', { status: 404 });
}

/** GET /admin/diagnostics/{reportId}/bbl — download BBL file */
async function handleAdminBBLDownload(env: Env, reportId: string): Promise<Response> {
  const bblObj = await env.TELEMETRY_BUCKET.get(`diagnostics/${reportId}/flight.bbl`);
  if (!bblObj) {
    return Response.json({ error: 'BBL file not found' }, { status: 404 });
  }

  return new Response(bblObj.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="diagnostic-${reportId}.bbl"`,
    },
  });
}

/** GET /admin/diagnostics — list all reports */
async function handleListDiagnostics(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);

  const reports: DiagnosticMetadata[] = [];
  let cursor: string | undefined;

  do {
    const listed = await env.TELEMETRY_BUCKET.list({
      prefix: 'diagnostics/',
      delimiter: '/',
      cursor,
    });

    for (const prefix of listed.delimitedPrefixes) {
      // Skip rate limit entries
      if (prefix.includes('_rate')) continue;

      const id = prefix.replace('diagnostics/', '').replace('/', '');
      try {
        const metaObj = await env.TELEMETRY_BUCKET.get(`diagnostics/${id}/metadata.json`);
        if (metaObj) {
          const meta: DiagnosticMetadata = await metaObj.json();
          if (!statusFilter || meta.status === statusFilter) {
            reports.push(meta);
          }
        }
      } catch {
        // Skip corrupt entries
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // Sort newest first
  reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return Response.json({
    total: reports.length,
    reports: reports.slice(0, limit),
  });
}

/** GET /admin/diagnostics/summary — counts for weekly report */
async function handleDiagnosticsSummary(env: Env): Promise<Response> {
  const byStatus: Record<string, number> = { new: 0, reviewing: 0, resolved: 0, 'needs-bbl': 0 };
  let total = 0;
  let lastWeek = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let cursor: string | undefined;
  do {
    const listed = await env.TELEMETRY_BUCKET.list({
      prefix: 'diagnostics/',
      delimiter: '/',
      cursor,
    });

    for (const prefix of listed.delimitedPrefixes) {
      if (prefix.includes('_rate')) continue;
      const id = prefix.replace('diagnostics/', '').replace('/', '');
      try {
        const metaObj = await env.TELEMETRY_BUCKET.get(`diagnostics/${id}/metadata.json`);
        if (metaObj) {
          const meta: DiagnosticMetadata = await metaObj.json();
          total++;
          byStatus[meta.status] = (byStatus[meta.status] || 0) + 1;
          if (new Date(meta.createdAt).getTime() > weekAgo) lastWeek++;
        }
      } catch {
        // Skip
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return Response.json({ total, byStatus, lastWeek });
}

/** GET /admin/diagnostics/{reportId} — full bundle + metadata */
async function handleGetDiagnostic(env: Env, reportId: string): Promise<Response> {
  const [metaObj, bundleObj] = await Promise.all([
    env.TELEMETRY_BUCKET.get(`diagnostics/${reportId}/metadata.json`),
    env.TELEMETRY_BUCKET.get(`diagnostics/${reportId}/bundle.json`),
  ]);

  if (!metaObj || !bundleObj) {
    return Response.json({ error: 'Report not found' }, { status: 404 });
  }

  const metadata: DiagnosticMetadata = await metaObj.json();
  const bundle = await bundleObj.json();

  return Response.json({ metadata, bundle });
}

/** PATCH /admin/diagnostics/{reportId} — update status */
async function handleUpdateDiagnostic(
  request: Request,
  env: Env,
  reportId: string
): Promise<Response> {
  const metaObj = await env.TELEMETRY_BUCKET.get(`diagnostics/${reportId}/metadata.json`);
  if (!metaObj) {
    return Response.json({ error: 'Report not found' }, { status: 404 });
  }

  const metadata: DiagnosticMetadata = await metaObj.json();
  const update = (await request.json()) as Partial<DiagnosticMetadata>;

  // Apply updates
  if (update.status) metadata.status = update.status;
  if (update.resolution) metadata.resolution = update.resolution;
  if (update.resolutionMessage) metadata.resolutionMessage = update.resolutionMessage;
  if (update.internalNote !== undefined) metadata.internalNote = update.internalNote;

  // Timestamps
  if (update.status === 'reviewing' && !metadata.reviewedAt) {
    metadata.reviewedAt = new Date().toISOString();
  }
  if (update.status === 'resolved') {
    metadata.resolvedAt = new Date().toISOString();

    // Send resolution email to user if they provided email and there's a message
    if (metadata.userEmail && update.resolutionMessage) {
      await sendResolutionEmail(env, metadata.userEmail, update.resolutionMessage);
    }
  }

  await env.TELEMETRY_BUCKET.put(
    `diagnostics/${reportId}/metadata.json`,
    JSON.stringify(metadata),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return Response.json({ status: 'ok', metadata });
}
