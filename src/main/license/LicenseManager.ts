import { join } from 'path';
import fs from 'fs/promises';
import { createPublicKey, verify } from 'crypto';
import { app, net } from 'electron';
import { LICENSE } from '@shared/constants';
import type { LicenseInfo, PersistedLicense, SignedLicense } from '@shared/types/license.types';
import { logger } from '../utils/logger';

const LICENSE_FILE = 'license.json';

export class LicenseManager {
  private basePath: string;
  private license: PersistedLicense | null = null;
  private isDemoMode = false;
  private installationIdProvider: (() => string) | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  setDemoMode(value: boolean): void {
    this.isDemoMode = value;
  }

  /** Set a callback that provides the installation ID (from TelemetryManager) */
  setInstallationIdProvider(provider: () => string): void {
    this.installationIdProvider = provider;
  }

  private get licensePath(): string {
    return join(this.basePath, LICENSE_FILE);
  }

  private getInstallationId(): string {
    if (this.installationIdProvider) {
      return this.installationIdProvider();
    }
    throw new Error('Installation ID provider not set');
  }

  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.licensePath, 'utf-8');
      this.license = JSON.parse(raw);

      // Validate offline on startup
      if (this.license) {
        const valid = await this.validateOffline(this.license.signedLicense);
        if (!valid) {
          logger.warn('License: offline validation failed, clearing license');
          this.license = null;
          await this.removeLicenseFile();
        }
      }
    } catch {
      // No license file or corrupt — free mode
      this.license = null;
    }

    // Background online validation (non-blocking)
    if (this.license) {
      this.validateIfDue().catch(() => {});
    }
  }

  /** Get current license status */
  getLicenseStatus(): LicenseInfo {
    // Dev mode and demo mode always get Pro (no restrictions for development)
    if (this.isDemoMode || !app.isPackaged) {
      return { type: 'paid', expiresAt: null };
    }

    if (!this.license || this.license.status === 'revoked') {
      return { type: 'free', expiresAt: null };
    }

    // Check expiration
    if (this.license.expiresAt) {
      const expiresAt = new Date(this.license.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        return { type: 'free', expiresAt: this.license.expiresAt };
      }
    }

    return {
      type: this.license.type,
      key: this.maskKey(this.license.key),
      expiresAt: this.license.expiresAt,
      activatedAt: this.license.activatedAt,
      lastValidatedAt: this.license.lastValidatedAt ?? undefined,
    };
  }

  /** Whether the user has Pro access */
  isPro(): boolean {
    const status = this.getLicenseStatus();
    return status.type === 'paid' || status.type === 'tester';
  }

  /**
   * Activate a license key.
   * 1. Validate format
   * 2. Call server to activate (binds installation ID, returns signed license)
   * 3. Verify signed license offline
   * 4. Persist locally
   */
  async activate(key: string): Promise<LicenseInfo> {
    // Format check
    const normalizedKey = key.trim().toUpperCase();
    if (!LICENSE.KEY_FORMAT_REGEX.test(normalizedKey)) {
      throw new Error('Invalid license key format. Expected: PIDLAB-XXXX-XXXX-XXXX');
    }

    const installationId = this.getInstallationId();

    // Call activation endpoint (dev → dev worker, prod → prod worker)
    const defaultUrl = app.isPackaged ? LICENSE.API_URL : LICENSE.API_URL_DEV;
    const apiUrl = process.env.LICENSE_API_URL || defaultUrl;
    const response = await net.fetch(`${apiUrl}/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: normalizedKey, installationId }),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: 'Activation failed' }))) as {
        error?: string;
      };
      throw new Error(error.error || `Activation failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as { status: string; license: SignedLicense };

    // Verify the signed license offline
    const valid = await this.validateOffline(data.license);
    if (!valid) {
      throw new Error('License signature verification failed');
    }

    // Persist
    const now = new Date().toISOString();
    this.license = {
      key: normalizedKey,
      signedLicense: data.license,
      status: 'active',
      type: data.license.payload.type,
      expiresAt: data.license.payload.expiresAt,
      activatedAt: data.license.payload.issuedAt || now,
      lastValidatedAt: now,
    };
    await this.persist();

    logger.info('License: activated successfully');
    return this.getLicenseStatus();
  }

  /** Online validation — sync revocation status. Best-effort, non-blocking. */
  async validateOnline(): Promise<void> {
    if (!this.license) return;

    const installationId = this.getInstallationId();
    const defaultUrl = app.isPackaged ? LICENSE.API_URL : LICENSE.API_URL_DEV;
    const apiUrl = process.env.LICENSE_API_URL || defaultUrl;

    try {
      const response = await net.fetch(`${apiUrl}/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: this.license.key, installationId }),
      });

      if (!response.ok) {
        logger.warn(`License: validation failed (HTTP ${response.status})`);
        return;
      }

      const data = (await response.json()) as { status: string };

      if (data.status === 'revoked') {
        logger.warn('License: key has been revoked');
        this.license.status = 'revoked';
        await this.persist();
        return;
      }

      // Update last validated
      this.license.lastValidatedAt = new Date().toISOString();
      await this.persist();
      logger.info('License: online validation successful');
    } catch (err) {
      logger.warn('License: online validation failed (network error):', err);
    }
  }

  /** Validate signature offline using bundled public key */
  async validateOffline(signedLicense: SignedLicense): Promise<boolean> {
    try {
      const publicKeyBase64 = LICENSE.ED25519_PUBLIC_KEY;
      if (!publicKeyBase64) {
        // No public key = can't verify. In dev mode this is OK (isPro bypasses anyway).
        // In production, reject — prevents forged license.json from unlocking Pro.
        if (!app.isPackaged) {
          logger.warn('License: no public key configured (dev mode — skipping validation)');
          return true;
        }
        logger.error('License: no public key configured in production build — rejecting');
        return false;
      }

      const pubKey = createPublicKey({
        key: Buffer.from(publicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });

      const payloadBuffer = Buffer.from(JSON.stringify(signedLicense.payload));

      // Convert base64url to base64 with proper padding
      const sigBase64 = signedLicense.signature.replace(/-/g, '+').replace(/_/g, '/');
      const padded = sigBase64 + '='.repeat((4 - (sigBase64.length % 4)) % 4);
      const sigBuffer = Buffer.from(padded, 'base64');

      return verify(null, payloadBuffer, pubKey, sigBuffer);
    } catch (err) {
      logger.error('License: offline validation error:', err);
      return false;
    }
  }

  /** Validate if enough time has passed since last check */
  async validateIfDue(): Promise<void> {
    if (!this.license) return;

    const lastValidated = this.license.lastValidatedAt
      ? new Date(this.license.lastValidatedAt).getTime()
      : 0;
    const now = Date.now();

    if (now - lastValidated >= LICENSE.VALIDATION_INTERVAL_MS) {
      await this.validateOnline();
    }
  }

  /** Remove license (back to free) */
  async removeLicense(): Promise<void> {
    this.license = null;
    await this.removeLicenseFile();
    logger.info('License: removed');
  }

  private maskKey(key: string): string {
    // PIDLAB-XXXX-XXXX-XXXX → PIDLAB-XXXX-****-****
    const parts = key.split('-');
    if (parts.length !== 4) return '****';
    return `${parts[0]}-${parts[1]}-****-****`;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(this.licensePath, JSON.stringify(this.license, null, 2));
  }

  private async removeLicenseFile(): Promise<void> {
    try {
      await fs.unlink(this.licensePath);
    } catch {
      // File might not exist
    }
  }
}
