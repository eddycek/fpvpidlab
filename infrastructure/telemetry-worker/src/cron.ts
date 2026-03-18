import type { Env, TelemetryBundle, InstallationMetadata } from './types';

/** Cron trigger handler — daily report via Resend email */
export async function handleCron(env: Env): Promise<void> {
  const now = Date.now();
  const h24 = 24 * 60 * 60 * 1000;
  const d7 = 7 * h24;

  // Scan all installations
  let totalInstallations = 0;
  let active24h = 0;
  let active7d = 0;
  let newInstallations24h = 0;
  const modeDistribution = { filter: 0, pid: 0, flash: 0 };
  const bfVersions: Record<string, number> = {};
  const droneSizes: Record<string, number> = {};
  const platforms: Record<string, number> = {};
  let totalQualityScore = 0;
  let qualityScoreCount = 0;

  let cursor: string | undefined;
  const seen = new Set<string>();

  do {
    const listed = await env.TELEMETRY_BUCKET.list({ delimiter: '/', cursor });

    for (const prefix of listed.delimitedPrefixes) {
      const id = prefix.replace('/', '');
      if (seen.has(id)) continue;
      seen.add(id);

      try {
        const [metaObj, bundleObj] = await Promise.all([
          env.TELEMETRY_BUCKET.get(`${id}/metadata.json`),
          env.TELEMETRY_BUCKET.get(`${id}/latest.json`),
        ]);

        if (!metaObj || !bundleObj) continue;

        const metadata: InstallationMetadata = await metaObj.json();
        const bundle: TelemetryBundle = await bundleObj.json();

        totalInstallations++;
        const lastSeen = new Date(metadata.lastSeen).getTime();
        const firstSeen = new Date(metadata.firstSeen).getTime();
        const age = now - lastSeen;

        if (age <= h24) active24h++;
        if (age <= d7) active7d++;
        if (now - firstSeen <= h24) newInstallations24h++;

        modeDistribution.filter += bundle.tuningSessions.byMode.filter;
        modeDistribution.pid += bundle.tuningSessions.byMode.pid;
        modeDistribution.flash += bundle.tuningSessions.byMode.flash;

        for (const v of bundle.fcInfo.bfVersions) {
          bfVersions[v] = (bfVersions[v] || 0) + 1;
        }
        for (const s of bundle.profiles.sizes) {
          droneSizes[s] = (droneSizes[s] || 0) + 1;
        }
        platforms[bundle.platform] = (platforms[bundle.platform] || 0) + 1;

        for (const score of bundle.tuningSessions.recentQualityScores) {
          totalQualityScore += score;
          qualityScoreCount++;
        }
      } catch {
        // Skip corrupt entries
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  // Format report
  const totalModes = modeDistribution.filter + modeDistribution.pid + modeDistribution.flash;
  const pct = (n: number) => (totalModes > 0 ? Math.round((n / totalModes) * 100) : 0);

  const sortedVersions = Object.entries(bfVersions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const sortedSizes = Object.entries(droneSizes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const sortedPlatforms = Object.entries(platforms)
    .sort((a, b) => b[1] - a[1]);

  const avgQuality =
    qualityScoreCount > 0 ? (totalQualityScore / qualityScoreCount).toFixed(1) : 'N/A';

  const date = new Date().toISOString().split('T')[0];

  const report = `PIDlab Telemetry Report — ${date}
${'═'.repeat(42)}
New installations (24h):     ${newInstallations24h}
Active users (24h):          ${active24h}
Active users (7d):           ${active7d}
Total installations:         ${totalInstallations.toLocaleString()}

Tuning Mode Distribution:
  Filter Tune:  ${pct(modeDistribution.filter)}% (${modeDistribution.filter})
  PID Tune:     ${pct(modeDistribution.pid)}% (${modeDistribution.pid})
  Flash Tune:   ${pct(modeDistribution.flash)}% (${modeDistribution.flash})

BF Versions:
${sortedVersions.map(([v, c]) => `  ${v}: ${c}`).join('\n') || '  (no data)'}

Drone Sizes:
${sortedSizes.map(([s, c]) => `  ${s}: ${c}`).join('\n') || '  (no data)'}

Platforms:
${sortedPlatforms.map(([p, c]) => `  ${p}: ${c}`).join('\n') || '  (no data)'}

Avg Quality Score: ${avgQuality}

Diagnostic Reports:
${await getDiagnosticSummary(env)}`;

  // Send via Resend
  if (!env.RESEND_API_KEY || !env.REPORT_EMAIL || !env.REPORT_FROM_EMAIL) {
    console.log('Cron: missing RESEND_API_KEY or REPORT_EMAIL, skipping email');
    console.log(report);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.REPORT_FROM_EMAIL,
      to: [env.REPORT_EMAIL],
      subject: `PIDlab Telemetry Report — ${date}`,
      text: report,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Cron: failed to send email: ${response.status} ${error}`);
  } else {
    console.log(`Cron: daily report sent to ${env.REPORT_EMAIL}`);
  }
}

/** Get diagnostic reports summary for cron email */
async function getDiagnosticSummary(env: Env): Promise<string> {
  const byStatus: Record<string, number> = {};
  let total = 0;
  let lastWeek = 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let cursor: string | undefined;
  try {
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
            const meta: { status: string; createdAt: string } = await metaObj.json();
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
  } catch {
    return '  (unable to read)';
  }

  if (total === 0) return '  (none)';

  const lines = [];
  if (byStatus.new) lines.push(`  ${byStatus.new} new (unreviewed)`);
  if (byStatus.reviewing) lines.push(`  ${byStatus.reviewing} reviewing`);
  if (byStatus['needs-bbl']) lines.push(`  ${byStatus['needs-bbl']} needs BBL data`);
  lines.push(`  ${lastWeek} received this week`);
  lines.push(`  ${total} total`);
  return lines.join('\n');
}
