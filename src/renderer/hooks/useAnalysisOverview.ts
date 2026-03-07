import { useState, useCallback, useEffect } from 'react';
import type { BlackboxLogSession, BlackboxParseProgress } from '@shared/types/blackbox.types';
import type {
  FilterAnalysisResult,
  PIDAnalysisResult,
  AnalysisProgress,
} from '@shared/types/analysis.types';

export interface UseAnalysisOverviewReturn {
  logId: string;
  sessionIndex: number;
  sessionSelected: boolean;
  setSessionIndex: (idx: number) => void;
  resetToSessionPicker: () => void;
  sessions: BlackboxLogSession[] | null;

  // Parse
  parsing: boolean;
  parseProgress: BlackboxParseProgress | null;
  parseError: string | null;
  retryParse: () => void;

  // Filter analysis
  filterResult: FilterAnalysisResult | null;
  filterAnalyzing: boolean;
  filterProgress: AnalysisProgress | null;
  filterError: string | null;
  retryFilterAnalysis: () => void;

  // PID analysis
  pidResult: PIDAnalysisResult | null;
  pidAnalyzing: boolean;
  pidProgress: AnalysisProgress | null;
  pidError: string | null;
  retryPIDAnalysis: () => void;

  // Transfer function (Wiener) analysis
  tfResult: PIDAnalysisResult | null;
  tfAnalyzing: boolean;
  tfError: string | null;
}

export function useAnalysisOverview(logId: string): UseAnalysisOverviewReturn {
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionSelected, setSessionSelected] = useState(false);
  const [sessions, setSessions] = useState<BlackboxLogSession[] | null>(null);

  // Parse state
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<BlackboxParseProgress | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Filter analysis state
  const [filterResult, setFilterResult] = useState<FilterAnalysisResult | null>(null);
  const [filterAnalyzing, setFilterAnalyzing] = useState(false);
  const [filterProgress, setFilterProgress] = useState<AnalysisProgress | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  // PID analysis state
  const [pidResult, setPidResult] = useState<PIDAnalysisResult | null>(null);
  const [pidAnalyzing, setPidAnalyzing] = useState(false);
  const [pidProgress, setPidProgress] = useState<AnalysisProgress | null>(null);
  const [pidError, setPidError] = useState<string | null>(null);

  // Transfer function (Wiener) analysis state
  const [tfResult, setTfResult] = useState<PIDAnalysisResult | null>(null);
  const [tfAnalyzing, setTfAnalyzing] = useState(false);
  const [tfError, setTfError] = useState<string | null>(null);

  const runFilterAnalysis = useCallback(
    async (idx: number) => {
      setFilterAnalyzing(true);
      setFilterProgress(null);
      setFilterError(null);

      try {
        const result = await window.betaflight.analyzeFilters(logId, idx, undefined, (progress) => {
          setFilterProgress(progress);
        });
        setFilterResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to analyze filters';
        setFilterError(message);
      } finally {
        setFilterAnalyzing(false);
      }
    },
    [logId]
  );

  const runPIDAnalysis = useCallback(
    async (idx: number) => {
      setPidAnalyzing(true);
      setPidProgress(null);
      setPidError(null);

      try {
        const result = await window.betaflight.analyzePID(logId, idx, undefined, (progress) => {
          setPidProgress(progress);
        });
        setPidResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to analyze PIDs';
        setPidError(message);
      } finally {
        setPidAnalyzing(false);
      }
    },
    [logId]
  );

  const runTFAnalysis = useCallback(
    async (idx: number) => {
      setTfAnalyzing(true);
      setTfError(null);

      try {
        const result = await window.betaflight.analyzeTransferFunction(logId, idx);
        setTfResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to analyze transfer function';
        setTfError(message);
      } finally {
        setTfAnalyzing(false);
      }
    },
    [logId]
  );

  const runBothAnalyses = useCallback(
    (idx: number) => {
      runFilterAnalysis(idx);
      runPIDAnalysis(idx);
      runTFAnalysis(idx);
    },
    [runFilterAnalysis, runPIDAnalysis, runTFAnalysis]
  );

  const parseLog = useCallback(async () => {
    setParsing(true);
    setParseProgress(null);
    setParseError(null);
    // Reset analysis state on re-parse
    setFilterResult(null);
    setFilterError(null);
    setPidResult(null);
    setPidError(null);
    setTfResult(null);
    setTfError(null);

    try {
      const result = await window.betaflight.parseBlackboxLog(logId, (progress) => {
        setParseProgress(progress);
      });

      if (!result.success || result.sessions.length === 0) {
        setParseError(result.error || 'No flight sessions found in log');
        return;
      }

      setSessions(result.sessions);

      // Auto-select and auto-analyze if single session
      if (result.sessions.length === 1) {
        setSessionIndex(0);
        setSessionSelected(true);
        runBothAnalyses(0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse log';
      setParseError(message);
    } finally {
      setParsing(false);
    }
  }, [logId, runBothAnalyses]);

  // Handle session selection for multi-session logs
  const selectSession = useCallback(
    (idx: number) => {
      setSessionIndex(idx);
      setSessionSelected(true);
      // Reset previous analysis results
      setFilterResult(null);
      setFilterError(null);
      setPidResult(null);
      setPidError(null);
      setTfResult(null);
      setTfError(null);
      runBothAnalyses(idx);
    },
    [runBothAnalyses]
  );

  const resetToSessionPicker = useCallback(() => {
    setSessionSelected(false);
    setFilterResult(null);
    setFilterError(null);
    setPidResult(null);
    setPidError(null);
    setTfResult(null);
    setTfError(null);
  }, []);

  // Auto-parse on mount
  useEffect(() => {
    parseLog();
  }, []);

  const retryParse = useCallback(() => {
    parseLog();
  }, [parseLog]);

  const retryFilterAnalysis = useCallback(() => {
    runFilterAnalysis(sessionIndex);
  }, [runFilterAnalysis, sessionIndex]);

  const retryPIDAnalysis = useCallback(() => {
    runPIDAnalysis(sessionIndex);
  }, [runPIDAnalysis, sessionIndex]);

  return {
    logId,
    sessionIndex,
    sessionSelected,
    setSessionIndex: selectSession,
    resetToSessionPicker,
    sessions,
    parsing,
    parseProgress,
    parseError,
    retryParse,
    filterResult,
    filterAnalyzing,
    filterProgress,
    filterError,
    retryFilterAnalysis,
    pidResult,
    pidAnalyzing,
    pidProgress,
    pidError,
    retryPIDAnalysis,
    tfResult,
    tfAnalyzing,
    tfError,
  };
}
