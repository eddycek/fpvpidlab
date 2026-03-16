import type { AnyTelemetryBundle, InstallationMetadata, Env } from './types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10 MB decompressed
const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

/** Validate UUID v4 format */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/** Validate telemetry bundle schema — required fields present and correct types.
 *  Accepts both v1 (schemaVersion 1) and v2 (schemaVersion 2) bundles. */
export function validateBundle(data: unknown): data is AnyTelemetryBundle {
  if (!data || typeof data !== 'object') return false;
  const bundle = data as Record<string, unknown>;

  if (typeof bundle.schemaVersion !== 'number') return false;
  if (bundle.schemaVersion !== 1 && bundle.schemaVersion !== 2) return false;
  if (typeof bundle.installationId !== 'string' || !isValidUUID(bundle.installationId)) return false;
  if (typeof bundle.timestamp !== 'string') return false;
  if (typeof bundle.appVersion !== 'string') return false;
  if (typeof bundle.platform !== 'string') return false;

  // Profiles
  if (!bundle.profiles || typeof bundle.profiles !== 'object') return false;
  const profiles = bundle.profiles as Record<string, unknown>;
  if (typeof profiles.count !== 'number') return false;

  // Tuning sessions
  if (!bundle.tuningSessions || typeof bundle.tuningSessions !== 'object') return false;
  const sessions = bundle.tuningSessions as Record<string, unknown>;
  if (typeof sessions.totalCompleted !== 'number') return false;

  // V2: sessions array must be present
  if (bundle.schemaVersion === 2) {
    if (!Array.isArray(bundle.sessions)) return false;
  }

  return true;
}

/** Check payload size limit */
export function checkPayloadSize(body: string): boolean {
  return body.length <= MAX_PAYLOAD_SIZE;
}

/** Check rate limit — returns true if upload is allowed */
export async function checkRateLimit(
  bucket: R2Bucket,
  installationId: string
): Promise<boolean> {
  try {
    const metaObj = await bucket.get(`${installationId}/metadata.json`);
    if (!metaObj) return true; // First upload, no rate limit

    const metadata: InstallationMetadata = await metaObj.json();
    const lastSeen = new Date(metadata.lastSeen).getTime();
    const now = Date.now();

    return now - lastSeen >= RATE_LIMIT_MS;
  } catch {
    return true; // Error reading metadata, allow upload
  }
}
