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
    for (const v of bundle.fcInfo?.bfVersions ?? []) {
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
    for (const s of bundle.profiles?.sizes ?? []) {
      sizes[s] = (sizes[s] || 0) + 1;
    }
    for (const fs of bundle.profiles?.flightStyles ?? []) {
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

/** GET /admin/stats/sessions — tuning session breakdown */
async function handleSessions(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  let totalCompleted = 0;
  const byMode = { filter: 0, pid: 0, quick: 0 };
  const perInstall: { id: string; total: number; filter: number; pid: number; quick: number; scores: number[] }[] = [];

  for (const { id, bundle } of installations) {
    const s = bundle.tuningSessions;
    totalCompleted += s.totalCompleted;
    byMode.filter += s.byMode.filter;
    byMode.pid += s.byMode.pid;
    byMode.quick += s.byMode.quick;

    if (s.totalCompleted > 0) {
      perInstall.push({
        id: id.substring(0, 8),
        total: s.totalCompleted,
        filter: s.byMode.filter,
        pid: s.byMode.pid,
        quick: s.byMode.quick,
        scores: s.recentQualityScores,
      });
    }
  }

  // Sort by total sessions descending
  perInstall.sort((a, b) => b.total - a.total);

  return Response.json({
    totalCompleted,
    byMode,
    installationsWithSessions: perInstall.length,
    topInstallations: perInstall.slice(0, 20),
  });
}

/** GET /admin/stats/features — feature adoption rates */
async function handleFeatures(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const features = {
    analysisOverview: 0,
    snapshotRestore: 0,
    snapshotCompare: 0,
    historyView: 0,
  };

  for (const { bundle } of installations) {
    if (bundle.features.analysisOverviewUsed) features.analysisOverview++;
    if (bundle.features.snapshotRestoreUsed) features.snapshotRestore++;
    if (bundle.features.snapshotCompareUsed) features.snapshotCompare++;
    if (bundle.features.historyViewUsed) features.historyView++;
  }

  const total = installations.length;
  return Response.json({
    totalInstallations: total,
    adoption: {
      analysisOverview: { count: features.analysisOverview, percent: total ? Math.round((features.analysisOverview / total) * 100) : 0 },
      snapshotRestore: { count: features.snapshotRestore, percent: total ? Math.round((features.snapshotRestore / total) * 100) : 0 },
      snapshotCompare: { count: features.snapshotCompare, percent: total ? Math.round((features.snapshotCompare / total) * 100) : 0 },
      historyView: { count: features.historyView, percent: total ? Math.round((features.historyView / total) * 100) : 0 },
    },
  });
}

/** GET /admin/stats/blackbox — blackbox usage stats */
async function handleBlackbox(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  let totalLogs = 0;
  let compressionCount = 0;
  const storageTypes: Record<string, number> = {};

  for (const { bundle } of installations) {
    const bb = bundle.blackbox ?? { totalLogsDownloaded: 0, storageTypes: [], compressionDetected: false };
    totalLogs += bb.totalLogsDownloaded;
    if (bb.compressionDetected) compressionCount++;
    for (const st of bb.storageTypes ?? []) {
      storageTypes[st] = (storageTypes[st] || 0) + 1;
    }
  }

  return Response.json({
    totalLogsDownloaded: totalLogs,
    installationsWithCompression: compressionCount,
    storageTypes,
  });
}

/** GET /admin/stats/profiles — profile count distribution */
async function handleProfiles(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const distribution: Record<number, number> = {};
  let totalProfiles = 0;

  for (const { bundle } of installations) {
    const count = bundle.profiles?.count ?? 0;
    totalProfiles += count;
    distribution[count] = (distribution[count] || 0) + 1;
  }

  return Response.json({
    totalProfiles,
    averagePerInstall: installations.length ? Math.round((totalProfiles / installations.length) * 10) / 10 : 0,
    distribution,
  });
}

/** GET /admin/stats/full — everything in one call, field names match sub-endpoints */
async function handleFull(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const d7 = 7 * h24;
  const d30 = 30 * h24;

  const stats = {
    totalInstallations: installations.length,
    active24h: 0,
    active7d: 0,
    active30d: 0,
    platformDistribution: {} as Record<string, number>,
    environmentDistribution: {} as Record<string, number>,
  };

  const appVersions: Record<string, number> = {};
  const bfVersions: Record<string, number> = {};
  const boardTargets: Record<string, number> = {};
  const sessions = { totalCompleted: 0, byMode: { filter: 0, pid: 0, quick: 0 } };
  const profiles = { totalProfiles: 0, sizes: {} as Record<string, number>, flightStyles: {} as Record<string, number>, distribution: {} as Record<number, number> };
  const features = { analysisOverview: 0, snapshotRestore: 0, snapshotCompare: 0, historyView: 0 };
  const blackbox = { totalLogsDownloaded: 0, installationsWithCompression: 0, storageTypes: {} as Record<string, number> };
  const qualityBuckets: Record<string, number> = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
  let qualitySum = 0;
  let qualityCount = 0;

  for (const { metadata, bundle } of installations) {
    const age = now - new Date(metadata.lastSeen).getTime();
    if (age <= h24) stats.active24h++;
    if (age <= d7) stats.active7d++;
    if (age <= d30) stats.active30d++;

    stats.platformDistribution[bundle.platform] = (stats.platformDistribution[bundle.platform] || 0) + 1;
    const envName = bundle.environment || 'unknown';
    stats.environmentDistribution[envName] = (stats.environmentDistribution[envName] || 0) + 1;

    appVersions[bundle.appVersion || 'unknown'] = (appVersions[bundle.appVersion || 'unknown'] || 0) + 1;

    for (const v of bundle.fcInfo?.bfVersions ?? []) bfVersions[v] = (bfVersions[v] || 0) + 1;
    for (const t of bundle.fcInfo?.boardTargets ?? []) boardTargets[t] = (boardTargets[t] || 0) + 1;

    const s = bundle.tuningSessions ?? { totalCompleted: 0, byMode: { filter: 0, pid: 0, quick: 0 }, recentQualityScores: [] };
    sessions.totalCompleted += s.totalCompleted;
    sessions.byMode.filter += s.byMode.filter;
    sessions.byMode.pid += s.byMode.pid;
    sessions.byMode.quick += s.byMode.quick;

    const pc = bundle.profiles?.count ?? 0;
    profiles.totalProfiles += pc;
    profiles.distribution[pc] = (profiles.distribution[pc] || 0) + 1;
    for (const sz of bundle.profiles?.sizes ?? []) profiles.sizes[sz] = (profiles.sizes[sz] || 0) + 1;
    for (const fs of bundle.profiles?.flightStyles ?? []) profiles.flightStyles[fs] = (profiles.flightStyles[fs] || 0) + 1;

    if (bundle.features?.analysisOverviewUsed) features.analysisOverview++;
    if (bundle.features?.snapshotRestoreUsed) features.snapshotRestore++;
    if (bundle.features?.snapshotCompareUsed) features.snapshotCompare++;
    if (bundle.features?.historyViewUsed) features.historyView++;

    const bb = bundle.blackbox ?? { totalLogsDownloaded: 0, storageTypes: [], compressionDetected: false };
    blackbox.totalLogsDownloaded += bb.totalLogsDownloaded;
    if (bb.compressionDetected) blackbox.installationsWithCompression++;
    for (const st of bb.storageTypes ?? []) blackbox.storageTypes[st] = (blackbox.storageTypes[st] || 0) + 1;

    for (const score of s.recentQualityScores ?? []) {
      qualitySum += score;
      qualityCount++;
      if (score < 20) qualityBuckets['0-20']++;
      else if (score < 40) qualityBuckets['20-40']++;
      else if (score < 60) qualityBuckets['40-60']++;
      else if (score < 80) qualityBuckets['60-80']++;
      else qualityBuckets['80-100']++;
    }
  }

  return Response.json({
    stats,
    appVersions,
    bfVersions,
    boardTargets,
    sessions,
    profiles: {
      ...profiles,
      averagePerInstall: installations.length ? Math.round((profiles.totalProfiles / installations.length) * 10) / 10 : 0,
    },
    features: {
      totalInstallations: installations.length,
      adoption: {
        analysisOverview: features.analysisOverview,
        snapshotRestore: features.snapshotRestore,
        snapshotCompare: features.snapshotCompare,
        historyView: features.historyView,
      },
    },
    blackbox,
    quality: {
      buckets: qualityBuckets,
      averageScore: qualityCount > 0 ? Math.round((qualitySum / qualityCount) * 10) / 10 : null,
      totalScores: qualityCount,
    },
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
    case '/admin/stats/sessions':
      return handleSessions(env);
    case '/admin/stats/features':
      return handleFeatures(env);
    case '/admin/stats/blackbox':
      return handleBlackbox(env);
    case '/admin/stats/profiles':
      return handleProfiles(env);
    case '/admin/stats/full':
      return handleFull(env);
    default:
      return new Response('Not found', { status: 404 });
  }
}
