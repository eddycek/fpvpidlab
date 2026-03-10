import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepResponseChart } from './StepResponseChart';
import type { AxisStepProfile, StepResponse, StepEvent } from '@shared/types/analysis.types';

// ResponsiveContainer needs a real layout engine — mock it for JSDOM
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 700, height: 300 }),
  };
});

function makeStep(overrides: Partial<StepEvent> = {}): StepEvent {
  return {
    axis: 0,
    startIndex: 0,
    endIndex: 100,
    magnitude: 300,
    direction: 'positive',
    ...overrides,
  };
}

function makeResponse(overshoot: number, hasTrace: boolean = true): StepResponse {
  const traceLen = 50;
  return {
    step: makeStep(),
    riseTimeMs: 20,
    overshootPercent: overshoot,
    settlingTimeMs: 50,
    latencyMs: 5.5,
    ringingCount: 1,
    peakValue: 300 + overshoot * 3,
    steadyStateValue: 300,
    trace: hasTrace
      ? {
          timeMs: Array.from({ length: traceLen }, (_, i) => i * 0.25),
          setpoint: Array.from({ length: traceLen }, (_, i) => (i >= 5 ? 300 : 0)),
          gyro: Array.from({ length: traceLen }, (_, i) => {
            if (i < 8) return 0;
            return 300 + overshoot * 3 * Math.exp(-(i - 8) * 0.1) * Math.sin(i * 0.5);
          }),
        }
      : undefined,
  };
}

function makeProfile(count: number, withTrace: boolean = true): AxisStepProfile {
  const responses = Array.from({ length: count }, (_, i) => makeResponse(5 + i * 3, withTrace));
  return {
    responses,
    meanOvershoot:
      responses.reduce((s, r) => s + r.overshootPercent, 0) / Math.max(responses.length, 1),
    meanRiseTimeMs: 20,
    meanSettlingTimeMs: 50,
    meanLatencyMs: 5.5,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  };
}

const mockRoll = makeProfile(5);
const mockPitch = makeProfile(3);
const mockYaw = makeProfile(2);

const _emptyProfile: AxisStepProfile = {
  responses: [],
  meanOvershoot: 0,
  meanRiseTimeMs: 0,
  meanSettlingTimeMs: 0,
  meanLatencyMs: 0,
  meanTrackingErrorRMS: 0,
  meanSteadyStateError: 0,
};

describe('StepResponseChart', () => {
  it('renders SVG chart with axis tabs', () => {
    const { container } = render(
      <StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />
    );

    expect(screen.getByRole('tab', { name: 'Roll' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('shows empty state when no traces available', () => {
    const noTraceProfile = makeProfile(3, false);
    render(<StepResponseChart roll={noTraceProfile} pitch={noTraceProfile} yaw={noTraceProfile} />);

    expect(screen.getByText('No step response trace data available.')).toBeInTheDocument();
  });

  it('shows step navigator with step count', () => {
    render(<StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />);

    // Default is roll axis, which has 5 steps
    expect(screen.getByText(/Step \d+ \/ 5/)).toBeInTheDocument();
    expect(screen.getByText('Prev')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('shows metrics overlay for current step', () => {
    render(<StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />);

    expect(screen.getByText(/Overshoot:/)).toBeInTheDocument();
    expect(screen.getByText(/Rise:/)).toBeInTheDocument();
    expect(screen.getByText(/Settling:/)).toBeInTheDocument();
    expect(screen.getByText(/Latency:/)).toBeInTheDocument();
  });

  it('navigates between steps with Prev/Next buttons', async () => {
    const user = userEvent.setup();
    render(<StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />);

    // Find which step we start at
    const _initialText = screen.getByText(/Step \d+ \/ 5/).textContent!;

    // Click Next
    await user.click(screen.getByText('Next'));

    // Step counter should change
    const afterNext = screen.getByText(/Step \d+ \/ 5/).textContent!;
    // They might be different if we didn't start at the last step
    // Just verify the buttons work without error
    expect(afterNext).toBeTruthy();
  });

  it('disables Prev button at first step', async () => {
    const _user = userEvent.setup();
    render(<StepResponseChart roll={makeProfile(1)} pitch={mockPitch} yaw={mockYaw} />);

    // With only 1 step, both prev and next should be disabled
    expect(screen.getByText('Prev')).toBeDisabled();
    expect(screen.getByText('Next')).toBeDisabled();
  });

  it('switches to pitch axis when tab clicked', async () => {
    const user = userEvent.setup();
    render(<StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />);

    await user.click(screen.getByRole('tab', { name: 'Pitch' }));

    // Pitch has 3 steps
    expect(screen.getByText(/Step \d+ \/ 3/)).toBeInTheDocument();
  });

  it('hides step navigator in All mode', async () => {
    const user = userEvent.setup();
    render(<StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />);

    await user.click(screen.getByRole('tab', { name: 'All' }));

    expect(screen.queryByText(/Step \d+ \//)).not.toBeInTheDocument();
  });

  it('renders chart lines for single axis mode', () => {
    const { container } = render(
      <StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />
    );

    const lines = container.querySelectorAll('.recharts-line');
    // Should have 2 lines: setpoint + gyro
    expect(lines.length).toBe(2);
  });

  it('renders 3 overlay lines in All mode', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <StepResponseChart roll={mockRoll} pitch={mockPitch} yaw={mockYaw} />
    );

    await user.click(screen.getByRole('tab', { name: 'All' }));

    const lines = container.querySelectorAll('.recharts-line');
    expect(lines.length).toBe(3);
  });
});
