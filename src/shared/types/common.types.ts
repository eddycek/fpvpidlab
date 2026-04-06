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
  pidProfileNames?: Record<number, string>; // Profile names from FC (parsed from CLI diff), e.g. {0: "pidlab_1"}
}

export interface Configuration {
  cliDiff: string;
  cliDump?: string;
  /** MSP-read PID gains at snapshot time (not in CLI diff when simplified_pids_mode is ON) */
  pidConfig?: import('./pid.types').PIDConfiguration;
  /** MSP-read filter settings at snapshot time */
  filterConfig?: import('./analysis.types').CurrentFilterSettings;
  /** MSP-read feedforward settings at snapshot time */
  feedforwardConfig?: import('./pid.types').FeedforwardConfiguration;
  /** MSP-read rates at snapshot time */
  ratesConfig?: import('./pid.types').RatesConfiguration;
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
