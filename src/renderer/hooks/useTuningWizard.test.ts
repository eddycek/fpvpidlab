import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTuningWizard } from './useTuningWizard';
import type { BlackboxParseResult, BlackboxLogSession } from '@shared/types/blackbox.types';
import type { FilterAnalysisResult, PIDAnalysisResult } from '@shared/types/analysis.types';

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
  sessions: [mockSession, { ...mockSession, index: 1 }],
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

describe('useTuningWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with guide step and default state', () => {
    const { result } = renderHook(() => useTuningWizard('log-1'));

    expect(result.current.step).toBe('guide');
    expect(result.current.logId).toBe('log-1');
    expect(result.current.sessionIndex).toBe(0);
    expect(result.current.sessions).toBeNull();
    expect(result.current.parsing).toBe(false);
    expect(result.current.filterResult).toBeNull();
    expect(result.current.pidResult).toBeNull();
  });

  it('parses log and auto-advances for single session', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(window.betaflight.parseBlackboxLog).toHaveBeenCalledWith('log-1', expect.any(Function));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.step).toBe('filter'); // auto-advanced
    expect(result.current.sessionIndex).toBe(0);
  });

  it('parses log and stays on session step for multiple sessions', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockMultiSessionResult);

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.step).toBe('guide'); // stays — not auto-advanced
  });

  it('handles parse error', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockRejectedValue(new Error('Corrupt log file'));

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(result.current.parseError).toBe('Corrupt log file');
    expect(result.current.parsing).toBe(false);
    expect(result.current.sessions).toBeNull();
  });

  it('handles parse result with no sessions', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue({
      sessions: [],
      fileSize: 100,
      parseTimeMs: 10,
      success: false,
      error: 'No valid sessions',
    });

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(result.current.parseError).toBe('No valid sessions');
    expect(result.current.sessions).toBeNull();
  });

  it('runs filter analysis and stores result', async () => {
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });

    expect(window.betaflight.analyzeFilters).toHaveBeenCalledWith(
      'log-1',
      0,
      undefined,
      expect.any(Function)
    );
    expect(result.current.filterResult).toEqual(mockFilterResult);
    expect(result.current.filterAnalyzing).toBe(false);
  });

  it('handles filter analysis error', async () => {
    vi.mocked(window.betaflight.analyzeFilters).mockRejectedValue(
      new Error('Not enough hover data')
    );

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });

    expect(result.current.filterError).toBe('Not enough hover data');
    expect(result.current.filterResult).toBeNull();
  });

  it('runs PID analysis and stores result', async () => {
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.runPIDAnalysis();
    });

    expect(window.betaflight.analyzePID).toHaveBeenCalledWith(
      'log-1',
      0,
      undefined,
      expect.any(Function)
    );
    expect(result.current.pidResult).toEqual(mockPIDResult);
    expect(result.current.pidAnalyzing).toBe(false);
  });

  it('handles PID analysis error', async () => {
    vi.mocked(window.betaflight.analyzePID).mockRejectedValue(new Error('No step inputs found'));

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.runPIDAnalysis();
    });

    expect(result.current.pidError).toBe('No step inputs found');
    expect(result.current.pidResult).toBeNull();
  });

  it('allows step and sessionIndex changes', () => {
    const { result } = renderHook(() => useTuningWizard('log-1'));

    act(() => {
      result.current.setStep('filter');
    });
    expect(result.current.step).toBe('filter');

    act(() => {
      result.current.selectSession(2);
    });
    expect(result.current.sessionIndex).toBe(2);
    expect(result.current.sessionSelected).toBe(true);
  });

  it('sets parsing to true during parse', async () => {
    let resolvePromise: (value: any) => void;
    vi.mocked(window.betaflight.parseBlackboxLog).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    const { result } = renderHook(() => useTuningWizard('log-1'));

    act(() => {
      result.current.parseLog();
    });

    await waitFor(() => {
      expect(result.current.parsing).toBe(true);
    });

    await act(async () => {
      resolvePromise!(mockParseResult);
    });

    expect(result.current.parsing).toBe(false);
  });

  // ---- Apply recommendation tests ----

  it('startApply skips to applying when no recommendations', () => {
    const { result } = renderHook(() => useTuningWizard('log-1'));

    expect(result.current.applyState).toBe('idle');

    act(() => {
      result.current.startApply();
    });

    // No filter/PID results → 0 recommendations → skips confirming, goes to applying
    expect(result.current.applyState).toBe('applying');
  });

  it('cancelApply resets state to idle', () => {
    const { result } = renderHook(() => useTuningWizard('log-1'));

    // Manually set confirming state (would normally come from startApply with recommendations)
    act(() => {
      // Trigger apply which goes to 'applying' (0 recs), then we test cancel from that
      result.current.startApply();
    });

    act(() => {
      result.current.cancelApply();
    });
    expect(result.current.applyState).toBe('idle');
  });

  it('confirmApply calls IPC with correct params', async () => {
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

    const { result } = renderHook(() => useTuningWizard('log-1'));

    // Run analyses to populate results
    await act(async () => {
      await result.current.runFilterAnalysis();
    });
    await act(async () => {
      await result.current.runPIDAnalysis();
    });

    await act(async () => {
      await result.current.confirmApply(true);
    });

    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: mockFilterResult.recommendations,
      pidRecommendations: mockPIDResult.recommendations,
      feedforwardRecommendations: [],
      createSnapshot: true,
    });
    expect(result.current.applyState).toBe('done');
    expect(result.current.applyResult?.success).toBe(true);
  });

  it('confirmApply sets error state on failure', async () => {
    vi.mocked(window.betaflight.applyRecommendations).mockRejectedValue(
      new Error('Connection lost')
    );

    const { result } = renderHook(() => useTuningWizard('log-1'));

    await act(async () => {
      await result.current.confirmApply(false);
    });

    expect(result.current.applyState).toBe('error');
    expect(result.current.applyError).toBe('Connection lost');
    expect(result.current.applyResult).toBeNull();
  });

  // ---- Mode-specific tests ----

  it('exposes mode from parameter', () => {
    const { result } = renderHook(() => useTuningWizard('log-1', 'filter'));
    expect(result.current.mode).toBe('filter');
  });

  it('defaults mode to full', () => {
    const { result } = renderHook(() => useTuningWizard('log-1'));
    expect(result.current.mode).toBe('full');
  });

  it('mode=pid auto-advances to pid step for single session', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);

    const { result } = renderHook(() => useTuningWizard('log-1', 'pid'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(result.current.step).toBe('pid');
  });

  it('mode=filter auto-advances to filter step for single session', async () => {
    vi.mocked(window.betaflight.parseBlackboxLog).mockResolvedValue(mockParseResult);

    const { result } = renderHook(() => useTuningWizard('log-1', 'filter'));

    await act(async () => {
      await result.current.parseLog();
    });

    expect(result.current.step).toBe('filter');
  });

  it('mode=filter confirmApply sends empty pidRecommendations', async () => {
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 0,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const { result } = renderHook(() => useTuningWizard('log-1', 'filter'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });
    await act(async () => {
      await result.current.runPIDAnalysis();
    });
    await act(async () => {
      await result.current.confirmApply(false);
    });

    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: mockFilterResult.recommendations,
      pidRecommendations: [],
      feedforwardRecommendations: [],
      createSnapshot: false,
    });
  });

  it('mode=pid confirmApply sends empty filterRecommendations', async () => {
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 1,
      appliedFilters: 0,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const { result } = renderHook(() => useTuningWizard('log-1', 'pid'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });
    await act(async () => {
      await result.current.runPIDAnalysis();
    });
    await act(async () => {
      await result.current.confirmApply(true);
    });

    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: [],
      pidRecommendations: mockPIDResult.recommendations,
      feedforwardRecommendations: [],
      createSnapshot: true,
    });
  });

  it('mode=pid splits PID and feedforward recommendations', async () => {
    const pidWithFF: PIDAnalysisResult = {
      ...mockPIDResult,
      recommendations: [
        ...mockPIDResult.recommendations,
        {
          setting: 'feedforward_boost',
          currentValue: 15,
          recommendedValue: 10,
          reason: 'Lower FF boost',
          impact: 'response',
          confidence: 'medium',
        },
      ],
    };
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(pidWithFF);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 1,
      appliedFilters: 0,
      appliedFeedforward: 1,
      rebooted: true,
    });

    const { result } = renderHook(() => useTuningWizard('log-1', 'pid'));

    await act(async () => {
      await result.current.runPIDAnalysis();
    });
    await act(async () => {
      await result.current.confirmApply(false);
    });

    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: [],
      pidRecommendations: [mockPIDResult.recommendations[0]],
      feedforwardRecommendations: [pidWithFF.recommendations[1]],
      createSnapshot: false,
    });
  });

  it('confirmApply filters out diagnostic recommendations (currentValue === recommendedValue)', async () => {
    const filterWithDiagnostic: FilterAnalysisResult = {
      ...mockFilterResult,
      recommendations: [
        ...mockFilterResult.recommendations,
        {
          setting: 'rpm_filter_diagnostic',
          currentValue: 0,
          recommendedValue: 0,
          reason: 'Motor harmonic noise detected despite RPM filter.',
          impact: 'noise',
          confidence: 'medium',
        },
      ],
    };
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(filterWithDiagnostic);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 0,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const { result } = renderHook(() => useTuningWizard('log-1', 'filter'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });
    await act(async () => {
      await result.current.confirmApply(false);
    });

    // Diagnostic (0 → 0) should be filtered out, only real change sent
    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: mockFilterResult.recommendations,
      pidRecommendations: [],
      feedforwardRecommendations: [],
      createSnapshot: false,
    });
  });

  it('mode=full confirmApply sends both recommendations', async () => {
    vi.mocked(window.betaflight.analyzeFilters).mockResolvedValue(mockFilterResult);
    vi.mocked(window.betaflight.analyzePID).mockResolvedValue(mockPIDResult);
    vi.mocked(window.betaflight.applyRecommendations).mockResolvedValue({
      success: true,
      appliedPIDs: 1,
      appliedFilters: 1,
      appliedFeedforward: 0,
      rebooted: true,
    });

    const { result } = renderHook(() => useTuningWizard('log-1', 'full'));

    await act(async () => {
      await result.current.runFilterAnalysis();
    });
    await act(async () => {
      await result.current.runPIDAnalysis();
    });
    await act(async () => {
      await result.current.confirmApply(true);
    });

    expect(window.betaflight.applyRecommendations).toHaveBeenCalledWith({
      filterRecommendations: mockFilterResult.recommendations,
      pidRecommendations: mockPIDResult.recommendations,
      feedforwardRecommendations: [],
      createSnapshot: true,
    });
  });
});
