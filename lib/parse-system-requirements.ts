/**
 * Parse official system-requirements strings (HardwareSpec free text + Steam HTML)
 * into candidate CPU/GPU lists and RAM for official-spec comparison.
 *
 * Pure, no I/O — safe for client and tests.
 */

import type { HardwareSpec } from './types';

export type ParseQuality = 'good' | 'partial' | 'poor';

export interface ParsedReqSide {
  cpuCandidates: string[];
  gpuCandidates: string[];
  ramGB: number | null;
  raw: { cpu?: string; gpu?: string };
  parseQuality: ParseQuality;
}

/** Split dual-vendor requirement strings into individual candidates. */
export function splitHardwareAlternatives(raw: string): string[] {
  if (!raw || !raw.trim()) return [];

  // Normalize common separators without splitting model numbers like "i5-8400"
  const normalized = raw
    .replace(/\s+\/\s+/g, ' | ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+or\s+/gi, ' | ')
    .replace(/\s+OR\s+/g, ' | ');

  return normalized
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(stripRequirementFluff)
    .filter(Boolean);
}

/** Remove publisher fluff that is not part of the model name. */
export function stripRequirementFluff(raw: string): string {
  return raw
    .replace(/\bor\s+better\b/gi, '')
    .replace(/\bor\s+equivalent\b/gi, '')
    .replace(/\band\s+above\b/gi, '')
    .replace(/\bor\s+higher\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[.,;]+$/, '')
    .trim();
}

function extractRamGB(text: string | undefined, numeric?: number): number | null {
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*GB/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Parse a stored HardwareSpec (cpu/gpu free text + ram number) into candidates.
 */
export function parseHardwareSpecSide(spec?: HardwareSpec | null): ParsedReqSide {
  if (!spec) {
    return {
      cpuCandidates: [],
      gpuCandidates: [],
      ramGB: null,
      raw: {},
      parseQuality: 'poor',
    };
  }

  const cpuRaw = (spec.cpu || '').trim();
  const gpuRaw = (spec.gpu || '').trim();
  const cpuCandidates = splitHardwareAlternatives(cpuRaw);
  const gpuCandidates = splitHardwareAlternatives(gpuRaw);
  const ramGB = extractRamGB(undefined, spec.ram);

  let parseQuality: ParseQuality = 'poor';
  if (cpuCandidates.length && gpuCandidates.length && ramGB != null) {
    parseQuality = 'good';
  } else if (cpuCandidates.length || gpuCandidates.length || ramGB != null) {
    parseQuality = 'partial';
  }

  return {
    cpuCandidates,
    gpuCandidates,
    ramGB,
    raw: {
      cpu: cpuRaw || undefined,
      gpu: gpuRaw || undefined,
    },
    parseQuality,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a labeled field from Steam-style requirements HTML / plain text.
 * Labels: Processor, CPU, Graphics, GPU, Video Card, Memory, RAM, Storage, Hard Drive.
 */
function extractLabeledField(text: string, labels: string[]): string | null {
  for (const label of labels) {
    // "Processor: value" up to next known label or end
    const re = new RegExp(
      `${label}\\s*:\\s*(.+?)(?=\\s*(?:OS|Processor|CPU|Memory|RAM|Graphics|GPU|Video\\s*Card|DirectX|Storage|Hard\\s*Drive|Sound|Additional)\\s*:|$)`,
      'i'
    );
    const m = text.match(re);
    if (m?.[1]) {
      const v = m[1].trim();
      if (v) return v;
    }
  }
  return null;
}

/**
 * Parse Steam `pc_requirements.minimum` / `.recommended` HTML into HardwareSpec.
 * Returns null when no usable CPU/GPU/Memory found.
 */
export function parseSteamRequirementsHtml(html: string): HardwareSpec | null {
  if (!html || !html.trim()) return null;

  const text = stripHtml(html);
  if (!text) return null;

  const cpu = extractLabeledField(text, ['Processor', 'CPU']);
  const gpu = extractLabeledField(text, ['Graphics', 'GPU', 'Video Card', 'Video']);
  const memoryRaw = extractLabeledField(text, ['Memory', 'RAM']);
  const storage = extractLabeledField(text, ['Storage', 'Hard Drive', 'Hard Disk']);

  const ram = extractRamGB(memoryRaw ?? undefined) ?? 0;

  if (!cpu && !gpu && !ram) return null;
  // Need at least one of cpu/gpu to be useful for comparison
  if (!cpu && !gpu) return null;

  return {
    cpu: cpu ? stripRequirementFluff(cpu) : '',
    gpu: gpu ? stripRequirementFluff(gpu) : '',
    ram: ram || 0,
    storage: storage || undefined,
  };
}

export interface SteamOfficialReqs {
  min: HardwareSpec | null;
  rec: HardwareSpec | null;
}

/**
 * Map Steam `data.pc_requirements` (object or empty array) → structured min/rec.
 * Network-free; used by ingest and backfill after appdetails fetch.
 */
export function extractOfficialReqsFromPcRequirements(
  pcRequirements: unknown
): SteamOfficialReqs {
  if (pcRequirements == null) return { min: null, rec: null };
  // Steam returns [] when a title has no PC requirements block
  if (Array.isArray(pcRequirements)) return { min: null, rec: null };
  if (typeof pcRequirements !== 'object') return { min: null, rec: null };

  const obj = pcRequirements as Record<string, unknown>;
  const minHtml = typeof obj.minimum === 'string' ? obj.minimum : '';
  const recHtml = typeof obj.recommended === 'string' ? obj.recommended : '';

  return {
    min: minHtml ? parseSteamRequirementsHtml(minHtml) : null,
    rec: recHtml ? parseSteamRequirementsHtml(recHtml) : null,
  };
}

/**
 * Build a games-table patch for official reqs.
 * Only includes keys when parsed values exist — never clears existing seed data with nulls.
 */
export function officialReqsDbPatch(reqs: SteamOfficialReqs): {
  official_min_reqs?: HardwareSpec;
  official_rec_reqs?: HardwareSpec;
} {
  const patch: {
    official_min_reqs?: HardwareSpec;
    official_rec_reqs?: HardwareSpec;
  } = {};
  if (reqs.min) patch.official_min_reqs = reqs.min;
  if (reqs.rec) patch.official_rec_reqs = reqs.rec;
  return patch;
}
