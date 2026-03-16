import type { Env, AnyTelemetryBundle, InstallationMetadata } from './types';
import { isValidUUID, validateBundle, checkPayloadSize, checkRateLimit } from './validation';

/** Handle POST /v1/collect — telemetry upload endpoint */
export async function handleUpload(request: Request, env: Env): Promise<Response> {
  // Only accept POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Decompress if gzipped (CF Workers auto-decompress Content-Encoding: gzip)
  const body = await request.text();

  // Validate payload size
  if (!checkPayloadSize(body)) {
    return new Response('Payload too large', { status: 413 });
  }

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Validate schema
  if (!validateBundle(data)) {
    return new Response('Invalid telemetry bundle schema', { status: 400 });
  }

  const bundle: AnyTelemetryBundle = data;

  // Validate installation ID format
  if (!isValidUUID(bundle.installationId)) {
    return new Response('Invalid installation ID', { status: 400 });
  }

  // Rate limit check
  const allowed = await checkRateLimit(env.TELEMETRY_BUCKET, bundle.installationId);
  if (!allowed) {
    return new Response('Rate limited — max 1 upload per hour', { status: 429 });
  }

  // Write bundle to R2
  const prefix = bundle.installationId;

  await env.TELEMETRY_BUCKET.put(
    `${prefix}/latest.json`,
    JSON.stringify(bundle),
    { httpMetadata: { contentType: 'application/json' } }
  );

  // Update metadata
  let metadata: InstallationMetadata;
  try {
    const existing = await env.TELEMETRY_BUCKET.get(`${prefix}/metadata.json`);
    if (existing) {
      const prev: InstallationMetadata = await existing.json();
      metadata = {
        firstSeen: prev.firstSeen,
        lastSeen: new Date().toISOString(),
        uploadCount: prev.uploadCount + 1,
      };
    } else {
      metadata = {
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        uploadCount: 1,
      };
    }
  } catch {
    metadata = {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      uploadCount: 1,
    };
  }

  await env.TELEMETRY_BUCKET.put(
    `${prefix}/metadata.json`,
    JSON.stringify(metadata),
    { httpMetadata: { contentType: 'application/json' } }
  );

  return Response.json({ status: 'ok' });
}
