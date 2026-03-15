import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: mockFs,
  ...mockFs,
}));

// Mock crypto
vi.mock('crypto', () => {
  const mocks = {
    createPublicKey: vi.fn(),
    verify: vi.fn(() => true),
  };
  return { default: mocks, ...mocks };
});

// Mock electron — isPackaged toggled per test group
const mockElectronApp = vi.hoisted(() => ({ isPackaged: true }));
vi.mock('electron', () => ({
  app: mockElectronApp,
  net: {
    fetch: vi.fn(),
  },
}));

// Mock LICENSE constant to have a dummy public key (avoids empty-key rejection in tests)
vi.mock('@shared/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    LICENSE: {
      ...(actual.LICENSE as Record<string, unknown>),
      ED25519_PUBLIC_KEY: 'dummykey',
    },
  };
});

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { LicenseManager } from './LicenseManager';

describe('LicenseManager', () => {
  let manager: LicenseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);

    manager = new LicenseManager('/tmp/test');
  });

  describe('initialize', () => {
    it('starts with free status when no license file', async () => {
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      const status = manager.getLicenseStatus();
      expect(status.type).toBe('free');
      expect(status.expiresAt).toBeNull();
    });

    it('loads existing license from file', async () => {
      const persisted = {
        key: 'PIDLAB-ABCD-EFGH-JKNM',
        signedLicense: {
          payload: {
            keyId: 'abc',
            type: 'paid',
            expiresAt: null,
            installationId: 'test-uuid',
            issuedAt: '2026-03-01T00:00:00Z',
          },
          signature: 'test-sig',
        },
        status: 'active',
        type: 'paid',
        expiresAt: null,
        activatedAt: '2026-03-01T00:00:00Z',
        lastValidatedAt: '2026-03-15T00:00:00Z',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(persisted));

      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      const status = manager.getLicenseStatus();
      expect(status.type).toBe('paid');
    });
  });

  describe('getLicenseStatus', () => {
    it('returns free when no license', async () => {
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      expect(manager.getLicenseStatus().type).toBe('free');
    });

    it('returns paid when demo mode', async () => {
      manager.setDemoMode(true);
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      expect(manager.getLicenseStatus().type).toBe('paid');
    });

    it('returns free for revoked license', async () => {
      const persisted = {
        key: 'PIDLAB-ABCD-EFGH-JKNM',
        signedLicense: {
          payload: {
            keyId: 'abc',
            type: 'paid',
            expiresAt: null,
            installationId: 'test',
            issuedAt: '2026-03-01',
          },
          signature: 'sig',
        },
        status: 'revoked',
        type: 'paid',
        expiresAt: null,
        activatedAt: '2026-03-01',
        lastValidatedAt: null,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(persisted));

      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      expect(manager.getLicenseStatus().type).toBe('free');
    });

    it('returns free for expired license', async () => {
      const persisted = {
        key: 'PIDLAB-ABCD-EFGH-JKNM',
        signedLicense: {
          payload: {
            keyId: 'abc',
            type: 'paid',
            expiresAt: '2020-01-01T00:00:00Z',
            installationId: 'test',
            issuedAt: '2019-01-01',
          },
          signature: 'sig',
        },
        status: 'active',
        type: 'paid',
        expiresAt: '2020-01-01T00:00:00Z',
        activatedAt: '2019-01-01',
        lastValidatedAt: null,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(persisted));

      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      expect(manager.getLicenseStatus().type).toBe('free');
    });

    it('masks key in status', async () => {
      const persisted = {
        key: 'PIDLAB-ABCD-EFGH-JKNM',
        signedLicense: {
          payload: {
            keyId: 'abc',
            type: 'paid',
            expiresAt: null,
            installationId: 'test',
            issuedAt: '2026-03-01',
          },
          signature: 'sig',
        },
        status: 'active',
        type: 'paid',
        expiresAt: null,
        activatedAt: '2026-03-01',
        lastValidatedAt: null,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(persisted));

      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      const status = manager.getLicenseStatus();
      expect(status.key).toBe('PIDLAB-ABCD-****-****');
    });
  });

  describe('isPro', () => {
    it('returns false for free', async () => {
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();
      expect(manager.isPro()).toBe(false);
    });

    it('returns true for demo mode', async () => {
      manager.setDemoMode(true);
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();
      expect(manager.isPro()).toBe(true);
    });
  });

  describe('removeLicense', () => {
    it('clears license and deletes file', async () => {
      const persisted = {
        key: 'PIDLAB-ABCD-EFGH-JKNM',
        signedLicense: {
          payload: {
            keyId: 'abc',
            type: 'paid',
            expiresAt: null,
            installationId: 'test',
            issuedAt: '2026-03-01',
          },
          signature: 'sig',
        },
        status: 'active',
        type: 'paid',
        expiresAt: null,
        activatedAt: '2026-03-01',
        lastValidatedAt: null,
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(persisted));

      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();
      expect(manager.isPro()).toBe(true);

      await manager.removeLicense();
      expect(manager.isPro()).toBe(false);
      expect(manager.getLicenseStatus().type).toBe('free');
      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('rejects invalid key format', async () => {
      manager.setInstallationIdProvider(() => 'test-uuid');
      await manager.initialize();

      await expect(manager.activate('invalid-key')).rejects.toThrow('Invalid license key format');
    });

    it('throws when installation ID provider not set', async () => {
      await manager.initialize();

      await expect(manager.activate('PIDLAB-ABCD-EFGH-JKNM')).rejects.toThrow(
        'Installation ID provider not set'
      );
    });
  });
});
