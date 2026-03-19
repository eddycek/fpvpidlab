import type {
  Env,
  AnyTelemetryBundle,
  TelemetryBundleV2,
  TelemetryBundleV3,
  TelemetrySessionRecord,
  TelemetryEvent,
  InstallationMetadata,
  AggregatedStats,
  VersionDistribution,
  DroneDistribution,
  QualityHistogram,
  RuleStats,
  MetricDistribution,
  VerificationStats,
  ConvergenceStats,
  ErrorStats,
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
): Promise<{ id: string; metadata: InstallationMetadata; bundle: AnyTelemetryBundle }[]> {
  const installations: { id: string; metadata: InstallationMetadata; bundle: AnyTelemetryBundle }[] =
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
          const bundle: AnyTelemetryBundle = await bundleObj.json();
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

/** Type guard: check if bundle is v2+ (has sessions array) */
function isV2Bundle(bundle: AnyTelemetryBundle): bundle is TelemetryBundleV2 {
  return bundle.schemaVersion >= 2 && 'sessions' in bundle && Array.isArray((bundle as TelemetryBundleV2).sessions);
}

/** Type guard: check if bundle is v3 (has events array) */
function isV3Bundle(bundle: AnyTelemetryBundle): bundle is TelemetryBundleV3 {
  return bundle.schemaVersion >= 3 && 'events' in bundle && Array.isArray((bundle as TelemetryBundleV3).events);
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
    modeDistribution: { filter: 0, pid: 0, flash: 0 },
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
    stats.modeDistribution.flash += bundle.tuningSessions.byMode.flash;

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
  const byMode = { filter: 0, pid: 0, flash: 0 };
  const perInstall: { id: string; total: number; filter: number; pid: number; flash: number; scores: number[] }[] = [];

  for (const { id, bundle } of installations) {
    const s = bundle.tuningSessions;
    totalCompleted += s.totalCompleted;
    byMode.filter += s.byMode.filter;
    byMode.pid += s.byMode.pid;
    byMode.flash += s.byMode.flash;

    if (s.totalCompleted > 0) {
      perInstall.push({
        id: id.substring(0, 8),
        total: s.totalCompleted,
        filter: s.byMode.filter,
        pid: s.byMode.pid,
        flash: s.byMode.flash,
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
  const sessions = { totalCompleted: 0, byMode: { filter: 0, pid: 0, flash: 0 } };
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

    const s = bundle.tuningSessions ?? { totalCompleted: 0, byMode: { filter: 0, pid: 0, flash: 0 }, recentQualityScores: [] };
    sessions.totalCompleted += s.totalCompleted;
    sessions.byMode.filter += s.byMode.filter;
    sessions.byMode.pid += s.byMode.pid;
    sessions.byMode.flash += s.byMode.flash;

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

/** Helper: compute median from sorted array */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Helper: round to 1 decimal place */
function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Helper: average of axis values (roll, pitch, yaw) */
function axisAvg(obj: { roll: number; pitch: number; yaw: number }): number {
  return (obj.roll + obj.pitch + obj.yaw) / 3;
}

/** GET /admin/stats/rules — rule effectiveness across all v2 sessions */
async function handleRules(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const ruleMap = new Map<
    string,
    { fireCount: number; applyCount: number; deltas: number[]; improvements: number[] }
  >();

  for (const { bundle } of installations) {
    if (!isV2Bundle(bundle)) continue;

    for (const session of bundle.sessions) {
      const hasVerification = session.verification != null;

      for (const rule of session.rules ?? []) {
        let entry = ruleMap.get(rule.ruleId);
        if (!entry) {
          entry = { fireCount: 0, applyCount: 0, deltas: [], improvements: [] };
          ruleMap.set(rule.ruleId, entry);
        }
        entry.fireCount++;
        if (rule.applied) {
          entry.applyCount++;
          entry.deltas.push(rule.delta);
        }
        if (hasVerification) {
          entry.improvements.push(session.verification!.overallImprovement);
        }
      }
    }
  }

  const rules: Record<string, RuleStats> = {};
  for (const [ruleId, entry] of ruleMap) {
    const avgDelta =
      entry.deltas.length > 0 ? r1(entry.deltas.reduce((a, b) => a + b, 0) / entry.deltas.length) : 0;
    const avgImprovement =
      entry.improvements.length > 0
        ? r1(entry.improvements.reduce((a, b) => a + b, 0) / entry.improvements.length)
        : 0;

    rules[ruleId] = {
      fireCount: entry.fireCount,
      applyCount: entry.applyCount,
      applyRate: entry.fireCount > 0 ? r1((entry.applyCount / entry.fireCount) * 100) : 0,
      avgDelta,
      avgImprovement,
      sessionsWithVerification: entry.improvements.length,
    };
  }

  // Sort by fireCount descending
  const sorted = Object.entries(rules).sort(([, a], [, b]) => b.fireCount - a.fireCount);

  return Response.json({ rules: Object.fromEntries(sorted), totalRules: sorted.length });
}

/** GET /admin/stats/metrics — metric distributions from v2 sessions */
async function handleMetrics(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const noiseFloors: number[] = [];
  const overshoots: number[] = [];
  const bandwidths: number[] = [];
  const phaseMargins: number[] = [];

  for (const { bundle } of installations) {
    if (!isV2Bundle(bundle)) continue;

    for (const session of bundle.sessions) {
      const m = session.metrics;
      if (m.noiseFloorDb) noiseFloors.push(axisAvg(m.noiseFloorDb));
      if (m.meanOvershootPct) overshoots.push(axisAvg(m.meanOvershootPct));
      if (m.bandwidthHz) bandwidths.push(axisAvg(m.bandwidthHz));
      if (m.phaseMarginDeg) phaseMargins.push(axisAvg(m.phaseMarginDeg));
    }
  }

  function buildDistribution(
    values: number[],
    bucketStart: number,
    bucketEnd: number,
    bucketSize: number,
    unit: string
  ): MetricDistribution {
    const buckets: Record<string, number> = {};
    for (let lo = bucketStart; lo < bucketEnd; lo += bucketSize) {
      buckets[`${lo}${unit} to ${lo + bucketSize}${unit}`] = 0;
    }
    for (const v of values) {
      const idx = Math.floor((v - bucketStart) / bucketSize) * bucketSize + bucketStart;
      const clamped = Math.max(bucketStart, Math.min(idx, bucketEnd - bucketSize));
      const key = `${clamped}${unit} to ${clamped + bucketSize}${unit}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return {
      buckets,
      mean: values.length > 0 ? r1(values.reduce((a, b) => a + b, 0) / values.length) : 0,
      median: r1(median(values)),
      count: values.length,
    };
  }

  return Response.json({
    noiseFloor: buildDistribution(noiseFloors, -60, -10, 5, 'dB'),
    overshoot: buildDistribution(overshoots, 0, 50, 5, '%'),
    bandwidth: buildDistribution(bandwidths, 0, 100, 10, 'Hz'),
    phaseMargin: buildDistribution(phaseMargins, 0, 90, 10, 'deg'),
  });
}

/** GET /admin/stats/verification — verification success rates from v2 sessions */
async function handleVerification(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  let totalVerified = 0;
  let improved = 0;
  const byMode: Record<string, { count: number; improved: number; totalImprovement: number }> = {};

  for (const { bundle } of installations) {
    if (!isV2Bundle(bundle)) continue;

    for (const session of bundle.sessions) {
      if (!session.verification) continue;

      totalVerified++;
      const isImproved = session.verification.overallImprovement > 0;
      if (isImproved) improved++;

      if (!byMode[session.mode]) {
        byMode[session.mode] = { count: 0, improved: 0, totalImprovement: 0 };
      }
      byMode[session.mode].count++;
      if (isImproved) byMode[session.mode].improved++;
      byMode[session.mode].totalImprovement += session.verification.overallImprovement;
    }
  }

  const result: VerificationStats = {
    totalVerified,
    improved,
    improvementRate: totalVerified > 0 ? r1((improved / totalVerified) * 100) : 0,
    byMode: {},
  };

  for (const [mode, data] of Object.entries(byMode)) {
    result.byMode[mode] = {
      count: data.count,
      improved: data.improved,
      avgImprovement: data.count > 0 ? r1(data.totalImprovement / data.count) : 0,
    };
  }

  return Response.json(result);
}

/** GET /admin/stats/convergence — quality score trends across sessions per installation */
async function handleConvergence(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const firstScores: number[] = [];
  const secondScores: number[] = [];
  const thirdPlusScores: number[] = [];
  let multiSessionCount = 0;
  let convergedCount = 0;

  for (const { bundle } of installations) {
    if (!isV2Bundle(bundle)) continue;

    const scores = bundle.sessions
      .filter((s: TelemetrySessionRecord) => s.qualityScore != null)
      .map((s: TelemetrySessionRecord) => s.qualityScore!);

    if (scores.length < 2) continue;
    multiSessionCount++;

    firstScores.push(scores[0]);
    secondScores.push(scores[1]);
    for (let i = 2; i < scores.length; i++) {
      thirdPlusScores.push(scores[i]);
    }

    // Converged = last score > first score
    if (scores[scores.length - 1] > scores[0]) {
      convergedCount++;
    }
  }

  const result: ConvergenceStats = {
    installationsWithMultipleSessions: multiSessionCount,
    avgFirstSessionScore: firstScores.length > 0 ? r1(firstScores.reduce((a, b) => a + b, 0) / firstScores.length) : 0,
    avgSecondSessionScore: secondScores.length > 0 ? r1(secondScores.reduce((a, b) => a + b, 0) / secondScores.length) : 0,
    avgThirdPlusScore: thirdPlusScores.length > 0 ? r1(thirdPlusScores.reduce((a, b) => a + b, 0) / thirdPlusScores.length) : 0,
    convergenceRate: multiSessionCount > 0 ? r1((convergedCount / multiSessionCount) * 100) : 0,
  };

  return Response.json(result);
}

/** GET /admin/stats/errors — aggregated error metrics from v3 events */
async function handleErrors(env: Env): Promise<Response> {
  const installations = await listInstallations(env.TELEMETRY_BUCKET);

  const byType: Record<string, number> = {};
  const errorMap = new Map<string, { count: number; installations: Set<string> }>();
  const funnelMap = new Map<
    string,
    { started: number; completed: number; abandonedAt: Record<string, number> }
  >();
  let totalEvents = 0;

  for (const { id, bundle } of installations) {
    if (!isV3Bundle(bundle)) continue;

    for (const event of bundle.events) {
      totalEvents++;
      byType[event.type] = (byType[event.type] || 0) + 1;

      // Error breakdown
      if (event.type === 'error') {
        let entry = errorMap.get(event.name);
        if (!entry) {
          entry = { count: 0, installations: new Set() };
          errorMap.set(event.name, entry);
        }
        entry.count++;
        entry.installations.add(id);
      }

      // Funnel tracking
      if (event.type === 'workflow') {
        const mode = String(event.meta?.mode ?? 'unknown');
        if (!funnelMap.has(mode)) {
          funnelMap.set(mode, { started: 0, completed: 0, abandonedAt: {} });
        }
        const funnel = funnelMap.get(mode)!;
        if (event.name === 'tuning_started') funnel.started++;
        if (event.name === 'tuning_completed') funnel.completed++;
        if (event.name === 'tuning_abandoned') {
          const phase = String(event.meta?.atPhase ?? 'unknown');
          funnel.abandonedAt[phase] = (funnel.abandonedAt[phase] || 0) + 1;
        }
      }
    }
  }

  const errorBreakdown: Record<string, { count: number; uniqueInstallations: number }> = {};
  for (const [name, entry] of errorMap) {
    errorBreakdown[name] = { count: entry.count, uniqueInstallations: entry.installations.size };
  }

  const funnelDropoff: ErrorStats['funnelDropoff'] = {};
  for (const [mode, data] of funnelMap) {
    funnelDropoff[mode] = data;
  }

  return Response.json({
    totalEvents,
    byType,
    errorBreakdown,
    funnelDropoff,
  } satisfies ErrorStats);
}

/** GET /admin/events?id=<installationId> — events for a specific installation */
async function handleEvents(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const installationId = url.searchParams.get('id');
  if (!installationId) {
    return Response.json({ error: 'Missing required parameter: id' }, { status: 400 });
  }

  const bundleObj = await env.TELEMETRY_BUCKET.get(`${installationId}/latest.json`);
  if (!bundleObj) {
    return Response.json({ error: 'Installation not found' }, { status: 404 });
  }

  const bundle: AnyTelemetryBundle = await bundleObj.json();
  if (!isV3Bundle(bundle)) {
    return Response.json({
      installationId,
      totalEvents: 0,
      events: [],
      sessions: [],
      note: 'Installation has not uploaded v3 bundle yet',
    });
  }

  let events: TelemetryEvent[] = bundle.events;

  // Optional filters
  const sessionFilter = url.searchParams.get('session');
  const typeFilter = url.searchParams.get('type');

  if (sessionFilter) {
    events = events.filter((e) => e.sessionId === sessionFilter);
  }
  if (typeFilter) {
    events = events.filter((e) => e.type === typeFilter);
  }

  // Build sessions summary for correlation
  const sessionSummaries = bundle.sessions
    .filter((s: TelemetrySessionRecord) => s.sessionId)
    .map((s: TelemetrySessionRecord) => ({
      sessionId: s.sessionId,
      mode: s.mode,
      qualityScore: s.qualityScore,
    }));

  return Response.json({
    installationId,
    totalEvents: events.length,
    events,
    sessions: sessionSummaries,
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
    case '/admin/stats/rules':
      return handleRules(env);
    case '/admin/stats/metrics':
      return handleMetrics(env);
    case '/admin/stats/verification':
      return handleVerification(env);
    case '/admin/stats/convergence':
      return handleConvergence(env);
    case '/admin/stats/errors':
      return handleErrors(env);
    case '/admin/events':
      return handleEvents(request, env);
    default:
      return new Response('Not found', { status: 404 });
  }
}
