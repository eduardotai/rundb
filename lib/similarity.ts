/**
 * RunDB Hardware-Aware Similarity Engine
 *
 * Phase 6+ upgrade over the original crude `calculateSimilarity` in mock-data.ts.
 *
 * Primary signal: perfIndex delta (from the new Hardware Catalog)
 * Secondary: exact canonical match bonus, RAM closeness, resolution context
 *
 * Goal: Two users with very similar real gaming capability (e.g. 4070 Ti vs 7800 XT)
 * now get much higher similarity scores than before, even if the raw strings differ.
 *
 * Backward compatible: old calculateSimilarity remains exported unchanged.
 * New code should prefer calculateHardwareAwareSimilarity.
 */

import type { PerformanceTier, Report, UserPC } from './types';
import { getPerfIndexForRaw, normalizeHardwareSync } from './normalize-hardware';
import { extractGpuSeries, getCpuTier } from './hardware-similarity-heuristics';

/**
 * Main exported function used everywhere (ReportCard, predictions, etc.).
 * Supports optional live catalog injection in the future for fully dynamic production behavior.
 */
export function calculateHardwareAwareSimilarity(
  report: Report, 
  userRig: UserPC | null,
  liveCatalog?: unknown[]
): number {
  // liveCatalog param supported for future full injection (currently normalize + static + merged data layer cover most cases)
  void liveCatalog;
  if (!userRig) return 0;

  let score = 45;

  const reportGpuPerf = getPerfIndexForRaw(report.gpu) ?? getPerfIndexForRaw(report.canonicalGpu || '');
  const userGpuPerf = getPerfIndexForRaw(userRig.gpu) ?? getPerfIndexForRaw(userRig.canonicalGpu || '');

  if (reportGpuPerf != null && userGpuPerf != null) {
    const delta = Math.abs(reportGpuPerf - userGpuPerf);
    if (delta <= 5) score += 32;
    else if (delta <= 10) score += 26;
    else if (delta <= 18) score += 18;
    else if (delta <= 28) score += 9;
    else score += 3;
  } else {
    const reportSeries = extractGpuSeries(report.gpu);
    const userSeries = extractGpuSeries(userRig.gpu);
    if (reportSeries && userSeries && reportSeries === userSeries) score += 18;
    else if (reportSeries && userSeries) score += 7;
  }

  const reportCpuPerf = getPerfIndexForRaw(report.cpu) ?? getPerfIndexForRaw(report.canonicalCpu || '');
  const userCpuPerf = getPerfIndexForRaw(userRig.cpu) ?? getPerfIndexForRaw(userRig.canonicalCpu || '');

  if (reportCpuPerf != null && userCpuPerf != null) {
    const delta = Math.abs(reportCpuPerf - userCpuPerf);
    if (delta <= 6) score += 14;
    else if (delta <= 12) score += 9;
    else if (delta <= 20) score += 5;
  } else {
    const reportTier = getCpuTier(report.cpu);
    const userTier = getCpuTier(userRig.cpu);
    if (reportTier === userTier) score += 11;
    else if (reportTier === 'high' && userTier === 'mid') score += 4;
  }

  const ramDiff = Math.abs(report.ram - userRig.ram);
  if (ramDiff <= 4) score += 8;
  else if (ramDiff <= 8) score += 5;
  else if (ramDiff <= 16) score += 2;

  const reportGpuCanon = report.canonicalGpu || normalizeHardwareSync(report.gpu).canonical;
  const userGpuCanon = userRig.canonicalGpu || normalizeHardwareSync(userRig.gpu).canonical;
  if (reportGpuCanon && userGpuCanon && reportGpuCanon === userGpuCanon) {
    score += 12;
  }

  if (report.resolution === userRig.resolution) score += 3;

  return Math.min(100, Math.max(0, Math.round(score)));
}

export type MatchLevel = 'exact' | 'close' | 'far';

export interface MatchBreakdown {
  score: number;
  gpu: MatchLevel;
  cpu: MatchLevel;
  ram: MatchLevel;
  resolution: boolean;
}

export type TransferDirection = 'higher' | 'similar' | 'lower' | 'unknown';
export type TransferMagnitude = 'none' | 'slight' | 'clear' | 'large';

export interface HardwareTransfer {
  direction: TransferDirection;
  magnitude: TransferMagnitude;
  /** Signed percent: positive = user GPU stronger than reporter. Null if unknown. */
  gpuRelPercent: number | null;
  userGpuPerf: number | null;
  reportGpuPerf: number | null;
  resolutionMatch: boolean;
  /** MVP A: true only when resolution matches. */
  settingsComparable: boolean;
}

const TRANSFER_SLIGHT = 0.08;
const TRANSFER_CLEAR = 0.2;
const TRANSFER_LARGE = 0.4;

function resolveGpuPerf(raw: string, canon?: string): number | null {
  const v =
    getPerfIndexForRaw(raw) ??
    (canon ? getPerfIndexForRaw(canon) : undefined) ??
    null;
  return v == null ? null : v;
}

function magnitudeFromAbsRel(absRel: number): TransferMagnitude {
  if (absRel < TRANSFER_SLIGHT) return 'none';
  if (absRel < TRANSFER_CLEAR) return 'slight';
  if (absRel < TRANSFER_LARGE) return 'clear';
  return 'large';
}

/**
 * Signed hardware transfer from a community report toward the user's rig.
 * MVP A: GPU perfIndex only. Does NOT estimate FPS.
 */
export function calculateHardwareTransfer(report: Report, rig: UserPC): HardwareTransfer {
  const userGpuPerf = resolveGpuPerf(rig.gpu, rig.canonicalGpu);
  const reportGpuPerf = resolveGpuPerf(report.gpu, report.canonicalGpu);
  const resolutionMatch = !!report.resolution && report.resolution === rig.resolution;
  const settingsComparable = resolutionMatch;

  if (userGpuPerf == null || reportGpuPerf == null || reportGpuPerf === 0) {
    return {
      direction: 'unknown',
      magnitude: 'none',
      gpuRelPercent: null,
      userGpuPerf,
      reportGpuPerf,
      resolutionMatch,
      settingsComparable,
    };
  }

  const rel = (userGpuPerf - reportGpuPerf) / reportGpuPerf;
  const absRel = Math.abs(rel);
  const magnitude = magnitudeFromAbsRel(absRel);
  let direction: TransferDirection = 'similar';
  if (magnitude !== 'none') {
    direction = rel > 0 ? 'higher' : 'lower';
  }

  return {
    direction,
    magnitude,
    gpuRelPercent: Math.round(rel * 100),
    userGpuPerf,
    reportGpuPerf,
    resolutionMatch,
    settingsComparable,
  };
}

export function shouldDisplayTransfer(
  transfer: HardwareTransfer,
  opts: { looserMode: boolean }
): boolean {
  if (transfer.direction === 'unknown') return opts.looserMode;
  if (transfer.magnitude === 'none') return false;
  return true;
}

function bucketByPerfDelta(
  reportRaw: string,
  reportCanon: string | undefined,
  userRaw: string,
  userCanon: string | undefined
): MatchLevel {
  const rCanon = reportCanon || normalizeHardwareSync(reportRaw).canonical;
  const uCanon = userCanon || normalizeHardwareSync(userRaw).canonical;
  if (rCanon && uCanon && rCanon === uCanon) return 'exact';

  const rPerf = getPerfIndexForRaw(reportRaw) ?? getPerfIndexForRaw(reportCanon || '');
  const uPerf = getPerfIndexForRaw(userRaw) ?? getPerfIndexForRaw(userCanon || '');
  if (rPerf != null && uPerf != null) {
    const delta = Math.abs(rPerf - uPerf);
    if (delta <= 5) return 'exact';
    if (delta <= 18) return 'close';
    return 'far';
  }
  return 'far';
}

function bucketRam(reportRam: number, userRam: number): MatchLevel {
  const diff = Math.abs(reportRam - userRam);
  if (diff === 0) return 'exact';
  if (diff <= 8) return 'close';
  return 'far';
}

export function calculateMatchBreakdown(report: Report, rig: UserPC): MatchBreakdown {
  return {
    score: calculateHardwareAwareSimilarity(report, rig),
    gpu: bucketByPerfDelta(report.gpu, report.canonicalGpu, rig.gpu, rig.canonicalGpu),
    cpu: bucketByPerfDelta(report.cpu, report.canonicalCpu, rig.cpu, rig.canonicalCpu),
    ram: bucketRam(report.ram, rig.ram),
    resolution: !!report.resolution && report.resolution === rig.resolution,
  };
}

export type MatchSort = 'match' | 'fps' | 'newest';

export interface MatchFilters {
  gameId?: string;
  resolution?: string;
  tier?: PerformanceTier;
  sort?: MatchSort;
  minScore?: number;
}

export interface RigMatch {
  report: Report;
  score: number;
  breakdown: MatchBreakdown;
  transfer: HardwareTransfer;
}

export function rankAndFilterMatches(
  reports: Report[],
  rig: UserPC,
  filters: MatchFilters = {}
): RigMatch[] {
  const minScore = filters.minScore ?? 60;

  let matches: RigMatch[] = reports.map((report) => {
    const breakdown = calculateMatchBreakdown(report, rig);
    const transfer = calculateHardwareTransfer(report, rig);
    return { report, score: breakdown.score, breakdown, transfer };
  });

  matches = matches.filter((m) => m.score >= minScore);
  if (filters.gameId) matches = matches.filter((m) => m.report.gameId === filters.gameId);
  if (filters.resolution) matches = matches.filter((m) => m.report.resolution === filters.resolution);
  if (filters.tier) matches = matches.filter((m) => m.report.performanceTier === filters.tier);

  const sort = filters.sort ?? 'match';
  matches.sort((a, b) => {
    if (sort === 'fps') return b.report.avgFps - a.report.avgFps;
    if (sort === 'newest') {
      return new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime();
    }
    return b.score - a.score;
  });

  return matches;
}

// Original heuristic exports (kept for full backward compatibility with existing call sites)
export { calculateSimilarity, extractGpuSeries, getCpuTier } from './hardware-similarity-heuristics';



/**
 * Convenience: score an entire list and return top N with scores.
 */
export function rankReportsBySimilarity(
  reports: Report[],
  userRig: UserPC | null,
  limit = 5
): Array<{ report: Report; score: number }> {
  if (!userRig || reports.length === 0) return [];

  const scored = reports
    .map((r) => ({
      report: r,
      score: calculateHardwareAwareSimilarity(r, userRig),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
