import { BrowserWindow } from 'electron';
import { IPCChannel } from '@shared/types/ipc.types';
import type { ConnectionStatus, FCInfo } from '@shared/types/common.types';
import type { DroneProfile } from '@shared/types/profile.types';
import type { PIDConfiguration } from '@shared/types/pid.types';
import type { TuningSession } from '@shared/types/tuning.types';
import type { LicenseInfo } from '@shared/types/license.types';
import type { FCState } from '@shared/types/fcState.types';
import { getMainWindow } from '../../window';

export function sendConnectionChanged(window: BrowserWindow, status: ConnectionStatus): void {
  window.webContents.send(IPCChannel.EVENT_CONNECTION_CHANGED, status);
}

export function sendError(window: BrowserWindow, error: string): void {
  window.webContents.send(IPCChannel.EVENT_ERROR, error);
}

export function sendLog(window: BrowserWindow, message: string, level: string): void {
  window.webContents.send(IPCChannel.EVENT_LOG, message, level);
}

export function sendProfileChanged(window: BrowserWindow, profile: DroneProfile | null): void {
  window.webContents.send(IPCChannel.EVENT_PROFILE_CHANGED, profile);
}

export function sendNewFCDetected(window: BrowserWindow, fcSerial: string, fcInfo: FCInfo): void {
  window.webContents.send(IPCChannel.EVENT_NEW_FC_DETECTED, fcSerial, fcInfo);
}

export function sendPIDChanged(window: BrowserWindow, config: PIDConfiguration): void {
  window.webContents.send(IPCChannel.EVENT_PID_CHANGED, config);
}

export function sendTuningSessionChanged(session: TuningSession | null): void {
  const window = getMainWindow();
  if (window) {
    window.webContents.send(IPCChannel.EVENT_TUNING_SESSION_CHANGED, session);
  }
}

export function sendFCStateChanged(window: BrowserWindow, state: FCState): void {
  window.webContents.send(IPCChannel.EVENT_FC_STATE_CHANGED, state);
}

export function sendLicenseChanged(window: BrowserWindow, info: LicenseInfo): void {
  window.webContents.send(IPCChannel.EVENT_LICENSE_CHANGED, info);
}
