import type {
  Env,
  TelemetryBundle,
  InstallationMetadata,
  AggregatedStats,
  VersionDistribution,
  DroneDistribution,
  QualityHistogram,
} from './types';

/** Authenticate admin requests via X-Admin-Key header */
function authenticateAdmin(request: Request, env: Env): boolean {
  const key = request.headers.get('X-Admin-Key');
  if (!key || !env.ADMIN_KEY) return false;
  // Constant-time comparison
  if (key.length !== env.ADMIN_KEY.length) return false;
  let result = 0;
  for (let i = 0; i < key.length; i++) {
    result |= key.charCodeAt(i) ^ env.ADMIN_KEY.charCodeAt(i);
  }
  return result === 0;
}

/** List all installation IDs by scanning R2 prefixes */
async function listInstallations(
  bucket: R2Bucket
): Promise<{ id: string; metadata: InstallationMetadata; bundle: TelemetryBundle }[]> {
  const installations: { id: string; metadata: InstallationMetadata; bundle: TelemetryBundle }[] =
    [];

  let cursor: string | undefined;
  const seen = new Set<string>();

  do {
    const listed = await bucket.list({
      delimiter: '/',
      cursor,
    });

    for (const prefix of listed.delimitedPrefixes) {
      const id = prefix.replace('/', '');
      if (seen.has(id)) continue;
      seen.add(id);

      try {
        const [metaObj, bundleObj] = await Promise.all([
          bucket.get(`${id}/metadata.json`),
          bucket.get(`${id}/latest.json`),
        ]);

        if (metaObj && bundleObj) {
          const metadata: InstallationMetadata = await metaObj.json();
          const bundle: TelemetryBundle = await bundleObj.json();
          installations.push({ id, metadata, bundle });
        }
      } catch {
        // Skip corrupt entries
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return installations;
}

/** GET /admin/stats — aggregate summary */
async function handleStats(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const d7 = 7 * h24;
  const d30 = 30 * h24;

  const stats: AggregatedStats = {
    totalInstallations: installations.length,
    active24h: 0,
    active7d: 0,
    active30d: 0,
    modeDistribution: { filter: 0, pid: 0, quick: 0 },
    platformDistribution: {},
  };

  for (const { metadata, bundle } of installations) {
    const lastSeen = new Date(metadata.lastSeen).getTime();
    const age = now - lastSeen;

    if (age <= h24) stats.active24h++;
    if (age <= d7) stats.active7d++;
    if (age <= d30) stats.active30d++;

    stats.modeDistribution.filter += bundle.tuningSessions.byMode.filter;
    stats.modeDistribution.pid += bundle.tuningSessions.byMode.pid;
    stats.modeDistribution.quick += bundle.tuningSessions.byMode.quick;

    stats.platformDistribution[bundle.platform] =
      (stats.platformDistribution[bundle.platform] || 0) + 1;
  }

  return Response.json(stats);
}

/** GET /admin/stats/versions — BF version distribution */
async function handleVersions(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const versions: Record<string, number> = {};

  for (const { bundle } of installations) {
    for (const v of bundle.fcInfo.bfVersions) {
      versions[v] = (versions[v] || 0) + 1;
    }
  }

  const result: VersionDistribution = { versions };
  return Response.json(result);
}

/** GET /admin/stats/drones — drone size & flight style distribution */
async function handleDrones(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const sizes: Record<string, number> = {};
  const flightStyles: Record<string, number> = {};

  for (const { bundle } of installations) {
    for (const s of bundle.profiles.sizes) {
      sizes[s] = (sizes[s] || 0) + 1;
    }
    for (const fs of bundle.profiles.flightStyles) {
      flightStyles[fs] = (flightStyles[fs] || 0) + 1;
    }
  }

  const result: DroneDistribution = { sizes, flightStyles };
  return Response.json(result);
}

/** GET /admin/stats/quality — quality score histogram */
async function handleQuality(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const buckets: Record<string, number> = {
    '0-20': 0,
    '20-40': 0,
    '40-60': 0,
    '60-80': 0,
    '80-100': 0,
  };

  let totalScore = 0;
  let totalCount = 0;

  for (const { bundle } of installations) {
    for (const score of bundle.tuningSessions.recentQualityScores) {
      totalScore += score;
      totalCount++;

      if (score < 20) buckets['0-20']++;
      else if (score < 40) buckets['20-40']++;
      else if (score < 60) buckets['40-60']++;
      else if (score < 80) buckets['60-80']++;
      else buckets['80-100']++;
    }
  }

  const result: QualityHistogram = {
    buckets,
    averageScore: totalCount > 0 ? Math.round((totalScore / totalCount) * 10) / 10 : null,
    totalScores: totalCount,
  };
  return Response.json(result);
}

/** GET /admin/stats/app-versions — PIDlab app version distribution */
async function handleAppVersions(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const versions: Record<string, number> = {};

  for (const { bundle } of installations) {
    const v = bundle.appVersion || 'unknown';
    versions[v] = (versions[v] || 0) + 1;
  }

  // Sort by version descending (newest first)
  const sorted = Object.entries(versions).sort(([a], [b]) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return 0;
  });

  return Response.json({
    versions: Object.fromEntries(sorted),
    total: installations.length,
    latest: sorted.length > 0 ? sorted[0][0] : null,
  });
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

  switch (pathname) {
    case '/admin/stats':
      return handleStats(env);
    case '/admin/stats/versions':
      return handleVersions(env);
    case '/admin/stats/drones':
      return handleDrones(env);
    case '/admin/stats/quality':
      return handleQuality(env);
    case '/admin/stats/app-versions':
      return handleAppVersions(env);
    default:
      return new Response('Not found', { status: 404 });
  }
}
