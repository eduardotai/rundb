/**
 * RunDB Pure Data Logic
 *
 * Shared, side-effect-free helpers used by BOTH the real-data adapter
 * (lib/data.ts async paths) and the mock/demo layer (lib/mock-data.ts).
 * Split out of mock-data.ts so real-mode pages do not bundle the demo
 * fixture/localStorage layer just to filter reports or format dates.
 *
 * No globals, no fetches, no localStorage — safe in tests, server, and client.
 */

import {
  Report,
  UserPC,
  PerformanceTier,
  GraphicsPreset,
  GameStats,
  ReportFilters,
  PredictionResult,
} from './types';

// Hardware-aware similarity engine (catalog-powered, Phase 6+)
import { calculateHardwareAwareSimilarity } from './similarity';

export function filterReports(reports: Report[], filters: ReportFilters): Report[] {
  return reports.filter((r) => {
    if (filters.resolution && r.resolution !== filters.resolution) return false;
    if (filters.gpuSeries && !r.gpu.toUpperCase().includes(filters.gpuSeries.toUpperCase())) return false;
    if (filters.minFps && r.avgFps < filters.minFps) return false;
    if (filters.maxFps && r.avgFps > filters.maxFps) return false;
    if (filters.preset && filters.preset !== 'Any' && r.settingsPreset !== filters.preset) return false;
    return true;
  });
}

export function predictForUserRigFromReports(userPC: UserPC, gameReports: Report[]): PredictionResult {
  if (gameReports.length === 0) {
    return {
      predictedTier: 'Playable',
      confidence: 0.3,
      matchingReports: [],
      explanation: 'Not enough data for this game yet.',
      recommendedSettings: 'Start on Medium 1080p and adjust.',
    };
  }

  // Prefer the new hardware-aware similarity (uses perfIndex from catalog)
  const scored = gameReports
    .map((r) => ({
      report: r,
      score: calculateHardwareAwareSimilarity(r, userPC),
    }))
    .sort((a, b) => b.score - a.score);

  const topMatches = scored.slice(0, 5).map((s) => s.report);
  const avgFpsTop = topMatches.reduce((sum, r) => sum + r.avgFps, 0) / topMatches.length;

  let predicted: PerformanceTier = 'Playable';
  if (avgFpsTop >= 90) predicted = 'Excellent';
  else if (avgFpsTop >= 60) predicted = 'Good';
  else if (avgFpsTop >= 40) predicted = 'Playable';
  else if (avgFpsTop >= 25) predicted = 'Struggling';
  else predicted = 'Unplayable';

  const confidence = Math.min(0.92, Math.max(0.45, scored[0]?.score / 110));

  const explanation = `Your ${userPC.gpu} + ${userPC.ram}GB rig matches ${Math.round(scored[0]?.score || 50)}% with the top similar reports (hardware-aware matching).`;

  const recommendedSettings = avgFpsTop > 80
    ? 'High/Ultra 1440p or 4K with upscaling likely comfortable.'
    : avgFpsTop > 55
    ? 'High 1440p or Medium-High 4K with DLSS/FSR Quality.'
    : 'Medium 1080p or 1440p with upscaling recommended.';

  return {
    predictedTier: predicted,
    confidence: Number(confidence.toFixed(2)),
    matchingReports: topMatches,
    explanation,
    recommendedSettings,
  };
}

export function computeGameStatsFromReports(reports: Report[]): GameStats {
  const total = reports.length;

  const tierDistribution: Record<PerformanceTier, number> = {
    Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0,
  };
  reports.forEach((r) => {
    tierDistribution[r.performanceTier] = (tierDistribution[r.performanceTier] || 0) + 1;
  });

  const avgFpsByResolution: Record<string, number> = {};
  const resGroups: Record<string, number[]> = {};
  reports.forEach((r) => {
    if (!resGroups[r.resolution]) resGroups[r.resolution] = [];
    resGroups[r.resolution].push(r.avgFps);
  });
  Object.keys(resGroups).forEach((res) => {
    const arr = resGroups[res];
    avgFpsByResolution[res] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  });

  const presetCounts: Record<string, number> = {};
  reports.forEach((r) => {
    presetCounts[r.settingsPreset] = (presetCounts[r.settingsPreset] || 0) + 1;
  });
  const mostCommonPreset = (Object.entries(presetCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as GraphicsPreset) || null;

  const avgFpsOverall = total > 0
    ? Math.round(reports.reduce((sum, r) => sum + r.avgFps, 0) / total)
    : 0;

  return {
    totalReports: total,
    tierDistribution,
    avgFpsByResolution,
    mostCommonPreset,
    avgFpsOverall,
  };
}

// Small helper for UI
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 1) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

// Simple client-side CSV parser (no external deps)
export function parseCSV(text: string): any[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const obj: any = {};
    headers.forEach((h, j) => {
      obj[h] = values[j] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' ) {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((s) => s.replace(/^"|"$/g, '').trim());
}
