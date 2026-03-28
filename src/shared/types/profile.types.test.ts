import { describe, it, expect } from 'vitest';
import type {
  FlightStyle,
  DroneProfileRequired,
  ProfileCreationInput,
  ProfileUpdateInput,
} from './profile.types';

describe('FlightStyle type', () => {
  it('accepts valid flight style values', () => {
    const styles: FlightStyle[] = ['smooth', 'balanced', 'aggressive'];
    expect(styles).toHaveLength(3);
  });

  it('is required in DroneProfileRequired', () => {
    const profile: DroneProfileRequired = {
      name: 'Test',
      size: '5"',
      battery: '6S',
      weight: 650,
      flightStyle: 'aggressive',
    };
    expect(profile.flightStyle).toBe('aggressive');
    expect(profile.weight).toBe(650);
  });

  it('is inherited by ProfileCreationInput', () => {
    const input: ProfileCreationInput = {
      fcSerialNumber: 'abc123',
      fcInfo: {
        variant: 'BTFL',
        version: '4.5.0',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
        target: 'STM32F405',
        boardName: 'Test',
      },
      name: 'Test',
      size: '5"',
      battery: '6S',
      weight: 650,
      flightStyle: 'smooth',
    };
    expect(input.flightStyle).toBe('smooth');
  });

  it('is optional in ProfileUpdateInput', () => {
    const update: ProfileUpdateInput = { flightStyle: 'balanced' };
    expect(update.flightStyle).toBe('balanced');
  });
});
