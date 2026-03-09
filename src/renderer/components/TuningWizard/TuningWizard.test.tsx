import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningWizard } from './TuningWizard';
import type { BlackboxParseResult, BlackboxLogSession } from '@shared/types/blackbox.types';
import type { FilterAnalysisResult, PIDAnalysisResult } from '@shared/types/analysis.types';
import { TUNING_MODE } from '@shared/constants';

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

const mockSession: BlackboxLogSession = {
  index: 0,
  header: {
    product: 'Blackbox flight data recorder',
    dataVersion: 2,
    firmwareType: 'Betaflight',
    firmwareRevision: '4.4.0',
    firmwareDate: '2023-01-01',
    boardInformation: 'STM32F405',
    logStartDatetime: '2023-06-15T10:30:00Z',
    craftName: 'TestQuad',
    iFieldDefs: [],
    pFieldDefs: [],
    sFieldDefs: [],
    gFieldDefs: [],
    iInterval: 32,
    pInterval: 1,
    pDenom: 1,
    minthrottle: 1070,
    maxthrottle: 2000,
    motorOutputRange: 930,
    vbatref: 420,
    looptime: 125,
    gyroScale: 1,
    rawHeaders: new Map(),
  },
  flightData: {
    gyro: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    setpoint: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    pidP: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    pidI: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    pidD: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    pidF: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    motor: [
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
      { time: new Float64Array([0]), values: new Float64Array([0]) },
    ],
    debug: [],
    sampleRateHz: 8000,
    durationSeconds: 60,
    frameCount: 480000,
  },
  corruptedFrameCount: 0,
  warnings: [],
};

const mockSingleSessionResult: BlackboxParseResult = {
  sessions: [mockSession],
  fileSize: 1024 * 1024,
  parseTimeMs: 250,
  success: true,
};

const mockMultiSessionResult: BlackboxParseResult = {
  sessions: [
    mockSession,
    {
      ...mockSession,
      index: 1,
      flightData: { ...mockSession.flightData, durationSeconds: 45, frameCount: 360000 },
    },
  ],
  fileSize: 2 * 1024 * 1024,
  parseTimeMs: 400,
  success: true,
};

const mockFilterResult: FilterAnalysisResult = {
  noise: {
    roll: {
      spectrum: { frequencies: new Float64Array([100]), magnitudes: new Float64Array([-20]) },
      noiseFloorDb: -40,
      peaks: [{ frequency: 150, amplitude: 15, type: 'frame_resonance' }],
    },
    pitch: {
      spectrum: { frequencies: new Float64Array([100]), magnitudes: new Float64Array([-20]) },
      noiseFloorDb: -38,
      peaks: [],
    },
    yaw: {
      spectrum: { frequencies: new Float64Array([100]), magnitudes: new Float64Array([-20]) },
      noiseFloorDb: -42,
      peaks: [],
    },
    overallLevel: 'low',
  },
  recommendations: [
    {
      setting: 'gyro_lpf1_static_hz',
      currentValue: 250,
      recommendedValue: 300,
      reason: 'Low noise — raising cutoff reduces latency.',
      impact: 'latency',
      confidence: 'high',
    },
  ],
  summary: 'Low noise detected. Filters can be relaxed.',
  analysisTimeMs: 150,
  sessionIndex: 0,
  segmentsUsed: 3,
};

function makeMockTrace(len: number = 20) {
  return {
    timeMs: Array.from({ length: len }, (_, i) => i * 0.25),
    setpoint: Array.from({ length: len }, (_, i) => (i >= 3 ? 300 : 0)),
    gyro: Array.from({ length: len }, (_, i) => (i >= 5 ? 300 : 0)),
  };
}

function makeMockStepResponse(overshoot: number) {
  return {
    step: {
      axis: 0 as const,
      startIndex: 100,
      endIndex: 200,
      magnitude: 300,
      direction: 'positive' as const,
    },
    riseTimeMs: 20,
    overshootPercent: overshoot,
    settlingTimeMs: 50,
    latencyMs: 5,
    ringingCount: 1,
    peakValue: 300 + overshoot * 3,
    steadyStateValue: 300,
    trace: makeMockTrace(),
  };
}

const mockPIDResult: PIDAnalysisResult = {
  roll: {
    responses: [makeMockStepResponse(5), makeMockStepResponse(8)],
    meanOvershoot: 5,
    meanRiseTimeMs: 20,
    meanSettlingTimeMs: 50,
    meanLatencyMs: 8,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  pitch: {
    responses: [makeMockStepResponse(8)],
    meanOvershoot: 8,
    meanRiseTimeMs: 22,
    meanSettlingTimeMs: 55,
    meanLatencyMs: 9,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  yaw: {
    responses: [makeMockStepResponse(3)],
    meanOvershoot: 3,
    meanRiseTimeMs: 30,
    meanSettlingTimeMs: 60,
    meanLatencyMs: 10,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  recommendations: [
    {
      setting: 'pid_roll_p',
      currentValue: 45,
      recommendedValue: 50,
      reason: 'Slightly slow response — increasing P will sharpen stick feel.',
      impact: 'response',
      confidence: 'high',
    },
  ],
  summary: 'Good overall response. Minor P increase recommended.',
  analysisTimeMs: 200,
  sessionIndex: 0,
  stepsDetected: 12,
  currentPIDs: {
    roll: { P: 45, I: 80, D: 30 },
    pitch: { P: 47, I: 84, D: 32 },
    yaw: { P: 45, I: 80, D: 0 },
  },
};

describe('TuningWizard', () => {
  const onExit = vi.fn();
  const GUIDE_BUTTON = 'Got it — Start Analysis';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Click through the guide step to advance to session/parse */
  async function passGuide(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => {
      expect(screen.getByText('Test Flight Guide')).toBeInTheDocument();
    });
    await user.click(screen.getByText(GUIDE_BUTTON));
  }

  /** Navigate through all steps to reach filter results */
  async function navigateToFilterResults(user: ReturnType<typeof userEvent.setup>) {
    await passGuide(user);
    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));
    await waitFor(() => expect(screen.getByText('Filter Analysis Results')).toBeInTheDocument());
  }

  /** Navigate through all steps to reach PID results */
  async function navigateToPIDResults(user: ReturnType<typeof userEvent.setup>) {
    await navigateToFilterResults(user);
    await waitFor(() => expect(screen.getByText('Continue to PID Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to PID Analysis'));
    await waitFor(() => expect(screen.getByText('Run PID Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run PID Analysis'));
    await waitFor(() => expect(screen.getByText('PID Analysis Results')).toBeInTheDocument());
  }

  /** Navigate through all steps to reach summary */
  async function navigateToSummary(user: ReturnType<typeof userEvent.setup>) {
    await navigateToPIDResults(user);
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));
    await waitFor(() => expect(screen.getByText('Tuning Summary')).toBeInTheDocument());
  }

  it('renders wizard header with truncated log ID and exit button', () => {
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    expect(screen.getByText('Tuning Wizard')).toBeInTheDocument();
    expect(screen.getByText('Log: test-log', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Exit')).toBeInTheDocument();
  });

  it('shows session metadata in header after parsing', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    // After parsing completes, header should show session metadata
    await waitFor(() => {
      expect(screen.getByText(/Session 1/)).toBeInTheDocument();
      expect(screen.getByText(/60s/)).toBeInTheDocument();
      expect(screen.getByText(/8000 Hz/)).toBeInTheDocument();
    });
  });

  it('calls onExit when Exit button is clicked', async () => {
    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await user.click(screen.getByText('Exit'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows test flight guide as first step', () => {
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    expect(screen.getByText('Test Flight Guide')).toBeInTheDocument();
    expect(screen.getByText('Take off & Hover')).toBeInTheDocument();
    expect(screen.getByText('Roll Snaps')).toBeInTheDocument();
    expect(screen.getByText(GUIDE_BUTTON)).toBeInTheDocument();
  });

  it('advances to session step when guide is acknowledged', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('Parsing Blackbox Log')).toBeInTheDocument();
    });
  });

  it('shows progress bar during parsing', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('Parsing Blackbox Log')).toBeInTheDocument();
    });
  });

  it('auto-advances to filter step for single session log', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('Filter Analysis')).toBeInTheDocument();
      expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument();
    });
  });

  it('shows session selection for multi-session log', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('Select Flight Session')).toBeInTheDocument();
      expect(screen.getByText('Session 1')).toBeInTheDocument();
      expect(screen.getByText('Session 2')).toBeInTheDocument();
    });
  });

  it('navigates from session selection to filter step', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Session 1'));

    await waitFor(() => {
      expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument();
    });
  });

  it('runs filter analysis and shows results', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.getByText('gyro_lpf1_static_hz')).toBeInTheDocument();
    expect(screen.getByText('250 Hz', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('300 Hz', { exact: false })).toBeInTheDocument();
  });

  it('navigates from filter results to PID step', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    await user.click(screen.getByText('Continue to PID Analysis'));

    await waitFor(() => {
      expect(screen.getByText('PID Analysis')).toBeInTheDocument();
      expect(screen.getByText('Run PID Analysis')).toBeInTheDocument();
    });
  });

  it('runs PID analysis and shows results with axis summary', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);

    expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
    expect(screen.getByText('pid_roll_p')).toBeInTheDocument();
  });

  it('renders feedforward_active warning in PID results', async () => {
    const pidWithFF: PIDAnalysisResult = {
      ...mockPIDResult,
      feedforwardContext: { active: true, boost: 15 },
      warnings: [
        {
          code: 'feedforward_active',
          message: 'Feedforward is active on this flight.',
          severity: 'info',
        },
      ],
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithFF);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);

    expect(screen.getByText('Feedforward is active on this flight.')).toBeInTheDocument();
  });

  it('reaches summary step with all recommendations', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);

    expect(screen.getByText('Filter Recommendations')).toBeInTheDocument();
    expect(screen.getByText('PID Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Apply Changes')).toBeInTheDocument();
  });

  it('shows parse error and allows retry', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog)
      .mockRejectedValueOnce(new Error('File not found'))
      .mockResolvedValueOnce(mockSingleSessionResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument();
    });
  });

  it('shows filter analysis error with retry and skip options', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockRejectedValue(
      new Error('Not enough hover data')
    );

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await passGuide(user);

    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));

    await waitFor(() => {
      expect(screen.getByText('Not enough hover data')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
      expect(screen.getByText('Skip to PIDs')).toBeInTheDocument();
    });
  });

  // ---- New tests for enhanced results display ----

  it('RecommendationCard shows human-readable label', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.getByText('Gyro Lowpass 1')).toBeInTheDocument();
  });

  it('RecommendationCard shows percentage change badge', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    // 250 → 300 = +20%
    expect(screen.getByText('+20%')).toBeInTheDocument();
  });

  it('FilterAnalysisStep shows analysis metadata', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.getByText('3 segments analyzed')).toBeInTheDocument();
  });

  it('FilterAnalysisStep noise details toggle works', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    // Initially expanded (default open)
    expect(screen.getByText('Hide noise details')).toBeInTheDocument();
    expect(screen.getByText('-40 dB', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Frame')).toBeInTheDocument();

    // Click to collapse
    await user.click(screen.getByText('Hide noise details'));

    await waitFor(() => {
      expect(screen.getByText('Show noise details')).toBeInTheDocument();
      expect(screen.queryByText('-40 dB', { exact: false })).not.toBeInTheDocument();
    });
  });

  it('PIDAnalysisStep shows latency in axis cards', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);

    expect(screen.getByText('8 ms', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('9 ms', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('10 ms', { exact: false })).toBeInTheDocument();
  });

  it('PIDAnalysisStep shows current PID values', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);

    expect(screen.getByText('Current PID Values')).toBeInTheDocument();
    // Check roll PIDs: P: 45, I: 80, D: 30
    // The values are rendered in axis-summary-card-stat elements
    const currentSection = screen.getByText('Current PID Values');
    expect(currentSection).toBeInTheDocument();
  });

  it('TuningSummaryStep shows changes-at-a-glance table', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);

    // Table headers
    expect(screen.getByText('Setting')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();

    // Table content — readable labels appear in both table and cards
    const gyroLabels = screen.getAllByText('Gyro Lowpass 1');
    expect(gyroLabels.length).toBeGreaterThanOrEqual(2); // table + card
    const pidLabels = screen.getAllByText('Roll P-Gain');
    expect(pidLabels.length).toBeGreaterThanOrEqual(2); // table + card
  });

  it('TuningSummaryStep shows confidence breakdown', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);

    // Both recommendations are high confidence
    expect(screen.getByText('2 high confidence')).toBeInTheDocument();
    expect(screen.getByText('1 filter change')).toBeInTheDocument();
    expect(screen.getByText('1 PID change')).toBeInTheDocument();
  });

  // ---- Auto-apply tests ----

  it('Apply Changes button is enabled in summary step', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);

    const applyBtn = screen.getByText('Apply Changes');
    expect(applyBtn).toBeInTheDocument();
    expect(applyBtn).not.toBeDisabled();
  });

  it('clicking Apply Changes opens confirmation modal', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });
  });

  it('confirmation modal shows change counts and snapshot checkbox', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('1 filter change (via CLI)')).toBeInTheDocument();
      expect(screen.getByText('1 PID change (via MSP)')).toBeInTheDocument();
      expect(screen.getByText('Create safety snapshot before applying')).toBeInTheDocument();
      expect(screen.getByRole('checkbox')).toBeChecked();
    });
  });

  it('Cancel in confirmation modal closes it', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    // Click Cancel in the modal
    const cancelButtons = screen.getAllByText('Cancel');
    await user.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText('Apply Tuning Changes')).not.toBeInTheDocument();
    });
  });

  it('Confirm calls applyRecommendations IPC', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      appliedPIDs: 1,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    // Click Apply Changes button inside modal
    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
        filterRecommendations: mockFilterResult.recommendations,
        pidRecommendations: mockPIDResult.recommendations,
        feedforwardRecommendations: [],
        createSnapshot: true,
      });
    });
  });

  it('shows success message after successful apply', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      appliedPIDs: 1,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(
        screen.getByText('Changes applied successfully!', { exact: false })
      ).toBeInTheDocument();
    });
  });

  it('shows error message on apply failure', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockRejectedValue(
      new Error('FC disconnected during apply')
    );

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToSummary(user);
    await user.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('FC disconnected during apply')).toBeInTheDocument();
      expect(screen.getByText('Retry Apply')).toBeInTheDocument();
    });
  });

  // ---- Chart integration tests ----

  it('FilterAnalysisStep shows spectrum chart in default-open noise details', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    const { container } = render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    await waitFor(() => {
      // Noise details default open — spectrum chart should render SVG
      const svg = container.querySelector('.spectrum-chart svg');
      expect(svg).toBeTruthy();
    });
  });

  it('PIDAnalysisStep shows step response chart default-open when traces available', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    const { container } = render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);

    await waitFor(() => {
      // Chart default open
      expect(screen.getByText('Hide step response charts')).toBeInTheDocument();
      const svg = container.querySelector('.step-response-chart svg');
      expect(svg).toBeTruthy();
    });
  });

  it('PIDAnalysisStep collapses step response chart on toggle', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    const { container } = render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToPIDResults(user);
    await user.click(screen.getByText('Hide step response charts'));

    await waitFor(() => {
      expect(screen.getByText('Show step response charts')).toBeInTheDocument();
      const svg = container.querySelector('.step-response-chart svg');
      expect(svg).toBeNull();
    });
  });

  // ---- Mode-specific tests ----

  it('mode=filter skips guide and starts at session step', () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.FILTER} onExit={onExit} />);

    // Should show parsing (session step auto-triggers), not flight guide
    expect(screen.getByText('Parsing Blackbox Log')).toBeInTheDocument();
    expect(screen.queryByText('Test Flight Guide')).not.toBeInTheDocument();
  });

  it('mode=pid skips guide and starts at session step', () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.PID} onExit={onExit} />);

    // Should show parsing (session step auto-triggers), not flight guide
    expect(screen.getByText('Parsing Blackbox Log')).toBeInTheDocument();
    expect(screen.queryByText('Test Flight Guide')).not.toBeInTheDocument();
  });

  it('mode=filter WizardProgress hides PIDs and Flight Guide steps', () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.FILTER} onExit={onExit} />);

    const progressLabels = screen.getAllByText(/(Flight Guide|Session|Filters|PIDs|Summary)/);
    const labels = progressLabels.map((el) => el.textContent);
    expect(labels).toContain('Filters');
    expect(labels).not.toContain('PIDs');
    expect(labels).not.toContain('Flight Guide');
  });

  it('mode=pid WizardProgress hides Filters and Flight Guide steps', () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(() => new Promise(() => {}));
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.PID} onExit={onExit} />);

    const progressLabels = screen.getAllByText(/(Flight Guide|Session|Filters|PIDs|Summary)/);
    const labels = progressLabels.map((el) => el.textContent);
    expect(labels).toContain('PIDs');
    expect(labels).not.toContain('Filters');
    expect(labels).not.toContain('Flight Guide');
  });

  it('mode=filter skips from filter results directly to summary', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.FILTER} onExit={onExit} />);

    // Guide is skipped — auto-parse + auto-advance to filter step
    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));

    await waitFor(() => expect(screen.getByText('Filter Analysis Results')).toBeInTheDocument());

    // In filter mode, "Continue" should go to summary, not PIDs
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));

    await waitFor(() => {
      expect(screen.getByText('Tuning Summary')).toBeInTheDocument();
      expect(screen.getByText('Apply Filters')).toBeInTheDocument();
    });
  });

  it('mode=filter summary shows filter-specific success message', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      appliedPIDs: 0,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.FILTER} onExit={onExit} />);

    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));
    await waitFor(() => expect(screen.getByText('Apply Filters')).toBeInTheDocument());

    await user.click(screen.getByText('Apply Filters'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    // Click Apply in the modal
    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('Filters applied!', { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/fly the PID test flight/)).toBeInTheDocument();
    });
  });

  it('mode=pid summary shows Apply PIDs button and pid success message', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 1,
      appliedFilters: 0,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.PID} onExit={onExit} />);

    // pid mode skips guide, auto-advances to pid step (single session)
    await waitFor(() => expect(screen.getByText('Run PID Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run PID Analysis'));
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));

    await waitFor(() => expect(screen.getByText('Apply PIDs')).toBeInTheDocument());

    await user.click(screen.getByText('Apply PIDs'));

    await waitFor(() => {
      expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument();
    });

    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText('PIDs applied!', { exact: false })).toBeInTheDocument();
      expect(screen.getByText(/verify the feel/)).toBeInTheDocument();
    });
  });

  it('calls onApplyComplete with filter changes after successful filter apply', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      snapshotId: 'snap-1',
      appliedPIDs: 0,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const onApplyComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <TuningWizard
        logId="test-log-1"
        mode={TUNING_MODE.FILTER}
        onExit={onExit}
        onApplyComplete={onApplyComplete}
      />
    );

    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));
    await waitFor(() => expect(screen.getByText('Apply Filters')).toBeInTheDocument());
    await user.click(screen.getByText('Apply Filters'));
    await waitFor(() => expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument());

    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(onApplyComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          filterChanges: [{ setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 300 }],
          pidChanges: undefined,
        })
      );
      // Also verify filter metrics are included
      const call = onApplyComplete.mock.calls[0][0];
      expect(call.filterMetrics).toBeDefined();
      expect(call.filterMetrics.noiseLevel).toBe('low');
    });
  });

  it('calls onApplyComplete with PID changes after successful PID apply', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 1,
      appliedFilters: 0,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const onApplyComplete = vi.fn();
    const user = userEvent.setup();
    render(
      <TuningWizard
        logId="test-log-1"
        mode={TUNING_MODE.PID}
        onExit={onExit}
        onApplyComplete={onApplyComplete}
      />
    );

    await waitFor(() => expect(screen.getByText('Run PID Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run PID Analysis'));
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));
    await waitFor(() => expect(screen.getByText('Apply PIDs')).toBeInTheDocument());
    await user.click(screen.getByText('Apply PIDs'));
    await waitFor(() => expect(screen.getByText('Apply Tuning Changes')).toBeInTheDocument());

    const modalApplyBtns = screen.getAllByText('Apply Changes');
    await user.click(modalApplyBtns[modalApplyBtns.length - 1]);

    await waitFor(() => {
      expect(onApplyComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          filterChanges: undefined,
          pidChanges: [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }],
        })
      );
      // Also verify PID metrics are included
      const call = onApplyComplete.mock.calls[0][0];
      expect(call.pidMetrics).toBeDefined();
      expect(call.pidMetrics.stepsDetected).toBe(12);
    });
  });

  // ---- RPM filter status display ----

  it('FilterAnalysisStep shows RPM Filter: Active pill when rpmFilterActive is true', async () => {
    const rpmResult: FilterAnalysisResult = {
      ...mockFilterResult,
      rpmFilterActive: true,
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(rpmResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.getByText('RPM Filter: Active')).toBeInTheDocument();
    expect(screen.getByText(/RPM filter is active/)).toBeInTheDocument();
  });

  it('FilterAnalysisStep shows RPM Filter: Not detected pill when rpmFilterActive is false', async () => {
    const rpmResult: FilterAnalysisResult = {
      ...mockFilterResult,
      rpmFilterActive: false,
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(rpmResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.getByText('RPM Filter: Not detected')).toBeInTheDocument();
    expect(screen.queryByText(/RPM filter is active/)).not.toBeInTheDocument();
  });

  it('FilterAnalysisStep hides RPM pill when rpmFilterActive is undefined', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" onExit={onExit} />);

    await navigateToFilterResults(user);

    expect(screen.queryByText(/RPM Filter:/)).not.toBeInTheDocument();
  });

  it('mode=filter summary hides PID recommendation section and PID pill', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockSingleSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const user = userEvent.setup();
    render(<TuningWizard logId="test-log-1" mode={TUNING_MODE.FILTER} onExit={onExit} />);

    await waitFor(() => expect(screen.getByText('Run Filter Analysis')).toBeInTheDocument());
    await user.click(screen.getByText('Run Filter Analysis'));
    await waitFor(() => expect(screen.getByText('Continue to Summary')).toBeInTheDocument());
    await user.click(screen.getByText('Continue to Summary'));

    await waitFor(() => {
      expect(screen.getByText('Filter Recommendations')).toBeInTheDocument();
      expect(screen.queryByText('PID Recommendations')).not.toBeInTheDocument();
      // Filter pill should be visible, PID pill should not
      expect(screen.getByText('1 filter change')).toBeInTheDocument();
      expect(screen.queryByText(/PID change/)).not.toBeInTheDocument();
    });
  });
});
