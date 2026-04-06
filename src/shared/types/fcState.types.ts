import type { FCInfo } from './common.types';
import type { PIDConfiguration, FeedforwardConfiguration, RatesConfiguration } from './pid.types';
import type { CurrentFilterSettings } from './analysis.types';
import type { BlackboxInfo, BlackboxSettings } from './blackbox.types';

/**
 * Cached FC state — all MSP-readable configuration in a single object.
 * Populated by FCStateCache.hydrate() on connection, invalidated per-slice.
 */
export interface FCState {
  info: FCInfo | null;
  statusEx: { pidProfileIndex: number; pidProfileCount: number } | null;
  pidConfig: PIDConfiguration | null;
  filterConfig: CurrentFilterSettings | null;
  feedforwardConfig: FeedforwardConfiguration | null;
  ratesConfig: RatesConfiguration | null;
  tuningConfig: Record<string, number> | null;
  blackboxInfo: BlackboxInfo | null;
  blackboxSettings: BlackboxSettings | null;
  hydratedAt: string | null;
  hydrating: boolean;
}

/** Slices that can be individually invalidated (excludes metadata fields) */
export type FCStateSlice = keyof Omit<FCState, 'hydratedAt' | 'hydrating'>;

/** Empty state constant for initialization and clear() */
export const EMPTY_FC_STATE: FCState = {
  info: null,
  statusEx: null,
  pidConfig: null,
  filterConfig: null,
  feedforwardConfig: null,
  ratesConfig: null,
  tuningConfig: null,
  blackboxInfo: null,
  blackboxSettings: null,
  hydratedAt: null,
  hydrating: false,
};
