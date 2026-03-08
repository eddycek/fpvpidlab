import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisOverview } from './AnalysisOverview';
import type { BlackboxParseResult, BlackboxLogSession } from '@shared/types/blackbox.types';
import type { FilterAnalysisResult, PIDAnalysisResult } from '@shared/types/analysis.types';

// Mock recharts to avoid SVG rendering in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

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

const mockParseResult: BlackboxParseResult = {
  sessions: [mockSession],
  fileSize: 1024 * 1024,
  parseTimeMs: 250,
  success: true,
};

const mockMultiSessionResult: BlackboxParseResult = {
  sessions: [
    mockSession,
    { ...mockSession, index: 1, flightData: { ...mockSession.flightData, durationSeconds: 45 } },
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
      peaks: [],
    },
    pitch: {
      spectrum: { frequencies: new Float64Array([100]), magnitudes: new Float64Array([-20]) },
      noiseFloorDb: -40,
      peaks: [],
    },
    yaw: {
      spectrum: { frequencies: new Float64Array([100]), magnitudes: new Float64Array([-20]) },
      noiseFloorDb: -40,
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
  summary: 'Low noise detected. Filters can be relaxed for better response.',
  analysisTimeMs: 150,
  sessionIndex: 0,
  segmentsUsed: 3,
};

const mockPIDResult: PIDAnalysisResult = {
  roll: {
    responses: [],
    meanOvershoot: 5,
    meanRiseTimeMs: 20,
    meanSettlingTimeMs: 50,
    meanLatencyMs: 8,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  pitch: {
    responses: [],
    meanOvershoot: 8,
    meanRiseTimeMs: 22,
    meanSettlingTimeMs: 55,
    meanLatencyMs: 9,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  yaw: {
    responses: [],
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
  summary: 'Good overall response. Minor P increase recommended for roll.',
  analysisTimeMs: 200,
  sessionIndex: 0,
  stepsDetected: 12,
  currentPIDs: {
    roll: { P: 45, I: 80, D: 30 },
    pitch: { P: 47, I: 84, D: 32 },
    yaw: { P: 45, I: 80, D: 0 },
  },
};

describe('AnalysisOverview', () => {
  const onExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with log filename and Exit button', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    expect(screen.getByText('Analysis Overview')).toBeInTheDocument();
    expect(screen.getByText('blackbox_2026-02-11.bbl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
  });

  it('calls onExit when Exit button clicked', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('auto-starts parsing on mount', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(window.betaflight.parseBlackboxLog).toHaveBeenCalledWith(
        'log-1',
        expect.any(Function)
      );
    });
  });

  it('shows session picker for multi-session logs', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Select Flight Session')).toBeInTheDocument();
    });

    expect(screen.getByText(/This log contains 2 flight sessions/)).toBeInTheDocument();
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    expect(screen.getByText('Session 2')).toBeInTheDocument();
  });

  it('auto-runs both analyses after single-session parse', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(window.betaflight.analyzeFilters).toHaveBeenCalled();
      expect(window.betaflight.analyzePID).toHaveBeenCalled();
    });
  });

  it('shows filter results section with noise badge and summary', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.getByText(/3 segments analyzed/)).toBeInTheDocument();
  });

  it('shows PID results section with metrics', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
    });

    expect(screen.getByText('Current PID Values')).toBeInTheDocument();
    expect(screen.getByText('Step Response Metrics')).toBeInTheDocument();
  });

  it('does not render any Apply button', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue to/)).not.toBeInTheDocument();
  });

  it('does not show recommendations or observations (diagnostic view only)', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.queryByText('Observations')).not.toBeInTheDocument();
    expect(screen.queryByText(/No changes recommended/)).not.toBeInTheDocument();
  });

  it('shows parse error with retry button', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockRejectedValue(new Error('Corrupt log file'));

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Corrupt log file')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows filter error with retry button', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockRejectedValue(
      new Error('Not enough hover data')
    );
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Not enough hover data')).toBeInTheDocument();
    });

    // Retry button for filter section
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows PID error with retry button', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockRejectedValue(new Error('No step inputs found'));

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('No step inputs found')).toBeInTheDocument();
    });
  });

  it('always shows noise details without toggle in diagnostic view', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/Frequency spectrum/)).toBeInTheDocument();
    });

    // No toggle button in diagnostic view
    expect(screen.queryByText('Hide noise details')).not.toBeInTheDocument();
    expect(screen.queryByText('Show noise details')).not.toBeInTheDocument();
  });

  it('strips recommendation text from summaries', async () => {
    const filterWithRec: FilterAnalysisResult = {
      ...mockFilterResult,
      summary: 'Your noise levels are moderate. 4 filter changes recommended.',
    };
    const pidWithRec: PIDAnalysisResult = {
      ...mockPIDResult,
      summary: 'Analyzed 22 stick inputs. Your PID tune looks good. No changes recommended.',
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(filterWithRec);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithRec);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/Your noise levels are moderate\./)).toBeInTheDocument();
    });

    // Recommendation sentences should be stripped
    expect(screen.queryByText(/filter changes recommended/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No changes recommended/)).not.toBeInTheDocument();
  });

  it('selects session in multi-session log and triggers analyses', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Session 1'));

    await waitFor(() => {
      expect(window.betaflight.analyzeFilters).toHaveBeenCalled();
      expect(window.betaflight.analyzePID).toHaveBeenCalled();
    });
  });

  it('renders feedforward_active warning in PID section', async () => {
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
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithFF);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Feedforward is active on this flight.')).toBeInTheDocument();
    });
  });

  it('does not render PID warnings when none present', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/steps detected/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Feedforward is active/)).not.toBeInTheDocument();
  });

  it('shows RPM Filter: Active pill when rpmFilterActive is true', async () => {
    const rpmResult: FilterAnalysisResult = {
      ...mockFilterResult,
      rpmFilterActive: true,
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(rpmResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('RPM Filter: Active')).toBeInTheDocument();
    });

    expect(screen.getByText(/RPM filter is active/)).toBeInTheDocument();
  });

  it('shows RPM Filter: Not detected pill when rpmFilterActive is false', async () => {
    const rpmResult: FilterAnalysisResult = {
      ...mockFilterResult,
      rpmFilterActive: false,
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(rpmResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('RPM Filter: Not detected')).toBeInTheDocument();
    });

    expect(screen.queryByText(/RPM filter is active/)).not.toBeInTheDocument();
  });

  it('hides RPM pill when rpmFilterActive is undefined', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.queryByText(/RPM Filter:/)).not.toBeInTheDocument();
  });

  it('does not show flight style pill even when flightStyle present in PID result', async () => {
    const pidWithStyle: PIDAnalysisResult = {
      ...mockPIDResult,
      flightStyle: 'aggressive',
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithStyle);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Tuning for:/)).not.toBeInTheDocument();
  });

  it('shows axis summary cards for filter results', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    // Check roll/pitch/yaw axis cards are rendered (multiple via filter + PID sections)
    expect(screen.getAllByText('roll').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('pitch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('yaw').length).toBeGreaterThanOrEqual(1);
  });

  it('shows session breadcrumb with metadata after single-session analysis', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument();
    });

    // Session metadata line
    expect(screen.getByText(/60\.0s/)).toBeInTheDocument();
    expect(screen.getByText(/480,000 frames/)).toBeInTheDocument();
    expect(screen.getByText(/8000 Hz/)).toBeInTheDocument();
  });

  it('shows session breadcrumb after selecting session in multi-session log', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    // Session picker visible
    await waitFor(() => {
      expect(screen.getByText('Select Flight Session')).toBeInTheDocument();
    });

    // Select Session 1
    await user.click(screen.getByText('Session 1'));

    // Breadcrumb now shows session info
    await waitFor(() => {
      expect(screen.getByText(/Session 1/)).toBeInTheDocument();
    });

    // Session metadata visible
    await waitFor(() => {
      expect(screen.getByText(/60\.0s/)).toBeInTheDocument();
    });
  });

  it('clicking log name returns to session picker in multi-session log', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const user = userEvent.setup();
    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    // Session picker visible
    await waitFor(() => {
      expect(screen.getByText('Select Flight Session')).toBeInTheDocument();
    });

    // Select Session 1
    await user.click(screen.getByText('Session 1'));

    // Wait for analysis to complete
    await waitFor(() => {
      expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
    });

    // Log name is a clickable button in multi-session mode
    const logButton = screen.getByRole('button', { name: 'blackbox_2026-02-11.bbl' });
    expect(logButton).toBeInTheDocument();

    // Click to go back to session picker
    await user.click(logButton);

    await waitFor(() => {
      expect(screen.getByText('Select Flight Session')).toBeInTheDocument();
    });
  });

  it('shows filter data quality pill when dataQuality is present', async () => {
    const filterWithQuality: FilterAnalysisResult = {
      ...mockFilterResult,
      dataQuality: { overall: 72, tier: 'good', subScores: [] },
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(filterWithQuality);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/Data: good \(72\/100\)/)).toBeInTheDocument();
    });
  });

  it('shows PID data quality pill when dataQuality is present', async () => {
    const pidWithQuality: PIDAnalysisResult = {
      ...mockPIDResult,
      dataQuality: { overall: 45, tier: 'fair', subScores: [] },
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithQuality);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/Data: fair \(45\/100\)/)).toBeInTheDocument();
    });
  });

  it('does not show quality pill when dataQuality is absent', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Data:/)).not.toBeInTheDocument();
  });

  it('shows Frequency Response Analysis section when TF result available', async () => {
    const tfResult: PIDAnalysisResult & { transferFunction: any } = {
      ...mockPIDResult,
      stepsDetected: 0,
      analysisMethod: 'wiener_deconvolution' as const,
      transferFunction: {
        roll: {
          frequencies: new Float64Array([10, 20]),
          magnitude: new Float64Array([0, -3]),
          phase: new Float64Array([0, -45]),
        },
        pitch: {
          frequencies: new Float64Array([10, 20]),
          magnitude: new Float64Array([0, -3]),
          phase: new Float64Array([0, -45]),
        },
        yaw: {
          frequencies: new Float64Array([10, 20]),
          magnitude: new Float64Array([0, -3]),
          phase: new Float64Array([0, -45]),
        },
        syntheticStepResponse: {
          roll: { timeMs: [0, 10], response: [0, 1] },
          pitch: { timeMs: [0, 10], response: [0, 1] },
          yaw: { timeMs: [0, 10], response: [0, 1] },
        },
        metrics: {
          roll: {
            bandwidthHz: 55,
            gainMarginDb: 10,
            phaseMarginDeg: 50,
            overshootPercent: 8,
            settlingTimeMs: 60,
            riseTimeMs: 25,
          },
          pitch: {
            bandwidthHz: 52,
            gainMarginDb: 9,
            phaseMarginDeg: 48,
            overshootPercent: 10,
            settlingTimeMs: 65,
            riseTimeMs: 28,
          },
          yaw: {
            bandwidthHz: 35,
            gainMarginDb: 12,
            phaseMarginDeg: 55,
            overshootPercent: 5,
            settlingTimeMs: 70,
            riseTimeMs: 35,
          },
        },
      },
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.analyzeTransferFunction).mockResolvedValue(tfResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Frequency Response Analysis')).toBeInTheDocument();
    });

    expect(screen.getByText('Transfer Function Metrics')).toBeInTheDocument();
    expect(screen.getByText('Wiener deconvolution')).toBeInTheDocument();
  });

  it('does not show Frequency Response section when TF analysis fails', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.analyzeTransferFunction).mockRejectedValue(
      new Error('Not enough data')
    );

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
    });

    expect(screen.queryByText('Frequency Response Analysis')).not.toBeInTheDocument();
  });

  it('calls analyzeTransferFunction alongside other analyses', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.analyzeTransferFunction).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(window.betaflight.analyzeTransferFunction).toHaveBeenCalledWith('log-1', 0);
    });
  });

  it('shows wind disturbance pill when windDisturbance is present', async () => {
    const filterWithWind: FilterAnalysisResult = {
      ...mockFilterResult,
      windDisturbance: {
        axisVariance: [10, 8, 5],
        worstVariance: 10,
        level: 'calm',
        hoverDurationS: 5.0,
        hoverSampleCount: 20000,
        summary: 'Calm conditions detected (gyro variance 10 deg/s²). Tuning data is reliable.',
      },
    };
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(filterWithWind);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('Wind: calm')).toBeInTheDocument();
    });
  });

  it('does not show wind disturbance pill when windDisturbance is absent', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Wind:/)).not.toBeInTheDocument();
  });

  it('log name is not clickable for single-session logs', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    render(<AnalysisOverview logId="log-1" logName="blackbox_2026-02-11.bbl" onExit={onExit} />);

    await waitFor(() => {
      expect(screen.getByText('low')).toBeInTheDocument();
    });

    // Log name is a static span, not a button
    expect(
      screen.queryByRole('button', { name: 'blackbox_2026-02-11.bbl' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('blackbox_2026-02-11.bbl')).toBeInTheDocument();
  });
});
