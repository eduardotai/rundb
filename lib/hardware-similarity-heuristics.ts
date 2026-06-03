import type { Report, UserPC } from './types';

export function extractGpuSeries(gpu: string): string | null {
  const upper = gpu.toUpperCase();
  const rtxMatch = upper.match(/RTX\s*(\d{2})/);
  if (rtxMatch) return `RTX ${rtxMatch[1][0]}0`;
  const rxMatch = upper.match(/RX\s*(\d{4})/);
  if (rxMatch) return `RX ${rxMatch[1].slice(0, 2)}00`;
  if (upper.includes('4090') || upper.includes('4080') || upper.includes('4070')) return 'RTX 40';
  if (upper.includes('3090') || upper.includes('3080') || upper.includes('3070')) return 'RTX 30';
  if (upper.includes('2060') || upper.includes('1660')) return 'RTX 20 / GTX 16';
  return null;
}

export function getCpuTier(cpu: string): 'high' | 'mid' | 'low' {
  const upper = cpu.toUpperCase();
  const highKeywords = ['7800X3D', '7700X', '7900X', '14900K', '13900K', '13700K', '13600K', '12900K'];
  if (highKeywords.some((k) => upper.includes(k))) return 'high';
  if (upper.includes('I9') || upper.includes('RYZEN 9') || upper.includes('5800X3D')) return 'high';
  if (upper.includes('I7') || upper.includes('RYZEN 7') || upper.includes('7600') || upper.includes('13400')) return 'mid';
  return 'low';
}

export function calculateSimilarity(report: Report, userRig: UserPC | null): number {
  if (!userRig) return 0;
  let score = 50;

  const reportSeries = extractGpuSeries(report.gpu);
  const userSeries = extractGpuSeries(userRig.gpu);
  if (reportSeries && userSeries && reportSeries === userSeries) score += 30;
  else if (reportSeries && userSeries) score += 10;

  const reportTier = getCpuTier(report.cpu);
  const userTier = getCpuTier(userRig.cpu);
  if (reportTier === userTier) score += 15;
  else if (reportTier === 'high' && userTier === 'mid') score += 5;

  const ramDiff = Math.abs(report.ram - userRig.ram);
  if (ramDiff <= 8) score += 10;
  else if (ramDiff <= 16) score += 5;

  return Math.min(100, Math.max(0, score));
}
