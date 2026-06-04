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

import type { Report, UserPC } from './types';
import { getPerfIndexForRaw, normalizeHardwareSync } from './normalize-hardware';
import { extractGpuSeries, getCpuTier } from './hardware-similarity-heuristics';

/**
 * Main exported function used everywhere (ReportCard, predictions, etc.).
 * Supports optional live catalog injection in the future for fully dynamic production behavior.
 */
export function calculateHardwareAwareSimilarity(
  report: Report, 
  userRig: UserPC | null,
  liveCatalog?: any[]
): number {
  // liveCatalog param supported for future full injection (currently normalize + static + merged data layer cover most cases)
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
