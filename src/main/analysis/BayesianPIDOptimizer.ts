/**
 * Lightweight Bayesian PID optimizer using Gaussian Process surrogate.
 *
 * Given historical (PID gains -> quality score) observations,
 * suggests the next PID gains to try using Expected Improvement.
 *
 * This is a pure computation module — no IPC, no UI, no side effects.
 */

import {
  P_GAIN_MIN,
  P_GAIN_MAX,
  I_GAIN_MIN,
  I_GAIN_MAX,
  D_GAIN_MIN,
  D_GAIN_MAX,
} from './constants';

// ---- Public Types ----

export interface PIDObservation {
  /** PID gains [P, I, D] */
  gains: [number, number, number];
  /** Composite quality score (0-100, higher is better) */
  score: number;
}

export interface BayesianSuggestion {
  /** Suggested PID gains [P, I, D] */
  gains: [number, number, number];
  /** Expected improvement over current best */
  expectedImprovement: number;
  /** Confidence in the suggestion */
  confidence: 'high' | 'medium' | 'low';
}

export interface BayesianOptimizerConfig {
  /** Safety bounds for P gain */
  pBounds: [number, number];
  /** Safety bounds for I gain */
  iBounds: [number, number];
  /** Safety bounds for D gain */
  dBounds: [number, number];
  /** Exploration-exploitation trade-off (0-1, higher = more exploration) */
  explorationWeight?: number;
  /** Number of candidate points to evaluate */
  candidateCount?: number;
}

// ---- Defaults ----

const DEFAULT_CONFIG: BayesianOptimizerConfig = {
  pBounds: [P_GAIN_MIN, P_GAIN_MAX],
  iBounds: [I_GAIN_MIN, I_GAIN_MAX],
  dBounds: [D_GAIN_MIN, D_GAIN_MAX],
  explorationWeight: 0.1,
  candidateCount: 200,
};

// ---- Internal: RBF Kernel ----

/**
 * Radial Basis Function (squared exponential) kernel.
 * Returns similarity between two points in [0, 1].
 *
 * k(x1, x2) = exp(-||x1 - x2||^2 / (2 * lengthScale^2))
 */
export function rbfKernel(x1: number[], x2: number[], lengthScale: number): number {
  let sqDist = 0;
  for (let i = 0; i < x1.length; i++) {
    const diff = x1[i] - x2[i];
    sqDist += diff * diff;
  }
  return Math.exp(-sqDist / (2 * lengthScale * lengthScale));
}

// ---- Internal: GP Prediction ----

interface GPPrediction {
  mean: number;
  std: number;
}

/**
 * Compute Gaussian Process posterior mean and standard deviation at candidate points.
 *
 * Uses a simple RBF kernel with Cholesky-free approach (direct kernel matrix inversion
 * via regularized system for small observation counts — suitable for <50 observations).
 */
export function computeGP(
  observations: PIDObservation[],
  candidates: number[][],
  normalizedObs: number[][],
  lengthScale: number,
  noiseVariance: number
): GPPrediction[] {
  const n = observations.length;

  // Build kernel matrix K(X, X) + noise * I
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const val = rbfKernel(normalizedObs[i], normalizedObs[j], lengthScale);
      K[i][j] = val + (i === j ? noiseVariance : 0);
      K[j][i] = K[i][j];
    }
  }

  // Invert K using Gauss-Jordan elimination (suitable for small n)
  const KInv = invertMatrix(K);
  if (!KInv) {
    // Fallback: return uniform predictions if matrix is singular
    return candidates.map(() => ({ mean: 50, std: 25 }));
  }

  // Precompute K_inv * y
  const scores = observations.map((o) => o.score);
  const KInvY = matVecMul(KInv, scores);

  // Predict at each candidate
  const predictions: GPPrediction[] = [];
  for (const candidate of candidates) {
    // k(x*, X) — kernel vector between candidate and all observations
    const kStar: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      kStar[i] = rbfKernel(candidate, normalizedObs[i], lengthScale);
    }

    // mean = k* . K^-1 . y
    let mean = 0;
    for (let i = 0; i < n; i++) {
      mean += kStar[i] * KInvY[i];
    }

    // variance = k(x*, x*) - k* . K^-1 . k*^T
    const kStarStar = 1.0; // rbfKernel(candidate, candidate) = 1
    const KInvKStar = matVecMul(KInv, kStar);
    let variance = kStarStar;
    for (let i = 0; i < n; i++) {
      variance -= kStar[i] * KInvKStar[i];
    }
    // Clamp to avoid numerical issues
    variance = Math.max(variance, 1e-10);

    predictions.push({ mean, std: Math.sqrt(variance) });
  }

  return predictions;
}

// ---- Internal: Expected Improvement ----

/**
 * Expected Improvement acquisition function.
 *
 * EI(x) = (mean - bestScore - xi) * CDF(Z) + std * PDF(Z)
 * where Z = (mean - bestScore - xi) / std
 *
 * xi is the exploration parameter (explorationWeight).
 */
export function expectedImprovement(
  mean: number,
  std: number,
  bestScore: number,
  xi: number = 0.01
): number {
  if (std <= 1e-10) {
    return Math.max(0, mean - bestScore - xi);
  }
  const z = (mean - bestScore - xi) / std;
  const cdfZ = normalCDF(z);
  const pdfZ = normalPDF(z);
  return (mean - bestScore - xi) * cdfZ + std * pdfZ;
}

// ---- Internal: Latin Hypercube Sampling ----

/**
 * Generate well-distributed candidate points via Latin Hypercube Sampling.
 *
 * Divides each dimension into `count` equal strata and places one sample
 * per stratum, then shuffles across dimensions to avoid correlation.
 *
 * @param bounds - Array of [min, max] bounds per dimension
 * @param count - Number of samples
 * @param seed - Optional seed for reproducible shuffling
 */
export function latinHypercubeSample(
  bounds: [number, number][],
  count: number,
  seed?: number
): number[][] {
  const dims = bounds.length;
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;

  // For each dimension, create stratum-based samples
  const perDim: number[][] = [];
  for (let d = 0; d < dims; d++) {
    const [lo, hi] = bounds[d];
    const indices = Array.from({ length: count }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    perDim.push(
      indices.map((idx) => {
        const u = (idx + rng()) / count; // random within stratum
        return lo + u * (hi - lo);
      })
    );
  }

  // Combine into points
  const points: number[][] = [];
  for (let i = 0; i < count; i++) {
    const point: number[] = [];
    for (let d = 0; d < dims; d++) {
      point.push(perDim[d][i]);
    }
    points.push(point);
  }

  return points;
}

// ---- Main Entry Point ----

/**
 * Suggest the next PID gains to try based on historical observations.
 *
 * Requires at least 3 observations to make a suggestion.
 * Returns undefined if insufficient data.
 *
 * @param observations - Historical (PID gains -> quality score) data
 * @param config - Optional optimizer configuration
 * @param seed - Optional seed for reproducible candidate generation
 */
export function suggestNextPID(
  observations: PIDObservation[],
  config?: Partial<BayesianOptimizerConfig>,
  seed?: number
): BayesianSuggestion | undefined {
  if (observations.length < 3) {
    return undefined;
  }

  const cfg: Required<BayesianOptimizerConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    explorationWeight: config?.explorationWeight ?? DEFAULT_CONFIG.explorationWeight!,
    candidateCount: config?.candidateCount ?? DEFAULT_CONFIG.candidateCount!,
  };

  const bounds: [number, number][] = [cfg.pBounds, cfg.iBounds, cfg.dBounds];

  // Normalize observations to [0, 1]
  const normalizedObs = observations.map((o) => normalizeGains(o.gains, bounds));

  // Check if all scores are the same (degenerate case)
  const allSameScore = observations.every((o) => o.score === observations[0].score);

  // GP hyperparameters
  const lengthScale = 0.3; // Moderate smoothness in normalized space
  const noiseVariance = allSameScore ? 0.1 : 0.01; // More noise regularization when degenerate

  // Generate candidates in normalized space
  const normalizedBounds: [number, number][] = bounds.map(() => [0, 1]);
  const candidates = latinHypercubeSample(normalizedBounds, cfg.candidateCount, seed);

  // Compute GP predictions
  const predictions = computeGP(
    observations,
    candidates,
    normalizedObs,
    lengthScale,
    noiseVariance
  );

  // Find best observed score
  const bestScore = Math.max(...observations.map((o) => o.score));

  // Compute EI for each candidate
  let bestEI = -Infinity;
  let bestIdx = 0;
  for (let i = 0; i < candidates.length; i++) {
    const ei = expectedImprovement(
      predictions[i].mean,
      predictions[i].std,
      bestScore,
      cfg.explorationWeight
    );
    if (ei > bestEI) {
      bestEI = ei;
      bestIdx = i;
    }
  }

  // Denormalize the best candidate back to gain space
  const bestCandidate = candidates[bestIdx];
  const suggestedGains = denormalizeGains(bestCandidate, bounds);

  // Round to integers (Betaflight PID gains are integers)
  const roundedGains: [number, number, number] = [
    clamp(Math.round(suggestedGains[0]), cfg.pBounds[0], cfg.pBounds[1]),
    clamp(Math.round(suggestedGains[1]), cfg.iBounds[0], cfg.iBounds[1]),
    clamp(Math.round(suggestedGains[2]), cfg.dBounds[0], cfg.dBounds[1]),
  ];

  // Determine confidence based on observation count
  const confidence = getConfidence(observations.length);

  return {
    gains: roundedGains,
    expectedImprovement: Math.max(0, bestEI),
    confidence,
  };
}

// ---- Utility Functions ----

function normalizeGains(gains: [number, number, number], bounds: [number, number][]): number[] {
  return gains.map((g, i) => {
    const [lo, hi] = bounds[i];
    return hi === lo ? 0.5 : (g - lo) / (hi - lo);
  });
}

function denormalizeGains(
  normalized: number[],
  bounds: [number, number][]
): [number, number, number] {
  return normalized.map((n, i) => {
    const [lo, hi] = bounds[i];
    return lo + n * (hi - lo);
  }) as [number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getConfidence(observationCount: number): 'high' | 'medium' | 'low' {
  if (observationCount >= 11) return 'high';
  if (observationCount >= 6) return 'medium';
  return 'low';
}

/** Standard normal PDF */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF (approximation via error function) */
function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/**
 * Error function approximation (Abramowitz & Stegun, formula 7.1.26).
 * Maximum error: 1.5e-7.
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  const y = 1.0 - (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * Math.exp(-absX * absX);
  return sign * y;
}

/** Simple seeded PRNG (Mulberry32) */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Matrix Operations (for small matrices) ----

/** Matrix-vector multiplication */
function matVecMul(M: number[][], v: number[]): number[] {
  const n = M.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < v.length; j++) {
      result[i] += M[i][j] * v[j];
    }
  }
  return result;
}

/**
 * Invert a square matrix using Gauss-Jordan elimination.
 * Returns null if the matrix is singular.
 */
function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;

  // Create augmented matrix [M | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = M[i][j];
    }
    row[n + i] = 1;
    return row;
  });

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null; // Singular

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    // Scale pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate column in other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse from augmented matrix
  return aug.map((row) => row.slice(n));
}
