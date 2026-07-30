/**
 * Official Spec Quick Check
 *
 * Compare a user rig against publisher min/recommended HardwareSpec strings.
 * Pure, client-safe. Does NOT invent FPS or map to PerformanceTier.
 *
 * Uses hardware catalog perfIndex with OR-of-alternatives semantics for dual lists.
 */

import type {
  ComponentCheck,
  Game,
  HardwareSpec,
  OfficialSpecCheckResult,
  OfficialSpecVerdict,
  SpecTierCheck,
  UserPC,
} from './types';
import { getPerfIndexForRaw, normalizeHardwareSync } from './normalize-hardware';
import { parseHardwareSpecSide } from './parse-system-requirements';

export type {
  ComponentCheck,
  OfficialSpecCheckResult,
  OfficialSpecVerdict,
  SpecTierCheck,
};

/** Borderline band: slightly under a listed candidate still counts as near-miss. */
const BORDERLINE_PERF_DELTA = 5;
/** Headroom above all listed candidates → exceeds_recommended. */
const EXCEEDS_HEADROOM = 8;

const DEFAULT_LIMITATIONS = [
  'Based on publisher min/recommended specs (not community measurements).',
  'Publisher targets are not standardized (resolution, preset, and FPS vary by title).',
  'Official specs typically assume 1080p; higher resolutions may need a stronger GPU.',
];

function isRigComplete(rig: UserPC): boolean {
  return Boolean(rig.cpu?.trim() && rig.gpu?.trim() && Number.isFinite(rig.ram) && rig.ram > 0);
}

function resolveUserPerf(raw: string, canon?: string): number | null {
  const v =
    getPerfIndexForRaw(raw) ??
    (canon ? getPerfIndexForRaw(canon) : undefined) ??
    null;
  return v == null ? null : v;
}

/**
 * OR semantics: user passes if they meet ANY listed candidate.
 * borderline if slightly under the closest candidate they almost meet.
 * fail if clearly under all resolved candidates.
 * unknown if no candidates resolve to a perfIndex (and no exact canonical match).
 */
function compareComponent(
  userRaw: string,
  userCanon: string | undefined,
  candidates: string[]
): ComponentCheck {
  if (!candidates.length) return 'unknown';
  if (!userRaw?.trim()) return 'unknown';

  const userPerf = resolveUserPerf(userRaw, userCanon);
  const userNorm = normalizeHardwareSync(userRaw);
  const userCanonical = userCanon || userNorm.canonical;

  let closestUnderDelta = Infinity;
  let anyResolved = false;

  for (const cand of candidates) {
    const candNorm = normalizeHardwareSync(cand);
    const candPerf = getPerfIndexForRaw(cand) ?? candNorm.entry?.perfIndex;

    // Exact / alias canonical match counts as pass
    if (userCanonical && candNorm.canonical && userCanonical === candNorm.canonical) {
      return 'pass';
    }

    if (candPerf == null || userPerf == null) {
      // Heuristic same-series soft signal only when both lack index
      continue;
    }

    anyResolved = true;
    if (userPerf >= candPerf) {
      return 'pass';
    }
    const under = candPerf - userPerf;
    if (under < closestUnderDelta) closestUnderDelta = under;
  }

  if (!anyResolved || userPerf == null) {
    // Try series-only soft match: if any candidate series matches user series → borderline
    // Keep conservative: unknown is safer than false pass
    return 'unknown';
  }

  if (closestUnderDelta <= BORDERLINE_PERF_DELTA) return 'borderline';
  return 'fail';
}

function compareRam(userRam: number, required: number | null): ComponentCheck {
  if (required == null || required <= 0) return 'unknown';
  if (userRam >= required) return 'pass';
  return 'fail'; // strict RAM for MVP
}

function tierOverall(cpu: ComponentCheck, gpu: ComponentCheck, ram: ComponentCheck): SpecTierCheck['overall'] {
  if (cpu === 'fail' || gpu === 'fail' || ram === 'fail') return 'fail';
  // Conservative: unknown CPU/GPU blocks hard pass
  if (cpu === 'unknown' || gpu === 'unknown') return 'unknown';
  if (ram === 'unknown') return 'unknown';
  // pass or borderline on all critical components
  if (
    (cpu === 'pass' || cpu === 'borderline') &&
    (gpu === 'pass' || gpu === 'borderline') &&
    ram === 'pass'
  ) {
    return 'pass';
  }
  return 'unknown';
}

function evaluateTier(
  rig: UserPC,
  spec: HardwareSpec | undefined
): { check?: SpecTierCheck; quality: string; resolvedCount: number; candidateCount: number } {
  if (!spec) return { quality: 'poor', resolvedCount: 0, candidateCount: 0 };

  const parsed = parseHardwareSpecSide(spec);
  const userCpuCanon = rig.canonicalCpu || normalizeHardwareSync(rig.cpu).canonical;
  const userGpuCanon = rig.canonicalGpu || normalizeHardwareSync(rig.gpu).canonical;

  const cpu = compareComponent(rig.cpu, userCpuCanon, parsed.cpuCandidates);
  const gpu = compareComponent(rig.gpu, userGpuCanon, parsed.gpuCandidates);
  const ram = compareRam(rig.ram, parsed.ramGB);
  const overall = tierOverall(cpu, gpu, ram);

  // Confidence bookkeeping
  let resolvedCount = 0;
  let candidateCount = parsed.cpuCandidates.length + parsed.gpuCandidates.length;
  for (const c of [...parsed.cpuCandidates, ...parsed.gpuCandidates]) {
    if (getPerfIndexForRaw(c) != null || normalizeHardwareSync(c).entry?.perfIndex != null) {
      resolvedCount++;
    }
  }
  if (parsed.ramGB != null) {
    candidateCount += 1;
    resolvedCount += 1;
  }

  return {
    check: { cpu, gpu, ram, overall },
    quality: parsed.parseQuality,
    resolvedCount,
    candidateCount,
  };
}

function hasClearHeadroom(rig: UserPC, rec: HardwareSpec | undefined): boolean {
  if (!rec) return false;
  const parsed = parseHardwareSpecSide(rec);
  const userCpu = resolveUserPerf(rig.cpu, rig.canonicalCpu);
  const userGpu = resolveUserPerf(rig.gpu, rig.canonicalGpu);
  if (userCpu == null || userGpu == null) return false;

  const cpuPerfs = parsed.cpuCandidates
    .map((c) => getPerfIndexForRaw(c) ?? normalizeHardwareSync(c).entry?.perfIndex)
    .filter((n): n is number => n != null);
  const gpuPerfs = parsed.gpuCandidates
    .map((c) => getPerfIndexForRaw(c) ?? normalizeHardwareSync(c).entry?.perfIndex)
    .filter((n): n is number => n != null);

  if (!cpuPerfs.length || !gpuPerfs.length) return false;

  // Clear headroom vs the strongest listed candidate on each side
  const maxCpu = Math.max(...cpuPerfs);
  const maxGpu = Math.max(...gpuPerfs);
  const ramOk = parsed.ramGB == null || rig.ram >= parsed.ramGB + 8;

  return userCpu >= maxCpu + EXCEEDS_HEADROOM && userGpu >= maxGpu + EXCEEDS_HEADROOM && ramOk;
}

function composeVerdict(
  hasMin: boolean,
  hasRec: boolean,
  exceeds: boolean,
  min?: SpecTierCheck,
  rec?: SpecTierCheck
): OfficialSpecVerdict {
  if (min?.overall === 'fail') return 'below_minimum';

  if (!hasMin && !hasRec) return 'unknown';

  if (!hasMin && hasRec) {
    if (rec?.overall === 'pass') {
      return exceeds ? 'exceeds_recommended' : 'meets_recommended';
    }
    if (rec?.overall === 'fail') return 'below_minimum'; // only rec listed and failed
    return 'unknown';
  }

  // has min
  if (min?.overall === 'unknown' || !min) {
    // min incomplete — maybe rec still useful
    if (hasRec && rec?.overall === 'pass') {
      return exceeds ? 'exceeds_recommended' : 'meets_recommended';
    }
    return 'unknown';
  }

  // min overall pass
  if (!hasRec) return 'meets_minimum';

  if (rec?.overall === 'pass') {
    return exceeds ? 'exceeds_recommended' : 'meets_recommended';
  }
  if (rec?.overall === 'fail') return 'between_min_and_rec';
  // rec unknown but min pass
  return 'meets_minimum';
}

function explanationFor(verdict: OfficialSpecVerdict): string {
  switch (verdict) {
    case 'exceeds_recommended':
      return 'Your rig is above the publisher recommended specs.';
    case 'meets_recommended':
      return 'Your rig meets the publisher recommended specs.';
    case 'between_min_and_rec':
      return 'Your rig is above minimum but below recommended publisher specs.';
    case 'meets_minimum':
      return 'Your rig meets the publisher minimum specs.';
    case 'below_minimum':
      return 'Your rig is below the publisher minimum specs on at least one component.';
    default:
      return 'Not enough structured hardware data to compare against official specs.';
  }
}

function computeConfidence(
  minResolved: number,
  minTotal: number,
  recResolved: number,
  recTotal: number,
  verdict: OfficialSpecVerdict
): number {
  if (verdict === 'unknown') return 0.15;
  const total = minTotal + recTotal;
  const resolved = minResolved + recResolved;
  if (total === 0) return 0.2;
  const ratio = resolved / total;
  return Number(Math.min(0.85, Math.max(0.35, 0.35 + ratio * 0.5)).toFixed(2));
}

/**
 * Evaluate user rig against game official min/recommended requirements.
 */
export function evaluateOfficialSpecs(
  rig: UserPC,
  game: Pick<Game, 'officialMinReqs' | 'officialRecReqs'>
): OfficialSpecCheckResult {
  const limitations = [...DEFAULT_LIMITATIONS];

  if (!isRigComplete(rig)) {
    return {
      verdict: 'unknown',
      confidence: 0,
      explanation: 'Save a complete rig (CPU, GPU, and RAM) to check official specs.',
      limitations,
      source: 'official_min_rec',
    };
  }

  const hasMin = Boolean(game.officialMinReqs);
  const hasRec = Boolean(game.officialRecReqs);

  if (!hasMin && !hasRec) {
    return {
      verdict: 'unknown',
      confidence: 0.1,
      explanation: 'This game has no official min/recommended requirements on file.',
      limitations,
      source: 'official_min_rec',
    };
  }

  const minEval = evaluateTier(rig, game.officialMinReqs);
  const recEval = evaluateTier(rig, game.officialRecReqs);

  const exceeds = hasClearHeadroom(rig, game.officialRecReqs);
  const verdict = composeVerdict(hasMin, hasRec, exceeds, minEval.check, recEval.check);

  return {
    verdict,
    min: minEval.check,
    rec: recEval.check,
    confidence: computeConfidence(
      minEval.resolvedCount,
      minEval.candidateCount,
      recEval.resolvedCount,
      recEval.candidateCount,
      verdict
    ),
    explanation: explanationFor(verdict),
    limitations,
    source: 'official_min_rec',
  };
}

/** Thin alias for data-layer seam naming. */
export function checkOfficialSpecsForRig(
  userPC: UserPC,
  game: Pick<Game, 'officialMinReqs' | 'officialRecReqs'>
): OfficialSpecCheckResult {
  return evaluateOfficialSpecs(userPC, game);
}
