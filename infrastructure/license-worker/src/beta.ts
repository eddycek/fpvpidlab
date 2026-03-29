import type { Env, BetaWhitelistRow, LicenseRow } from './types';
import { generateLicenseKey } from './keygen';
import { sendEmail, confirmationEmail, approvalEmail, rejectionEmail } from './email';
import { signupPage, thankYouPage, adminBetaPage } from './betaPages';
import { isValidEmail } from './validation';

const MAX_SIGNUPS_PER_IP_PER_HOUR = 3;

/** GET /beta — public signup form */
export function handleBetaSignup(): Response {
  return htmlResponse(signupPage());
}

/** GET /beta/thankyou — confirmation page */
export function handleBetaThankYou(): Response {
  return htmlResponse(thankYouPage());
}

/** GET /admin/beta — admin dashboard HTML */
export function handleAdminBetaPage(): Response {
  return htmlResponse(adminBetaPage());
}

/** POST /beta/signup — process signup form */
export async function handleBetaSignupSubmit(
  request: Request,
  env: Env
): Promise<Response> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return htmlResponse(signupPage('Invalid form submission.'));
  }

  const rawName = formData.get('name');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const rawEmail = formData.get('email');
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const rawQuadCount = formData.get('quad_count');
  const quadCount = typeof rawQuadCount === 'string' ? parseInt(rawQuadCount, 10) : NaN;
  const rawPlatforms = formData.getAll('platform');
  const platforms = rawPlatforms.filter((p): p is string => typeof p === 'string');
  const rawComment = formData.get('comment');
  const comment = typeof rawComment === 'string' ? rawComment.trim() : '';

  // Validate required fields
  if (!name || name.length > 100) {
    return htmlResponse(signupPage('Please provide a valid name (max 100 characters).'));
  }
  if (!email || !isValidEmail(email)) {
    return htmlResponse(signupPage('Please provide a valid email address.'));
  }
  if (isNaN(quadCount) || quadCount < 1 || quadCount > 100) {
    return htmlResponse(signupPage('Invalid quad count.'));
  }
  const validPlatforms = platforms.filter((p) =>
    ['windows', 'macos', 'linux'].includes(p)
  );
  if (validPlatforms.length === 0) {
    return htmlResponse(signupPage('Please select at least one platform.'));
  }
  if (!comment || comment.length > 1000) {
    return htmlResponse(signupPage('Please provide a comment (max 1000 characters).'));
  }

  const platformStr = validPlatforms.join(',');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limit: max 3 signups per IP per hour (use SQLite time math for consistent format)
  const rateCheck = await env.LICENSE_DB.prepare(
    "SELECT COUNT(*) as count FROM beta_whitelist WHERE ip_address = ? AND created_at >= datetime('now','-1 hour')"
  )
    .bind(ip)
    .first<{ count: number }>();

  if (rateCheck && rateCheck.count >= MAX_SIGNUPS_PER_IP_PER_HOUR) {
    return htmlResponse(signupPage('Too many signup attempts. Please try again later.'));
  }

  // Check for duplicate email
  const existing = await env.LICENSE_DB.prepare(
    'SELECT id, status FROM beta_whitelist WHERE email = ?'
  )
    .bind(email)
    .first<{ id: string; status: string }>();

  if (existing) {
    if (existing.status === 'rejected') {
      // Allow re-application: delete rejected entry
      await env.LICENSE_DB.prepare('DELETE FROM beta_whitelist WHERE id = ?')
        .bind(existing.id)
        .run();
    } else {
      // Pending or approved — same response to prevent email enumeration
      return redirect('/beta/thankyou');
    }
  }

  // Insert new entry (catch UNIQUE constraint for concurrent duplicate signups)
  try {
    await env.LICENSE_DB.prepare(
      `INSERT INTO beta_whitelist (name, email, quad_count, platform, comment, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(name, email, quadCount, platformStr, comment, ip)
      .run();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('UNIQUE constraint failed')) {
      // Concurrent duplicate — same response to prevent email enumeration
      return redirect('/beta/thankyou');
    }
    throw err;
  }

  // Send confirmation email (fire-and-forget)
  const { subject, html } = confirmationEmail(name);
  await sendEmail(env, { to: email, subject, html });

  return redirect('/beta/thankyou');
}

/** GET /admin/beta/list — JSON list of applications */
export async function handleAdminBetaList(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  let query = 'SELECT * FROM beta_whitelist WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const result = await env.LICENSE_DB.prepare(query)
    .bind(...params)
    .all<BetaWhitelistRow>();

  // Enrich approved entries with license data
  const entries = await Promise.all(
    result.results.map(async (row) => {
      const entry = formatBetaEntry(row);
      if (row.license_id) {
        const license = await env.LICENSE_DB.prepare(
          'SELECT license_key, activated_at, last_validated_at FROM licenses WHERE id = ?'
        )
          .bind(row.license_id)
          .first<Pick<LicenseRow, 'license_key' | 'activated_at' | 'last_validated_at'>>();
        if (license) {
          entry.licenseKey = license.license_key;
          entry.activatedAt = license.activated_at ? toISOString(license.activated_at) : null;
          entry.lastUsedAt = license.last_validated_at ? toISOString(license.last_validated_at) : null;
        }
      }
      return entry;
    })
  );

  // Stats
  const [pending, approved, rejected, total] = await Promise.all([
    env.LICENSE_DB.prepare("SELECT COUNT(*) as count FROM beta_whitelist WHERE status = 'pending'").first<{ count: number }>(),
    env.LICENSE_DB.prepare("SELECT COUNT(*) as count FROM beta_whitelist WHERE status = 'approved'").first<{ count: number }>(),
    env.LICENSE_DB.prepare("SELECT COUNT(*) as count FROM beta_whitelist WHERE status = 'rejected'").first<{ count: number }>(),
    env.LICENSE_DB.prepare('SELECT COUNT(*) as count FROM beta_whitelist').first<{ count: number }>(),
  ]);

  return Response.json({
    entries,
    stats: {
      pending: pending?.count ?? 0,
      approved: approved?.count ?? 0,
      rejected: rejected?.count ?? 0,
      total: total?.count ?? 0,
    },
  });
}

/** PUT /admin/beta/:id/approve — approve and generate license key */
export async function handleAdminBetaApprove(
  env: Env,
  entryId: string
): Promise<Response> {
  const entry = await env.LICENSE_DB.prepare(
    'SELECT * FROM beta_whitelist WHERE id = ?'
  )
    .bind(entryId)
    .first<BetaWhitelistRow>();

  if (!entry) {
    return Response.json({ error: 'Application not found' }, { status: 404 });
  }
  if (entry.status === 'approved') {
    return Response.json({ error: 'Already approved' }, { status: 400 });
  }

  // Generate license key
  const licenseKey = generateLicenseKey();

  // Insert license with whitelist_id
  const license = await env.LICENSE_DB.prepare(
    `INSERT INTO licenses (license_key, email, type, note, whitelist_id)
     VALUES (?, ?, 'tester', ?, ?)
     RETURNING id, license_key`
  )
    .bind(licenseKey, entry.email, `Beta tester: ${entry.name}`, entryId)
    .first<{ id: string; license_key: string }>();

  if (!license) {
    return Response.json({ error: 'Failed to create license' }, { status: 500 });
  }

  // Update whitelist entry (with compensating cleanup on failure)
  try {
    await env.LICENSE_DB.prepare(
      `UPDATE beta_whitelist SET status = 'approved', license_id = ?, reviewed_at = datetime('now')
       WHERE id = ?`
    )
      .bind(license.id, entryId)
      .run();
  } catch (err) {
    // Cleanup orphaned license
    try {
      await env.LICENSE_DB.prepare('DELETE FROM licenses WHERE id = ?')
        .bind(license.id)
        .run();
    } catch {
      // Ignore cleanup failure
    }
    return Response.json({ error: 'Failed to approve beta application' }, { status: 500 });
  }

  // Send approval email
  const { subject, html } = approvalEmail(entry.name, licenseKey);
  const emailSent = await sendEmail(env, { to: entry.email, subject, html });

  return Response.json({
    id: entryId,
    status: 'approved',
    licenseKey: licenseKey,
    licenseId: license.id,
    emailSent,
  });
}

/** PUT /admin/beta/:id/reject — reject application */
export async function handleAdminBetaReject(
  env: Env,
  entryId: string
): Promise<Response> {
  const entry = await env.LICENSE_DB.prepare(
    'SELECT * FROM beta_whitelist WHERE id = ?'
  )
    .bind(entryId)
    .first<BetaWhitelistRow>();

  if (!entry) {
    return Response.json({ error: 'Application not found' }, { status: 404 });
  }
  if (entry.status !== 'pending') {
    return Response.json({ error: 'Can only reject pending applications' }, { status: 400 });
  }

  await env.LICENSE_DB.prepare(
    `UPDATE beta_whitelist SET status = 'rejected', reviewed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(entryId)
    .run();

  // Send rejection email
  const { subject, html } = rejectionEmail(entry.name);
  const emailSent = await sendEmail(env, { to: entry.email, subject, html });

  return Response.json({ id: entryId, status: 'rejected', emailSent });
}

interface BetaEntryResponse {
  id: string;
  name: string;
  email: string;
  quadCount: number;
  platform: string;
  comment: string;
  status: string;
  licenseId: string | null;
  licenseKey: string | null;
  activatedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

function formatBetaEntry(row: BetaWhitelistRow): BetaEntryResponse {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    quadCount: row.quad_count,
    platform: row.platform,
    comment: row.comment,
    status: row.status,
    licenseId: row.license_id,
    licenseKey: null,
    activatedAt: null,
    lastUsedAt: null,
    createdAt: toISOString(row.created_at),
    reviewedAt: row.reviewed_at ? toISOString(row.reviewed_at) : null,
  };
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** Convert SQLite datetime ('YYYY-MM-DD HH:MM:SS') to ISO-8601 for reliable JS Date parsing */
function toISOString(sqliteDate: string): string {
  return sqliteDate.includes('T') ? sqliteDate : sqliteDate.replace(' ', 'T') + 'Z';
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}
