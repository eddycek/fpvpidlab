export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  productId?: string;
  vendorId?: string;
}

export interface ApiVersionInfo {
  protocol: number;
  major: number;
  minor: number;
}

export interface BoardInfo {
  boardIdentifier: string;
  boardVersion: number;
  boardType: number;
  targetName: string;
  boardName: string;
  manufacturerId: string;
  signature: number[];
  mcuTypeId: number;
  configurationState: number;
}

export interface FCInfo {
  variant: string;
  version: string;
  target: string;
  boardName: string;
  craftName?: string; // User-configured name from BF Configurator (MSP_NAME)
  apiVersion: ApiVersionInfo;
  pidProfileIndex?: number; // 0-based, from MSP_STATUS_EX byte 10
  pidProfileCount?: number; // number of available PID profiles (typically 4 for BF 4.5+)
}

export interface Configuration {
  cliDiff: string;
  cliDump?: string;
}

export interface ConfigurationSnapshot {
  id: string;
  timestamp: string;
  label: string;
  type: 'baseline' | 'manual' | 'auto';
  fcInfo: FCInfo;
  configuration: Configuration;
  metadata: {
    appVersion: string;
    createdBy: 'user' | 'auto';
    notes?: string;
    tuningSessionNumber?: number;
    tuningType?: 'filter' | 'pid' | 'flash';
    snapshotRole?: 'pre-tuning' | 'post-tuning';
    bfPidProfileIndex?: number; // active BF PID profile when snapshot was created
  };
}

export interface SnapshotMetadata {
  id: string;
  timestamp: string;
  label: string;
  type: 'baseline' | 'manual' | 'auto';
  sizeBytes: number;
  fcInfo: {
    variant: string;
    version: string;
    boardName: string;
  };
  tuningSessionNumber?: number;
  tuningType?: 'filter' | 'pid' | 'flash';
  snapshotRole?: 'pre-tuning' | 'post-tuning';
  bfPidProfileIndex?: number;
}

export interface ConnectionStatus {
  connected: boolean;
  portPath?: string;
  fcInfo?: FCInfo;
  error?: string;
}

export type DiffEntryStatus = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  key: string;
  oldValue?: string;
  newValue?: string;
  status: DiffEntryStatus;
}
