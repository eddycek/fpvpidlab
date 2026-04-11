/**
 * Debug HTTP server for Claude Code integration.
 *
 * Exposes app state, screenshots, and logs via HTTP endpoints.
 * Only active when DEBUG_SERVER=true environment variable is set.
 *
 * Usage:
 *   npm run dev           # real FC + debug server on port 9300
 *   npm run dev:demo      # demo mode + debug server on port 9300
 *
 * ── Read-only endpoints (GET) ────────────────────────────────────────
 *   /health              — health check (PID, uptime)
 *   /state               — connection, profile, tuning session, blackbox info
 *   /screenshot          — capture renderer screenshot (saves PNG, returns path)
 *   /logs?n=50           — last N lines from electron-log file
 *   /console?level=all   — renderer console messages (filter: error, warn, info)
 *   /msp                 — MSP connection details, CLI mode, FC info, PID/filter config
 *   /tuning-history      — completed tuning session records for current profile
 *   /tuning-session      — active tuning session state
 *   /snapshots           — configuration snapshots for current profile
 *   /blackbox-logs       — downloaded blackbox logs for current profile
 *   /analyze?logId=X     — run full analysis pipeline (filter + PID + TF)
 *
 * ── Action endpoints (POST) ─────────────────────────────────────────
 *   /connect?port=X      — connect to FC (auto-selects first BF port if no param)
 *   /disconnect          — disconnect from FC
 *   /start-tuning?mode=X — start tuning session (mode: filter|pid|flash)
 *   /reset-session       — delete active tuning session
 *   /erase-flash         — erase blackbox flash memory
 *
 * Action endpoints enable autonomous testing without UI interaction.
 * They call the same IPC handlers the renderer uses, via executeJavaScript.
 */

import http from 'http';
import * as fsPromises from 'fs/promises';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { app } from 'electron';
import { getMainWindow } from '../window';
import { logger } from '../utils/logger';
import { BlackboxParser } from '../blackbox/BlackboxParser';
import { analyze as analyzeFilters } from '../analysis/FilterAnalyzer';
import { analyzePID, analyzeTransferFunction } from '../analysis/PIDAnalyzer';
import { extractFlightPIDs } from '../analysis/PIDRecommender';
import { validateBBLHeader, enrichSettingsFromBBLHeaders } from '../analysis/headerValidation';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';

const DEFAULT_PORT = 9300;
const MAX_LOG_LINES = 500;
const MAX_CONSOLE_MESSAGES = 200;

interface DebugDependencies {
  mspClient: any;
  profileManager: any;
  snapshotManager: any;
  tuningSessionManager: any;
  blackboxManager: any;
  tuningHistoryManager: any;
  isDemoMode: boolean;
}

let deps: DebugDependencies | null = null;
let server: http.Server | null = null;
const consoleMessages: Array<{ level: string; message: string; timestamp: string }> = [];

/**
 * Set dependencies — called from index.ts after managers are initialized.
 */
export function setDebugDependencies(d: DebugDependencies): void {
  deps = d;
}

/**
 * Start capturing renderer console messages.
 * Call after window is created.
 */
export function captureRendererConsole(): void {
  const win = getMainWindow();
  if (!win) return;

  win.webContents.on('console-message', (_event, level, message) => {
    const levelMap: Record<number, string> = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' };
    consoleMessages.push({
      level: levelMap[level] || 'info',
      message,
      timestamp: new Date().toISOString(),
    });
    // Keep bounded
    if (consoleMessages.length > MAX_CONSOLE_MESSAGES) {
      consoleMessages.splice(0, consoleMessages.length - MAX_CONSOLE_MESSAGES);
    }
  });
}

/**
 * Start the debug HTTP server.
 */
export function startDebugServer(port: number = DEFAULT_PORT): void {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      switch (path) {
        case '/health':
          return json(res, { status: 'ok', pid: process.pid, uptime: process.uptime() });

        case '/state':
          return json(res, await getAppState());

        case '/screenshot': {
          const w = parseInt(url.searchParams.get('width') || '0', 10) || undefined;
          const h = parseInt(url.searchParams.get('height') || '0', 10) || undefined;
          return json(res, await takeScreenshot(w, h));
        }

        case '/logs': {
          const n = parseInt(url.searchParams.get('n') || '50', 10);
          return json(res, await getLogTail(Math.min(n, MAX_LOG_LINES)));
        }

        case '/console': {
          const level = url.searchParams.get('level') || 'all';
          const filtered =
            level === 'all' ? consoleMessages : consoleMessages.filter((m) => m.level === level);
          return json(res, { messages: filtered.slice(-100) });
        }

        case '/msp':
          return json(res, await getMSPState());

        case '/tuning-history':
          return json(res, await getTuningHistory());

        case '/tuning-session':
          return json(res, await getTuningSession());

        case '/snapshots':
          return json(res, await getSnapshots());

        case '/blackbox-logs':
          return json(res, await getBlackboxLogs());

        case '/scroll': {
          const win = getMainWindow();
          if (!win) return json(res, { error: 'No window' });
          const y = parseInt(url.searchParams.get('y') || '500', 10);
          const sel = url.searchParams.get('selector') || 'html';
          await win.webContents.executeJavaScript(`
            document.querySelector('${sel}')?.scrollBy(0, ${y})
          `);
          return json(res, { scrolled: y, selector: sel });
        }

        case '/buttons': {
          const win = getMainWindow();
          if (!win) return json(res, { error: 'No window' });
          const buttons = await win.webContents.executeJavaScript(`
            [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
          `);
          return json(res, { buttons });
        }

        case '/analyze': {
          const logId = url.searchParams.get('logId') || undefined;
          const sessionIdx = parseInt(url.searchParams.get('session') || '0', 10);
          return json(res, await runFullAnalysis(logId, sessionIdx));
        }

        // ─── Action endpoints (POST only) ──────────────────────────────
        // These invoke the same IPC handlers the renderer uses, enabling
        // autonomous testing without needing UI interaction or browser tools.

        case '/connect':
          return await handlePost(req, res, () => handleConnect(url));

        case '/disconnect':
          return await handlePost(req, res, () => handleDisconnect());

        case '/start-tuning':
          return await handlePost(req, res, () => handleStartTuning(url));

        case '/reset-session':
          return await handlePost(req, res, () => handleResetSession());

        case '/erase-flash':
          return await handlePost(req, res, () => handleEraseFlash());

        case '/restore-snapshot':
          return await handlePost(req, res, () => handleRestoreSnapshot(url));

        case '/update-phase':
          return await handlePost(req, res, () => handleUpdatePhase(url));

        case '/apply':
          return await handlePost(req, res, () => handleApply(url));

        case '/open-wizard':
          return await handlePost(req, res, () => handleOpenWizard(url));

        case '/click':
          return await handlePost(req, res, () => handleClick(url));

        case '/wait-connected':
          return await handlePost(req, res, () => handleWaitConnected(url));

        case '/force-phase':
          return await handlePost(req, res, () => handleForcePhase(url));

        default:
          res.statusCode = 404;
          return json(res, {
            error: `Unknown endpoint: ${path}`,
            endpoints: [
              '/health',
              '/state',
              '/screenshot',
              '/logs',
              '/console',
              '/msp',
              '/tuning-history',
              '/tuning-session',
              '/snapshots',
              '/blackbox-logs',
              '/analyze',
              'POST /connect?port=X',
              'POST /disconnect',
              'POST /start-tuning?mode=filter|pid|flash',
              'POST /reset-session',
              'POST /erase-flash',
              'POST /restore-snapshot?id=X&backup=true',
              'POST /update-phase?phase=X&filterLogId=Y',
              'POST /apply?logId=X&mode=filter|pid',
              'POST /open-wizard?logId=X&mode=filter|pid',
              'POST /click?text=ButtonText|selector=.css-selector',
              'POST /wait-connected?timeout=30000',
              'POST /force-phase?phase=X&key=val (bypass transition validation)',
            ],
          });
      }
    } catch (err: any) {
      res.statusCode = 500;
      return json(res, { error: err.message || String(err) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`[DEBUG] Debug server listening on http://127.0.0.1:${port}`);
    logger.info(`[DEBUG] Endpoints: /health, /state, /screenshot, /logs, /console, /msp`);
  });

  server.on('error', (err) => {
    logger.warn(`[DEBUG] Debug server failed to start: ${err.message}`);
  });
}

export function stopDebugServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}

// ── Endpoint implementations ────────────────────────────────────────

async function getAppState() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { mspClient, profileManager, tuningSessionManager } = deps;

  const connected = mspClient?.isConnected?.() ?? false;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;

  let tuningSession = null;
  if (currentProfile) {
    try {
      tuningSession = await tuningSessionManager?.getSession?.(currentProfile.id);
    } catch {
      // ignore
    }
  }

  let bbInfo = null;
  if (connected) {
    try {
      bbInfo = await mspClient.getBlackboxInfo();
    } catch {
      // ignore
    }
  }

  let fcInfo = null;
  if (connected) {
    try {
      fcInfo = await mspClient.getFCInfo();
    } catch {
      // ignore
    }
  }

  return {
    connected,
    demoMode: deps.isDemoMode,
    profile: currentProfile
      ? {
          id: currentProfile.id,
          name: currentProfile.name,
          fcSerial: currentProfile.fcSerialNumber,
          size: currentProfile.size,
          flightStyle: currentProfile.flightStyle,
        }
      : null,
    fcInfo: fcInfo
      ? {
          variant: fcInfo.variant,
          version: fcInfo.version,
          target: fcInfo.target,
          boardName: fcInfo.boardName,
        }
      : null,
    tuningSession: tuningSession
      ? {
          phase: tuningSession.phase,
          type: tuningSession.type,
          startedAt: tuningSession.startedAt,
          eraseCompleted: tuningSession.eraseCompleted,
        }
      : null,
    blackbox: bbInfo
      ? {
          storageType: bbInfo.storageType,
          hasLogs: bbInfo.hasLogs,
          usedSize: bbInfo.usedSize,
          totalSize: bbInfo.totalSize,
        }
      : null,
  };
}

async function takeScreenshot(targetWidth?: number, targetHeight?: number) {
  const win = getMainWindow();
  if (!win) return { error: 'No window available' };

  // Ensure window is visible and focused for accurate capture
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  // Resize to target dimensions if provided (for high-res audit captures)
  const originalSize = win.getSize();
  const didResize = !!(targetWidth && targetHeight);
  let pngBuffer: Buffer;
  try {
    if (didResize) {
      win.setSize(targetWidth!, targetHeight!);
      // Wait for layout reflow after resize
      await new Promise((r) => setTimeout(r, 500));
    } else {
      await new Promise((r) => setTimeout(r, 200));
    }

    const image = await win.webContents.capturePage();
    pngBuffer = image.toPNG();
  } finally {
    // Restore original size if resized — even if capture throws
    if (didResize) {
      win.setSize(originalSize[0], originalSize[1]);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotDir = resolve(process.cwd(), 'debug-screenshots');

  // Ensure directory exists
  const { mkdir } = await import('fs/promises');
  await mkdir(screenshotDir, { recursive: true });

  const filePath = join(screenshotDir, `screenshot-${timestamp}.png`);
  const { writeFile } = await import('fs/promises');
  await writeFile(filePath, pngBuffer);

  return { path: filePath, size: pngBuffer.length, timestamp };
}

async function getLogTail(n: number) {
  // electron-log default path
  const logPath =
    process.platform === 'darwin'
      ? join(app.getPath('home'), 'Library/Logs/FPVPIDlab/main.log')
      : process.platform === 'win32'
        ? join(app.getPath('userData'), 'logs/main.log')
        : join(app.getPath('home'), '.config/FPVPIDlab/logs/main.log');

  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    return {
      path: logPath,
      totalLines: lines.length,
      lines: lines.slice(-n),
    };
  } catch (err: any) {
    return { error: `Cannot read log file: ${err.message}`, path: logPath };
  }
}

async function getMSPState() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { mspClient } = deps;
  const connected = mspClient?.isConnected?.() ?? false;

  const result: any = {
    connected,
    demoMode: deps.isDemoMode,
    mscModeActive: mspClient?.mscModeActive ?? false,
    rebootPending: mspClient?.rebootPending ?? false,
  };

  if (connected) {
    try {
      result.fcInfo = await mspClient.getFCInfo();
    } catch {
      result.fcInfo = null;
    }
    try {
      result.fcSerial = await mspClient.getFCSerialNumber();
    } catch {
      result.fcSerial = null;
    }
    try {
      result.filterConfig = await mspClient.getFilterConfiguration();
    } catch {
      result.filterConfig = null;
    }
    try {
      result.pidConfig = await mspClient.getPIDConfiguration();
    } catch {
      result.pidConfig = null;
    }
    try {
      result.feedforwardConfig = await mspClient.getFeedforwardConfiguration();
    } catch {
      result.feedforwardConfig = null;
    }
    try {
      result.ratesConfig = await mspClient.getRatesConfiguration();
    } catch {
      result.ratesConfig = null;
    }
    try {
      result.tuningConfig = await mspClient.getTuningConfig();
    } catch {
      result.tuningConfig = null;
    }
  }

  return result;
}

async function getTuningHistory() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { tuningHistoryManager, profileManager } = deps;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
  if (!currentProfile) return { error: 'No active profile', records: [] };

  try {
    const records = await tuningHistoryManager.getHistory(currentProfile.id);
    return {
      profileId: currentProfile.id,
      profileName: currentProfile.name,
      totalSessions: records.length,
      records: records.map((r: CompletedTuningRecord) => ({
        id: r.id,
        tuningType: r.tuningType,
        completedAt: r.completedAt,
        startedAt: r.startedAt,
        filterMetrics: r.filterMetrics,
        pidMetrics: r.pidMetrics,
        verificationMetrics: r.verificationMetrics,
        verificationPidMetrics: r.verificationPidMetrics,
        transferFunctionMetrics: r.transferFunctionMetrics,
        verificationTransferFunctionMetrics: r.verificationTransferFunctionMetrics,
        appliedFilterChanges: r.appliedFilterChanges,
        appliedPIDChanges: r.appliedPIDChanges,
        appliedFeedforwardChanges: r.appliedFeedforwardChanges,
        filterLogId: r.filterLogId,
        pidLogId: r.pidLogId,
        quickLogId: r.quickLogId,
        verificationLogId: r.verificationLogId,
        convergence: r.convergence,
        qualityScore: r.qualityScore,
        bfPidProfileIndex: r.bfPidProfileIndex,
      })),
    };
  } catch (err: any) {
    return { error: err.message, records: [] };
  }
}

async function getTuningSession() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { tuningSessionManager, profileManager } = deps;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
  if (!currentProfile) return { error: 'No active profile', session: null };

  try {
    const session = await tuningSessionManager.getSession(currentProfile.id);
    return {
      profileId: currentProfile.id,
      profileName: currentProfile.name,
      session,
    };
  } catch (err: any) {
    return { error: err.message, session: null };
  }
}

async function getSnapshots() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { snapshotManager, profileManager } = deps;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
  if (!currentProfile) return { error: 'No active profile', snapshots: [] };

  try {
    const snapshots = await snapshotManager.listSnapshots();
    return {
      profileId: currentProfile.id,
      profileName: currentProfile.name,
      totalSnapshots: snapshots.length,
      snapshots: snapshots.map((s: any) => ({
        id: s.id,
        label: s.label,
        type: s.type,
        timestamp: s.timestamp,
        cliDiffPreview: s.cliDiff ? s.cliDiff.substring(0, 500) : null,
      })),
    };
  } catch (err: any) {
    return { error: err.message, snapshots: [] };
  }
}

async function runFullAnalysis(logId?: string, sessionIndex: number = 0) {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { blackboxManager, profileManager, mspClient } = deps;

  // Find log: specific ID or latest
  let logMeta: any;
  try {
    if (logId) {
      logMeta = await blackboxManager.getLog(logId);
    } else {
      const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
      if (!currentProfile) return { error: 'No active profile — specify logId parameter' };
      const logs = await blackboxManager.listLogs(currentProfile.id);
      if (logs.length === 0) return { error: 'No blackbox logs found for current profile' };
      logMeta = logs[0]; // Most recent
    }
  } catch (err: any) {
    return { error: `Failed to find log: ${err.message}` };
  }

  if (!logMeta) return { error: `Log not found: ${logId}` };

  // Parse BBL
  let parseResult: any;
  try {
    const data = await fsPromises.readFile(logMeta.filepath);
    parseResult = await BlackboxParser.parse(data);
  } catch (err: any) {
    return { error: `Parse failed: ${err.message}`, log: logMeta.filename };
  }

  if (!parseResult.success || parseResult.sessions.length === 0) {
    return { error: 'Parse failed or no sessions found', log: logMeta.filename };
  }

  if (sessionIndex >= parseResult.sessions.length) {
    return {
      error: `Session ${sessionIndex} out of range (log has ${parseResult.sessions.length})`,
      log: logMeta.filename,
    };
  }

  const session = parseResult.sessions[sessionIndex];
  const headerWarnings = validateBBLHeader(session.header);
  const flightPIDs = extractFlightPIDs(session.header.rawHeaders);

  // Get current settings from FC or BBL headers
  let filterSettings: any = null;
  let pidConfig: any = null;
  const connected = mspClient?.isConnected?.() ?? false;

  if (connected) {
    try {
      filterSettings = await mspClient.getFilterConfiguration();
    } catch {
      /* ignore */
    }
    try {
      pidConfig = await mspClient.getPIDConfiguration();
    } catch {
      /* ignore */
    }
  }

  // Enrich filter settings from BBL headers
  if (filterSettings) {
    const enriched = enrichSettingsFromBBLHeaders(filterSettings, session.header.rawHeaders);
    if (enriched) filterSettings = enriched;
  } else {
    const enriched = enrichSettingsFromBBLHeaders(
      DEFAULT_FILTER_SETTINGS,
      session.header.rawHeaders
    );
    if (enriched) filterSettings = enriched;
  }

  // Get flight style and drone size from current profile
  let flightStyle: 'smooth' | 'balanced' | 'aggressive' = 'balanced';
  let droneSize: import('@shared/types/profile.types').DroneSize | undefined;
  try {
    const profile = await profileManager?.getCurrentProfile?.();
    if (profile?.flightStyle) flightStyle = profile.flightStyle;
    if (profile?.size) droneSize = profile.size;
  } catch {
    /* ignore */
  }

  // Run all analyses in parallel
  const noProgress = () => {};
  const results: any = {
    log: {
      filename: logMeta.filename,
      id: logMeta.id,
      size: logMeta.size,
      sessionCount: parseResult.sessions.length,
      analyzedSession: sessionIndex,
    },
    parse: {
      success: true,
      parseTimeMs: parseResult.parseTimeMs,
      headerWarnings,
      sampleRate: session.header.sysConfig?.looptime
        ? Math.round(1000000 / session.header.sysConfig.looptime)
        : null,
      duration: session.flightData.gyro?.[0]
        ? `${((session.flightData.gyro[0].length / (session.header.sysConfig?.looptime ? 1000000 / session.header.sysConfig.looptime : 4000)) * 1000).toFixed(0)}ms`
        : null,
      flightPIDs,
    },
    currentSettings: {
      filters: filterSettings,
      pids: pidConfig,
      source: connected ? 'FC (live)' : 'BBL headers (estimated)',
    },
    filter: null as any,
    pid: null as any,
    transferFunction: null as any,
  };

  // Run analyses in parallel
  const [filterResult, pidResult, tfResult] = await Promise.allSettled([
    analyzeFilters(session.flightData, sessionIndex, filterSettings, noProgress, {
      droneSize,
      flightStyle,
    }),
    analyzePID(
      session.flightData,
      sessionIndex,
      pidConfig,
      noProgress,
      flightPIDs,
      session.header.rawHeaders,
      flightStyle,
      undefined,
      droneSize
    ),
    analyzeTransferFunction(
      session.flightData,
      sessionIndex,
      pidConfig,
      noProgress,
      flightPIDs,
      session.header.rawHeaders,
      flightStyle,
      undefined,
      droneSize
    ),
  ]);

  if (filterResult.status === 'fulfilled') {
    const r = filterResult.value;
    results.filter = {
      noise: r.noise,
      recommendations: r.recommendations,
      dataQuality: r.dataQuality,
      throttleSpectrogram: r.throttleSpectrogram
        ? { bands: r.throttleSpectrogram.bands?.length }
        : null,
      groupDelay: r.groupDelay,
      warnings: [...headerWarnings, ...(r.warnings || [])],
      analysisTimeMs: r.analysisTimeMs,
    };
  } else {
    results.filter = { error: filterResult.reason?.message || 'Filter analysis failed' };
  }

  if (pidResult.status === 'fulfilled') {
    const r = pidResult.value;
    results.pid = {
      stepsDetected: r.stepsDetected,
      axisMetrics: { roll: r.roll, pitch: r.pitch, yaw: r.yaw },
      recommendations: r.recommendations,
      dataQuality: r.dataQuality,
      crossAxisCoupling: r.crossAxisCoupling,
      propWash: r.propWash,
      dTermEffectiveness: r.dTermEffectiveness,
      warnings: [...headerWarnings, ...(r.warnings || [])],
      analysisTimeMs: r.analysisTimeMs,
    };
  } else {
    results.pid = { error: pidResult.reason?.message || 'PID analysis failed' };
  }

  if (tfResult.status === 'fulfilled') {
    const r = tfResult.value;
    const tf = r.transferFunction;
    results.transferFunction = {
      recommendations: r.recommendations,
      metrics: {
        roll: tf.metrics.roll,
        pitch: tf.metrics.pitch,
        yaw: tf.metrics.yaw,
      },
      dataQuality: r.dataQuality,
      analysisTimeMs: r.analysisTimeMs,
    };
  } else {
    results.transferFunction = {
      error: tfResult.reason?.message || 'Transfer function analysis failed',
    };
  }

  return results;
}

async function getBlackboxLogs() {
  if (!deps) return { error: 'Dependencies not initialized' };

  const { blackboxManager, profileManager } = deps;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
  if (!currentProfile) return { error: 'No active profile', logs: [] };

  try {
    const logs = await blackboxManager.listLogs(currentProfile.id);
    return {
      profileId: currentProfile.id,
      profileName: currentProfile.name,
      totalLogs: logs.length,
      logsDir: blackboxManager.getLogsDir(),
      logs: logs.map((l: any) => ({
        id: l.id,
        filename: l.filename,
        filepath: l.filepath,
        size: l.size,
        timestamp: l.timestamp,
        sessionCount: l.sessionCount,
      })),
    };
  } catch (err: any) {
    return { error: err.message, logs: [] };
  }
}

// ── Action endpoint handlers ────────────────────────────────────────

async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  handler: () => Promise<any>
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return json(res, { error: 'POST only' });
  }
  return json(res, await handler());
}

async function handleConnect(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const mspClient = deps?.mspClient;
  if (!mspClient) return { error: 'No MSP client' };
  if (mspClient.isConnected()) return { status: 'already_connected' };
  const ports = await mspClient.listPorts();
  if (ports.length === 0) return { error: 'No BF ports found' };
  const portPath = url.searchParams.get('port') || ports[0].path;
  // Connect via renderer IPC so UI gets connection events
  const result = await win.webContents.executeJavaScript(
    `window.betaflight.connect('${portPath}')`
  );
  return { status: 'connected', port: portPath, result };
}

async function handleDisconnect() {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  // Disconnect via renderer IPC so UI gets connection events
  await win.webContents.executeJavaScript(`window.betaflight.disconnect()`);
  return { status: 'disconnected' };
}

async function handleStartTuning(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const mode = url.searchParams.get('mode') || 'filter';
  const validModes = ['filter', 'pid', 'flash'];
  if (!validModes.includes(mode)) {
    return { error: `Invalid mode: ${mode}. Valid: ${validModes.join(', ')}` };
  }
  // Fire-and-forget: startTuningSession creates a snapshot (CLI + reboot)
  // which can take 30+ seconds. Return immediately, poll /tuning-session.
  win.webContents
    .executeJavaScript(`window.betaflight.startTuningSession('${mode}')`)
    .catch((err: any) => logger.warn('[DEBUG] startTuningSession failed:', err));
  return { status: 'starting', mode, message: 'Poll /tuning-session for result' };
}

async function handleResetSession() {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const result = await win.webContents.executeJavaScript(`window.betaflight.resetTuningSession()`);
  return result;
}

async function handleEraseFlash() {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const result = await win.webContents.executeJavaScript(`window.betaflight.eraseBlackboxFlash()`);
  return result;
}

async function handleRestoreSnapshot(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const id = url.searchParams.get('id');
  if (!id) return { error: 'Missing id parameter' };
  const backup = url.searchParams.get('backup') !== 'false';
  // Fire-and-forget: restore involves CLI commands + reboot (30+ seconds).
  // Poll /wait-connected + /state for result.
  win.webContents
    .executeJavaScript(`window.betaflight.restoreSnapshot('${id}', ${backup})`)
    .catch((err: any) => logger.warn('[DEBUG] restoreSnapshot failed:', err));
  return { status: 'restoring', snapshotId: id, message: 'Poll /wait-connected for completion' };
}

async function handleUpdatePhase(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const phase = url.searchParams.get('phase');
  if (!phase) return { error: 'Missing phase parameter' };
  const data: Record<string, any> = {};
  for (const field of [
    'filterLogId',
    'pidLogId',
    'quickLogId',
    'verificationLogId',
    'eraseSkipped',
    'eraseCompleted',
  ]) {
    const val = url.searchParams.get(field);
    if (val != null) {
      data[field] = field.endsWith('Skipped') || field.endsWith('Completed') ? val === 'true' : val;
    }
  }
  const dataJson = JSON.stringify(data);
  const result = await win.webContents.executeJavaScript(
    `window.betaflight.updateTuningPhase('${phase}', ${dataJson})`
  );
  return result;
}

/**
 * Force-set tuning session phase and arbitrary fields, bypassing transition validation.
 * Debug-only — for testing UI states that are hard to reach via normal workflow.
 *
 * Usage: POST /force-phase?phase=pid_verification_pending&pidLogId=abc&verificationLogId=def
 * All query params except 'phase' are merged into the session as extra data.
 */
async function handleForcePhase(url: URL) {
  if (!deps) return { error: 'Dependencies not initialized' };
  const { tuningSessionManager, profileManager } = deps;
  const currentProfile = (await profileManager?.getCurrentProfile?.()) ?? null;
  if (!currentProfile) return { error: 'No active profile' };

  const phase = url.searchParams.get('phase');
  if (!phase) return { error: 'Missing phase parameter' };

  const session = await tuningSessionManager.getSession(currentProfile.id);
  if (!session) return { error: 'No active tuning session' };

  // Collect all extra params as session data
  const extraData: Record<string, any> = {};
  for (const [key, val] of url.searchParams.entries()) {
    if (key === 'phase') continue;
    // Auto-convert booleans
    if (val === 'true' || val === 'false') {
      extraData[key] = val === 'true';
    } else {
      extraData[key] = val;
    }
  }

  // Direct write — bypass VALID_TRANSITIONS check
  const updated = {
    ...session,
    ...extraData,
    phase,
    updatedAt: new Date().toISOString(),
  };

  const sessionDir = join(app.getPath('userData'), 'data', 'tuning');
  const filePath = join(sessionDir, `${currentProfile.id}.json`);
  await fsPromises.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');

  // Notify renderer of state change
  const win = getMainWindow();
  if (win) {
    win.webContents.send('tuning-session-changed', updated);
  }

  logger.info(`[DEBUG] Force-set phase to '${phase}' for profile ${currentProfile.id}`);
  return updated;
}

async function handleApply(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const logId = url.searchParams.get('logId');
  if (!logId) return { error: 'Missing logId parameter' };
  const mode = url.searchParams.get('mode') || 'filter';
  const sessionIdx = parseInt(url.searchParams.get('session') || '0', 10);

  // 1) Run analysis server-side
  const analysis = await runFullAnalysis(logId, sessionIdx);
  if (analysis.error) return { error: analysis.error, step: 'analysis' };

  // 2) Extract recommendations based on mode
  const filterRecs = mode !== 'pid' ? (analysis.filter?.recommendations ?? []) : [];
  const allPidRecs = mode !== 'filter' ? (analysis.pid?.recommendations ?? []) : [];
  const purePidRecs = allPidRecs.filter((r: any) => r.setting?.startsWith('pid_'));
  const ffRecs = allPidRecs.filter((r: any) => r.setting && !r.setting.startsWith('pid_'));

  // Only include actionable changed recommendations
  const changed = (recs: any[]) =>
    recs.filter((r: any) => r.currentValue !== r.recommendedValue && !r.informational);

  const applyInput = {
    filterRecommendations: changed(filterRecs),
    pidRecommendations: changed(purePidRecs),
    feedforwardRecommendations: changed(ffRecs),
  };

  // 3) Apply via renderer IPC — fire-and-forget (apply includes save+reboot)
  // Poll /wait-connected + /tuning-session for result.
  const inputJson = JSON.stringify(applyInput);
  win.webContents
    .executeJavaScript(`window.betaflight.applyRecommendations(${inputJson})`)
    .catch((err: any) => logger.warn('[DEBUG] applyRecommendations failed:', err));

  return {
    status: 'applying',
    message: 'Poll /wait-connected + /tuning-session for result',
    recommendations: {
      filter: applyInput.filterRecommendations.length,
      pid: applyInput.pidRecommendations.length,
      feedforward: applyInput.feedforwardRecommendations.length,
      details: applyInput,
    },
  };
}

async function handleOpenWizard(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const logId = url.searchParams.get('logId');
  const mode = url.searchParams.get('mode') || 'filter';
  if (!logId) return { error: 'Missing logId parameter' };
  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new CustomEvent('debug:open-wizard', {
      detail: { logId: '${logId}', mode: '${mode}' }
    }))
  `);
  return { status: 'ok', logId, mode };
}

async function handleClick(url: URL) {
  const win = getMainWindow();
  if (!win) return { error: 'No window' };
  const text = url.searchParams.get('text');
  const selector = url.searchParams.get('selector');
  if (!text && !selector) return { error: 'Provide text= or selector= parameter' };

  const script = text
    ? `(function() {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => b.textContent.trim() === '${text.replace(/'/g, "\\'")}');
        if (!btn) return { error: 'Button not found: ${text.replace(/'/g, "\\'")}' };
        btn.click();
        return { clicked: btn.textContent.trim() };
      })()`
    : `(function() {
        const el = document.querySelector('${selector!.replace(/'/g, "\\'")}');
        if (!el) return { error: 'Element not found: ${selector!.replace(/'/g, "\\'")}' };
        el.click();
        return { clicked: true };
      })()`;

  const result = await win.webContents.executeJavaScript(script);
  return result;
}

async function handleWaitConnected(url: URL) {
  const timeoutMs = parseInt(url.searchParams.get('timeout') || '30000', 10);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (deps?.mspClient?.isConnected?.()) {
      return { status: 'connected', waitedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { error: 'Timeout waiting for FC connection', waitedMs: timeoutMs };
}

// ── Helpers ─────────────────────────────────────────────────────────

function json(res: http.ServerResponse, data: any): void {
  res.end(JSON.stringify(data, null, 2));
}
