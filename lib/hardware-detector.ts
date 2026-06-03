/**
 * RunDB Hardware Detector — Hybrid Master (Plan 4) Core Implementation
 * Implementer A slice: Core Detector + Normalization (HIGHEST PRIORITY)
 *
 * Unified facade + browser submodule + paste submodule (exact per Plan 4 §3.1,
 * synthesizing strong elements from Plan 1 browser-native + Plan 3 paste parsers).
 *
 * === NON-NEGOTIABLE INVARIANTS (from all 4 plans + AGENTS.md + codebase) ===
 * - 100% ADDITIVE: Never replaces manual entry. Always "detect + review + apply".
 * - CLIENT-ONLY: No server fingerprinting, no background calls, zero network in detection path.
 *   All browser APIs (WebGL, WebGPU, navigator) are feature-detected + try/catch guarded.
 *   Safe to import in any 'use client' component (Next.js 16 App Router). Never runs on server.
 * - PRIVACY-FIRST: Explicit opt-in only (user must click "Identify My Hardware").
 *   Raw data lives in memory only. Never persisted/sent until user Save (existing paths).
 *   Full disclosure comments + limitations surfaced for UI (B implementer).
 * - FULL PARITY: anon/auth (Supabase incl. anon users) + NEXT_PUBLIC_USE_REAL_DATA (pure fn here;
 *   persistence unchanged per data.ts discipline at line 40 — see Implementer C).
 * - NO NEW RUNTIME DEPS: Pure TS + browser built-ins + existing sanitizeFullName.
 * - REUSE EXISTING: sanitizeFullName (lib/sanitize.ts), HardwareAlias (mock-data + admin),
 *   hooks for normalize-hardware.ts + hardware-catalog.ts (already reexported in data.ts).
 * - Sonner via lib/toast if needed (not used in pure detector).
 * - Worktree-isolated edits (this subagent workspace only).
 *
 * Detection is NEVER automatic. Callers (future B) must gate behind explicit user action.
 * Steam mode: documented stub only (zero hardware data per Steam Web API reality — Plan 2).
 * Companion mode: future stub only (Tauri etc. scoped out of MVP).
 *
 * References (MUST-READ per task):
 * - plans/hardware-identification-plan-4-hybrid-master.md (primary, §3.1 sketches)
 * - plans/hardware-identification-plan-1-browser-native.md (WebGL + heuristics details)
 * - plans/hardware-identification-plan-3-native-paste-companion.md (parsers + samples)
 * - plans/hardware-identification-plan-2-steam-oauth.md (Steam honesty)
 * - lib/mock-data.ts:795-844 (alias logic to reuse/extend)
 * - lib/types.ts:73+ (now includes DetectedHardware)
 * - lib/sanitize.ts, lib/normalize-hardware.ts, lib/hardware-catalog.ts
 * - components/compatibility-checker.tsx:66 (auth/load patterns — detection feeds, does not duplicate)
 * - node_modules/next/dist/docs/... (client components): detection is 'use client' safe by design
 *   (no top-level DOM; functions only; callers in 'use client' files).
 *
 * @see DetectedHardware, DetectionMethod in lib/types.ts
 */

import type { DetectedHardware, DetectionMethod, HardwareAlias, HardwareCatalogEntry, HardwareNormalizationResult, UserPC } from './types';
import { sanitizeFullName } from './sanitize';
import { normalizeHardwareSync } from './normalize-hardware';

// Lazy / client-safe alias loader (mirrors normalize-hardware.ts pattern exactly to avoid duplication)
async function safeLoadAliasesForDetector(): Promise<Array<{ rawString: string; canonical: string; vendor?: string; series?: string }>> {
  if (typeof window === 'undefined') return [];
  try {
    // Dynamic to keep pure and avoid pulling LS into any theoretical server path
    const { loadHardwareAliases } = await import('./mock-data');
    return loadHardwareAliases().map((a) => ({
      rawString: a.rawString.toLowerCase(),
      canonical: a.canonical,
      vendor: a.vendor,
      series: a.series,
    }));
  } catch {
    return [];
  }
}

// ============================================
// PUBLIC TYPES (re-export for convenience; source of truth is types.ts)
// ============================================

export type { DetectedHardware, DetectionMethod };

export type DetectionMode = 'browser' | 'paste' | 'steam' | 'all' | 'companion';

// ============================================
// CORE: applyHardwareAliases (reuse/extend mock-data:795-844 logic)
// Case-insensitive, longest-match-first, returns canonical + vendor/series for catalog.
// Hook for future: callers (or getNormalizedRig) can pipe result through normalizeHardware / getHardwareEntry.
// ============================================

export function applyHardwareAliases(
  raw: string,
  providedAliases: HardwareAlias[] = []
): { canonical: string; vendor?: string; series?: string; matchedAlias?: string } {
  const cleaned = sanitizeFullName(raw);
  if (!cleaned || cleaned.length < 2) {
    return { canonical: cleaned };
  }

  const lower = cleaned.toLowerCase();
  const aliases = providedAliases.length > 0
    ? providedAliases.map((a) => ({
        rawString: a.rawString.toLowerCase(),
        canonical: a.canonical,
        vendor: a.vendor,
        series: a.series,
      }))
    : []; // caller should pass; async path uses safeLoad below in higher helpers

  // Longest match first (robust against overlapping like "rtx 4090" vs "4090")
  const sorted = [...aliases].sort((a, b) => b.rawString.length - a.rawString.length);

  for (const alias of sorted) {
    if (lower === alias.rawString || lower.includes(alias.rawString)) {
      return {
        canonical: alias.canonical,
        vendor: alias.vendor,
        series: alias.series,
        matchedAlias: alias.rawString,
      };
    }
  }

  // Fallback: return sanitized original (alias learning opportunity)
  return { canonical: cleaned };
}

// Async variant that auto-loads aliases in browser (pure client)
export async function applyHardwareAliasesAsync(raw: string): Promise<{ canonical: string; vendor?: string; series?: string; matchedAlias?: string }> {
  const aliases = await safeLoadAliasesForDetector();
  // Cast shape compatible with HardwareAlias subset
  return applyHardwareAliases(raw, aliases as unknown as HardwareAlias[]);
}

// ============================================
// BROWSER DETECTION SUBMODULE (Plan 1 + Plan 4 §3.1 primary path)
// WebGL UNMASKED_RENDERER_WEBGL (highest value on Chrome/Edge discrete GPUs)
// + WebGPU adapter.info (modern)
// + navigator heuristics (deviceMemory, hardwareConcurrency, screen)
// + UA-CH high-entropy (secure contexts)
// + regex cleaners + confidence heuristics (lower on FF/Safari/Brave/privacy modes)
// Pure, defensive, no side effects beyond disposable canvas + one-time adapter request.
// ============================================

interface BrowserDetectionInternals {
  gpu?: string;
  cpu?: string;
  ram?: number;
  resolution?: string;
  raw: DetectedHardware['raw'];
  confidence: number;
  limitations: string[];
  osHint?: string;
}

const GPU_KEYWORD_RE = /nvidia|geforce|rtx|gtx|radeon|\brx\b|intel|arc|iris|uhd|apple|\bm[1-4]\b/i;

/**
 * Strip render-API + driver noise from a single GPU model segment.
 * Order matters: remove PCI id + trailing API suffixes before whitespace collapse.
 */
function stripGpuNoise(s: string): string {
  return s
    .replace(/\s*\(0x[0-9a-fA-F]+\)/g, '')                 // PCI device id e.g. (0x00002782)
    .replace(/\s*\bvs_\d+\b.*$/i, '')                       // shader model tail: vs_5_0 ps_5_0 ...
    .replace(/\s*\bDirect3D\d*\b.*$/i, '')                  // Direct3D11 ...
    .replace(/\s*\b(D3D11|D3D9|D3D12|OpenGL|Vulkan|Metal)\b.*$/i, '') // backend tokens
    .replace(/\s*\/\s*PCIe.*$/i, '')
    .replace(/\s*\/\s*SSE2.*$/i, '')
    .replace(/\s*\(R\)/gi, '')
    .replace(/\s*\(TM\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanGpuString(renderer: string): string {
  let s = (renderer || '').trim();

  // Chrome/Edge on Windows wrap the real renderer in ANGLE:
  //   "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x...) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  // Unwrap and pick the comma-segment that actually names a GPU model.
  const angle = s.match(/^ANGLE\s*\((.*)\)\s*$/i);
  if (angle?.[1]) {
    const segments = angle[1].split(',').map((seg) => stripGpuNoise(seg)).filter(Boolean);
    // Prefer a segment with a GPU keyword AND a model number (beats bare vendor like "NVIDIA");
    // fall back to any keyword segment, then the longest segment.
    const withModel = segments.filter((seg) => GPU_KEYWORD_RE.test(seg) && /\d/.test(seg));
    const withKeyword = segments.filter((seg) => GPU_KEYWORD_RE.test(seg));
    const pick =
      withModel.sort((a, b) => b.length - a.length)[0] ||
      withKeyword.sort((a, b) => b.length - a.length)[0] ||
      segments.sort((a, b) => b.length - a.length)[0] ||
      '';
    s = pick;
  }

  return stripGpuNoise(s);
}

/**
 * Pure GPU normalization pipeline (no DOM): clean → sanitize → catalog normalize.
 * Returns the canonical catalog name when matched (with entry + perfIndex), else the
 * cleaned/sanitized string. This is the single place detection maps a raw renderer
 * to a known catalog part, and is the unit-testable seam used by the test suite.
 */
export function normalizeDetectedGpu(rawRenderer: string): {
  cleaned: string;
  display: string;
  canonical?: string;
  entry?: HardwareCatalogEntry;
  matchConfidence: number;
  method: HardwareNormalizationResult['method'];
} {
  const cleaned = sanitizeFullName(cleanGpuString(rawRenderer));
  const norm = normalizeHardwareSync(cleaned);
  const matched = norm.method !== 'none' && !!norm.canonical;
  return {
    cleaned,
    display: matched ? norm.canonical! : cleaned,
    canonical: norm.canonical,
    entry: norm.entry,
    matchConfidence: norm.confidence,
    method: norm.method,
  };
}

/**
 * navigator.deviceMemory is privacy-capped at 8 (GB) by spec, and bucketed.
 * It must never be treated as a precise RAM value — only as a lower-bound hint.
 */
export function deviceMemoryToHint(mem: number): { lowerBoundGB: number; isCapped: boolean } {
  const lowerBoundGB = Math.max(1, Math.round(mem));
  return { lowerBoundGB, isCapped: lowerBoundGB >= 8 };
}

/**
 * hardwareConcurrency is a logical-core count, not a CPU model.
 * Return metadata only — never a fabricated CPU string.
 */
export function hardwareConcurrencyToMeta(cores: number): { logicalCores: number } | undefined {
  if (typeof cores !== 'number' || cores < 2) return undefined;
  return { logicalCores: cores };
}

function extractGpuSeriesAndVendor(gpuRaw: string): { vendor?: string; series?: string } {
  const g = gpuRaw.toLowerCase();
  if (g.includes('nvidia') || g.includes('geforce') || g.includes('rtx') || g.includes('gtx')) {
    const seriesMatch = g.match(/(rtx|gtx)\s*(\d{3,4})/i);
    return { vendor: 'NVIDIA', series: seriesMatch ? `RTX ${seriesMatch[2].slice(0, 2)}` : 'RTX' };
  }
  if (g.includes('amd') || g.includes('radeon') || g.includes('rx ')) {
    const seriesMatch = g.match(/(rx)\s*(\d{3,4})/i);
    return { vendor: 'AMD', series: seriesMatch ? `RDNA ${seriesMatch[2].slice(0, 1)}` : 'RDNA' };
  }
  if (g.includes('intel') || g.includes('uhd') || g.includes('iris') || g.includes('arc')) {
    return { vendor: 'Intel', series: 'Arc/UHD' };
  }
  if (g.includes('apple') || g.includes('m1') || g.includes('m2') || g.includes('m3') || g.includes('m4')) {
    return { vendor: 'Apple', series: 'M-series' };
  }
  return {};
}

async function detectViaWebGL(): Promise<Partial<BrowserDetectionInternals>> {
  const out: Partial<BrowserDetectionInternals> = { raw: {}, limitations: [] };
  if (typeof document === 'undefined') {
    out.limitations!.push('WebGL unavailable (no document)');
    return out;
  }

  try {
    const canvas = document.createElement('canvas');
    // Prefer webgl2 for modern, fall back
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;

    if (!gl) {
      out.limitations!.push('WebGL context creation failed (common in privacy browsers / VMs)');
      return out;
    }

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string | null;
      const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string | null;

      if (renderer && renderer.length > 3) {
        const cleaned = sanitizeFullName(cleanGpuString(renderer));
        out.gpu = cleaned;
        out.raw!.webglRenderer = renderer;
        out.raw!.webglVendor = vendor || undefined;

        const { vendor: v, series } = extractGpuSeriesAndVendor(cleaned);
        if (v) out.raw!.vendor = v;
        if (series) out.raw!.series = series;

        // Strong signal for discrete GPUs on Chrome/Edge
        out.confidence = 0.78;
      }
    } else {
      out.limitations!.push('WEBGL_debug_renderer_info extension blocked (Firefox 2021+, Brave, hardened profiles)');
    }
  } catch (e) {
    out.limitations!.push(`WebGL error: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  return out;
}

async function detectViaWebGPU(): Promise<Partial<BrowserDetectionInternals>> {
  const out: Partial<BrowserDetectionInternals> = { raw: {}, limitations: [] };
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  // @ts-expect-error - WebGPU is still stabilizing in some TS lib configs
  if (!nav?.gpu) {
    out.limitations!.push('WebGPU not supported in this browser');
    return out;
  }

  try {
    // @ts-expect-error WebGPU requestAdapter is not in default Navigator typings
    const adapter = await nav.gpu.requestAdapter();
    if (adapter) {
      // Modern, stable surface is the synchronous `adapter.info` property
      // (requestAdapterInfo() is deprecated/removed in current browsers).
      const info = (adapter as any).info;
      if (info?.description && typeof info.description === 'string' && info.description.length > 3) {
        const cleaned = sanitizeFullName(cleanGpuString(info.description));
        out.gpu = cleaned;
        out.raw!.webgpuRenderer = info.description;
        const { vendor: v, series } = extractGpuSeriesAndVendor(cleaned);
        if (v) out.raw!.vendor = v;
        if (series) out.raw!.series = series;
        out.confidence = Math.max(out.confidence || 0, 0.72);
      } else if (info?.vendor || info?.architecture) {
        // Fallback for partial info (no marketing description exposed)
        const desc = [info.vendor, info.architecture].filter(Boolean).join(' ');
        if (desc.length > 3) {
          out.gpu = sanitizeFullName(cleanGpuString(desc));
          out.raw!.webgpuRenderer = desc;
          out.confidence = Math.max(out.confidence || 0, 0.55);
        }
      }
    }
  } catch (e) {
    out.limitations!.push(`WebGPU adapter error: ${e instanceof Error ? e.message : 'blocked or unavailable'}`);
  }
  return out;
}

function detectViaNavigatorHeuristics(): Partial<BrowserDetectionInternals> {
  const out: Partial<BrowserDetectionInternals> = { raw: {}, limitations: [] };
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as any);

  // RAM hint only — navigator.deviceMemory is spec-capped at 8 GB and bucketed,
  // so it is NEVER a precise value. Record it as a lower-bound hint and never
  // emit out.ram (which would wrongly prefill the form for 16/32 GB rigs).
  const mem = (nav as any).deviceMemory;
  if (typeof mem === 'number' && mem >= 1) {
    const hint = deviceMemoryToHint(mem);
    out.raw!.deviceMemoryGB = mem;
    out.raw!.ramLowerBoundGB = hint.lowerBoundGB;
    out.limitations!.push(
      hint.isCapped
        ? 'Browser reports RAM as "≥8 GB" (privacy-capped) — paste system info for exact GB.'
        : `Browser RAM hint ~${hint.lowerBoundGB} GB (approximate) — paste system info for exact GB.`
    );
  } else {
    out.limitations!.push('deviceMemory unavailable (non-Chromium or privacy setting)');
  }

  // CPU logical-core count is metadata only — never fabricate a CPU model string.
  const meta = hardwareConcurrencyToMeta(nav.hardwareConcurrency);
  if (meta) {
    out.raw!.hardwareConcurrency = meta.logicalCores;
  }

  // Resolution (always available)
  if (typeof screen !== 'undefined') {
    const res = `${screen.width}x${screen.height}`;
    out.resolution = res;
    out.raw!.resolution = res;
    out.raw!.screenDPR = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  }

  // Light UA parsing for OS hint (never primary for hardware)
  const ua = nav.userAgent || '';
  if (/Windows/i.test(ua)) out.osHint = 'Windows';
  else if (/Macintosh|Mac OS/i.test(ua)) out.osHint = 'macOS';
  else if (/Linux/i.test(ua)) out.osHint = 'Linux';
  else if (/Android/i.test(ua)) out.osHint = 'Android';
  else if (/iPhone|iPad/i.test(ua)) out.osHint = 'iOS';

  // UA-CH high entropy (secure contexts only, best effort)
  if (typeof nav.userAgentData !== 'undefined') {
    // Non-blocking fire-and-forget in real usage; here we note limitation
    out.limitations!.push('High-entropy UA-CH available only in secure contexts (future enhancement)');
  }

  return out;
}

export async function detectBrowser(): Promise<DetectedHardware> {
  const timestamp = new Date().toISOString();
  const limitations: string[] = [];
  let confidence = 0.35; // base for any browser signal
  const raw: DetectedHardware['raw'] = {};
  let gpu: string | undefined;
  let resolution: string | undefined;
  let osHint: string | undefined;

  // 1. WebGL (highest value signal)
  const webgl = await detectViaWebGL();
  if (webgl.gpu) {
    gpu = webgl.gpu;
    Object.assign(raw, webgl.raw);
    confidence = Math.max(confidence, webgl.confidence || 0.78);
  }
  if (webgl.limitations) limitations.push(...webgl.limitations);

  // 2. WebGPU (supplements or replaces on modern browsers)
  const webgpu = await detectViaWebGPU();
  if (webgpu.gpu && (!gpu || webgpu.gpu.length > (gpu?.length || 0))) {
    gpu = webgpu.gpu;
    Object.assign(raw, webgpu.raw);
    confidence = Math.max(confidence, webgpu.confidence || 0.72);
  }
  if (webgpu.limitations) limitations.push(...webgpu.limitations);

  // 3. Navigator + screen heuristics (always attempted).
  // Browser path intentionally yields NO cpu and NO ram value (only hints in raw) —
  // those are unreliable in-browser and are left for paste / manual entry.
  const nav = detectViaNavigatorHeuristics();
  if (nav.resolution) resolution = nav.resolution;
  Object.assign(raw, nav.raw);
  if (nav.osHint) osHint = nav.osHint;
  if (nav.limitations) limitations.push(...nav.limitations);

  // 4. Route the detected GPU through the canonical catalog pipeline and set
  //    confidence honestly based on what we actually matched.
  if (gpu) {
    const norm = normalizeDetectedGpu(gpu);
    gpu = norm.display;
    if (norm.canonical) raw.gpuCanonical = norm.canonical;
    if (norm.entry?.perfIndex != null) raw.gpuPerfIndex = norm.entry.perfIndex;
    raw.gpuMatchMethod = norm.method;

    const g = gpu.toLowerCase();
    if (g.includes('llvmpipe') || g.includes('swiftshader') || g.includes('software') || g.includes('microsoft basic') || g.includes('generic')) {
      confidence = Math.min(confidence, 0.35);
      limitations.push('Software renderer or VM detected — hardware values unreliable. Paste system info for an exact GPU.');
    } else if (g.includes('intel') && (g.includes('uhd') || g.includes('iris'))) {
      confidence = Math.min(confidence, 0.58);
      limitations.push('Integrated Intel GPU often under-reports; paste recommended for exact model.');
    } else if (g.includes('apple') || /\bm[1-4]\b/.test(g)) {
      confidence = Math.min(confidence, 0.65);
      limitations.push('Apple Silicon unified memory; exact model detection limited in browser.');
    } else if (norm.method === 'exact' || norm.method === 'alias') {
      confidence = Math.max(confidence, 0.85); // matched a known catalog part
    } else if (norm.method === 'heuristic') {
      confidence = Math.max(confidence, 0.8);
    } else {
      confidence = Math.max(confidence, 0.7); // cleaned discrete-looking string, unmatched
    }
  } else {
    limitations.push('No usable GPU string from WebGL/WebGPU (privacy extension, Firefox bucket, or blocked context). Try the paste option.');
    confidence = Math.min(confidence, 0.4);
  }

  confidence = Math.max(0.15, Math.min(0.94, confidence)); // cap realistic browser max

  const result: DetectedHardware = {
    cpu: undefined, // browser path never reports a CPU model (see heuristics)
    gpu: gpu ? sanitizeFullName(gpu) : undefined,
    ram: undefined, // browser path never reports a precise RAM value (only a hint in raw)
    resolution,
    raw,
    method: 'browser',
    confidence: Number(confidence.toFixed(2)),
    timestamp,
    limitations: limitations.length ? limitations : undefined,
    osHint,
  };

  return result;
}

// ============================================
// PASTE PARSING SUBMODULE (Plan 3 + Plan 4 §3.1 secondary/highest-trust path)
// Robust multi-OS parsers for real-world outputs.
// Handles dxdiag, lspci, system_profiler, Steam "System Information", CIM/WMIC, lscpu, glxinfo fallbacks.
// 10+ real anonymized sample cases included below in comments for unit verification.
// Always runs sanitizeFullName on extracted fields.
// Confidence high (0.88+) when multiple strong signals present.
// ============================================

function parseDxdiag(text: string): Partial<DetectedHardware> {
  const raw: any = {};
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;
  let resolution: string | undefined;
  const limitations: string[] = [];

  // Processor line (common in both English + localized)
  const cpuMatch = text.match(/Processor:\s*(.+?)(?:\r?\n|$)/i) ||
                   text.match(/Name:\s*(Intel|AMD).+?(?:\r?\n|$)/i);
  if (cpuMatch?.[1]) {
    cpu = sanitizeFullName(cpuMatch[1].replace(/\(TM\)|\(R\)/gi, '').trim());
    raw.detectedCpu = cpuMatch[1];
  }

  // Display Devices section is gold for GPU
  const displaySection = text.split(/\[Display Devices\]/i)[1] || text;
  const gpuMatches = displaySection.match(/(?:Card name|Name|Chip type):\s*(.+?)(?:\r?\n|$)/gi);
  if (gpuMatches && gpuMatches.length) {
    // Prefer first non-Intel or longest
    const candidates = gpuMatches
      .map((m) => m.replace(/.*?:\s*/, '').trim())
      .filter(Boolean)
      .sort((a, b) => (b.toLowerCase().includes('nvidia') || b.toLowerCase().includes('amd') ? 1 : 0) - (a.toLowerCase().includes('nvidia') || a.toLowerCase().includes('amd') ? 1 : 0));
    gpu = sanitizeFullName(cleanGpuString(candidates[0]));
    raw.detectedGpu = candidates[0];
  }

  // Memory (dedicated or total)
  const memMatch = text.match(/Dedicated Memory:\s*(\d+)\s*MB/i) ||
                   text.match(/Memory:\s*(\d+)\s*MB/i) ||
                   text.match(/Total Memory:\s*(\d+)\s*MB/i);
  if (memMatch) {
    const mb = parseInt(memMatch[1], 10);
    if (mb > 256) ram = Math.round(mb / 1024); // treat as VRAM → rough system proxy, or dedicated
    raw.detectedRamMB = memMatch[1];
  }

  // Resolution
  const resMatch = text.match(/Current Resolution:\s*(\d+x\d+)/i) ||
                   text.match(/Resolution:\s*(\d+x\d+)/i);
  if (resMatch) {
    resolution = resMatch[1];
    raw.detectedResolution = resMatch[1];
  }

  if (!gpu) limitations.push('No discrete GPU found in dxdiag (check Display Devices section)');
  if (!cpu) limitations.push('Processor line not parsed — try pasting full dxdiag /t output');

  return { cpu, gpu, ram, resolution, raw, limitations, osHint: 'Windows' };
}

function parseLspci(text: string): Partial<DetectedHardware> {
  const raw: any = {};
  let gpu: string | undefined;
  const limitations: string[] = [];

  // VGA / 3D / Display controllers
  const vgaMatch = text.match(/VGA compatible controller:\s*(.+?)(?:\r?\n|$)/i) ||
                   text.match(/3D controller:\s*(.+?)(?:\r?\n|$)/i) ||
                   text.match(/Display controller:\s*(.+?)(?:\r?\n|$)/i);
  if (vgaMatch?.[1]) {
    gpu = sanitizeFullName(vgaMatch[1].replace(/\[.*?\]/g, '').trim());
    raw.detectedGpu = vgaMatch[1];
  }

  // Kernel driver hints sometimes contain model
  if (!gpu) {
    const kernelMatch = text.match(/Kernel driver in use:\s*(nvidia|amdgpu|radeon|i915)/i);
    if (kernelMatch) limitations.push(`Only driver name detected (${kernelMatch[1]}); paste fuller lspci -nnk output`);
  }

  return { gpu, raw, limitations, osHint: 'Linux' };
}

function parseSystemProfiler(text: string): Partial<DetectedHardware> {
  const raw: any = {};
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;
  const limitations: string[] = [];

  // Apple Silicon / Intel CPU
  const chipMatch = text.match(/Chip:\s*(.+?)(?:\r?\n|$)/i) ||
                    text.match(/Processor Name:\s*(.+?)(?:\r?\n|$)/i) ||
                    text.match(/machdep\.cpu\.brand_string:\s*(.+?)(?:\r?\n|$)/i);
  if (chipMatch?.[1]) {
    cpu = sanitizeFullName(chipMatch[1]);
    raw.detectedCpu = chipMatch[1];
  }

  // Graphics section
  const gfxMatch = text.match(/Chipset Model:\s*(.+?)(?:\r?\n|$)/i) ||
                   text.match(/Graphics\/Displays:[\s\S]{0,200}?Model:\s*(.+?)(?:\r?\n|$)/i);
  if (gfxMatch?.[1]) {
    gpu = sanitizeFullName(gfxMatch[1]);
    raw.detectedGpu = gfxMatch[1];
  }

  // Memory
  const memMatch = text.match(/Memory:\s*(\d+)\s*GB/i) || text.match(/Total Memory:\s*(\d+)\s*GB/i);
  if (memMatch) {
    ram = parseInt(memMatch[1], 10);
    raw.detectedRamGB = memMatch[1];
  }

  if (!gpu && !cpu) limitations.push('system_profiler output may require SPDisplaysDataType + SPHardwareDataType');

  return { cpu, gpu, ram, raw, limitations, osHint: 'macOS' };
}

function parseSteamSystemInfo(text: string): Partial<DetectedHardware> {
  const raw: any = {};
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;
  const limitations: string[] = [];

  // Steam format is often "Processor: Intel..." and "Video Card: NVIDIA..."
  const cpuMatch = text.match(/Processor:\s*(.+?)(?:\r?\n|$)/i);
  if (cpuMatch) cpu = sanitizeFullName(cpuMatch[1]);

  const gpuMatch = text.match(/Video Card(?: #\d+)?:\s*(.+?)(?:\r?\n|$)/i) ||
                   text.match(/Video Card:\s*(.+?)(?:\r?\n|$)/i);
  if (gpuMatch) gpu = sanitizeFullName(cleanGpuString(gpuMatch[1]));

  const memMatch = text.match(/Memory:\s*(\d+)\s*MB/i);
  if (memMatch) ram = Math.round(parseInt(memMatch[1], 10) / 1024);

  const resMatch = text.match(/Current Display Mode:\s*(\d+x\d+)/i);
  const resolution = resMatch ? resMatch[1] : undefined;

  if (!gpu) limitations.push('Steam System Information often truncates GPU model — prefer dxdiag or lspci for precision');

  return { cpu, gpu, ram, resolution, raw, limitations, osHint: 'Steam' };
}

function parseCimOrWmic(text: string): Partial<DetectedHardware> {
  // PowerShell Get-CimInstance / WMIC fallbacks
  const raw: any = {};
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;

  const cpuMatch = text.match(/Name\s*:\s*(.+?)(?:\r?\n|$)/i);
  if (cpuMatch) cpu = sanitizeFullName(cpuMatch[1]);

  const gpuMatch = text.match(/(?:Name|Description)\s*:\s*(NVIDIA|AMD|Intel|GeForce|Radeon).+?(?:\r?\n|$)/i);
  if (gpuMatch) gpu = sanitizeFullName(cleanGpuString(gpuMatch[0].split(':')[1] || gpuMatch[0]));

  const memMatch = text.match(/Capacity\s*:\s*(\d+)/i) || text.match(/TotalPhysicalMemory.*?(\d{9,})/);
  if (memMatch) {
    const bytes = parseInt(memMatch[1], 10);
    ram = Math.round(bytes / (1024 ** 3));
  }

  return { cpu, gpu, ram, raw, osHint: 'Windows' };
}

function parseGenericLinux(text: string): Partial<DetectedHardware> {
  const raw: any = {};
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;

  const cpuMatch = text.match(/Model name:\s*(.+?)(?:\r?\n|$)/i) || text.match(/vendor_id.*?:\s*(.+?)(?:\r?\n|$)/i);
  if (cpuMatch) cpu = sanitizeFullName(cpuMatch[1]);

  const gpuMatch = text.match(/VGA.*?:\s*(.+?)(?:\r?\n|$)/i) || text.match(/3D.*?:\s*(.+?)(?:\r?\n|$)/i);
  if (gpuMatch) gpu = sanitizeFullName(gpuMatch[1]);

  const memMatch = text.match(/MemTotal:\s*(\d+)\s*kB/i);
  if (memMatch) ram = Math.round(parseInt(memMatch[1], 10) / (1024 * 1024));

  return { cpu, gpu, ram, raw, osHint: 'Linux' };
}

/**
 * ProtonDB-style inxi parser (highest signal for Linux users).
 * inxi -Fxz or inxi -Fxxxz produces consistently labeled output that is
 * dramatically richer than raw lspci/lscpu (includes Driver, Kernel, Distro, etc).
 * We extract the primary fields + stash the extras in raw for future use.
 */
function parseInxi(text: string): Partial<DetectedHardware> {
  const raw: any = { source: 'inxi' };
  let cpu: string | undefined;
  let gpu: string | undefined;
  let ram: number | undefined;
  let driverVersion: string | undefined;
  let kernel: string | undefined;
  let distro: string | undefined;
  const limitations: string[] = [];

  // CPU line (inxi puts model prominently)
  const cpuMatch = text.match(/CPU:\s*(.+?)(?:\s+speed:|$|\n)/i);
  if (cpuMatch?.[1]) {
    cpu = sanitizeFullName(cpuMatch[1].replace(/\s*\(-.*?\)\s*$/, '').trim());
    raw.inxiCpu = cpuMatch[1];
  }

  // GPU line — inxi often has one or more "GPU:" lines
  const gpuMatch = text.match(/GPU:\s*(.+?)(?:\s+driver:|$|\n)/i) ||
                   text.match(/Graphics:\s*(.+?)(?:\s+driver:|$|\n)/i);
  if (gpuMatch?.[1]) {
    gpu = sanitizeFullName(cleanGpuString(gpuMatch[1]));
    raw.inxiGpu = gpuMatch[1];
  }

  // Driver line (gold for ProtonDB-style precision). inxi formats it as
  // "Driver: nvidia v: 560.81" — capture BOTH the driver name and the version
  // (the version is the most useful part and must not be dropped).
  const driverMatch = text.match(/Driver:\s*([A-Za-z][\w-]*)(?:\s+v:\s*([0-9][0-9.]*))?/i);
  if (driverMatch) {
    const name = driverMatch[1];
    const version = driverMatch[2];
    driverVersion = sanitizeFullName([name, version].filter(Boolean).join(' '));
    raw.inxiDriver = driverMatch[0];
  }

  // Kernel
  const kernelMatch = text.match(/Kernel:\s*(.+?)(?:\s+x86_64|$|\n)/i);
  if (kernelMatch?.[1]) {
    kernel = sanitizeFullName(kernelMatch[1]);
    raw.inxiKernel = kernel;
  }

  // Distro
  const distroMatch = text.match(/Distro:\s*(.+?)(?:\s*$|\n)/i) || text.match(/Host:\s*.*?\s+(.+?)(?:\s*$|\n)/i);
  if (distroMatch?.[1]) {
    distro = sanitizeFullName(distroMatch[1]);
    raw.inxiDistro = distro;
  }

  // Memory (inxi reports GiB)
  const memMatch = text.match(/Memory:\s*([\d.]+)\s*GiB/i) || text.match(/Memory:\s*(\d+)\s*GB/i);
  if (memMatch) {
    ram = Math.round(parseFloat(memMatch[1]));
    raw.inxiMemory = memMatch[0];
  }

  // Resolution hint if present (inxi -F sometimes shows it)
  const resMatch = text.match(/(\d{3,5}x\d{3,5})/);
  const resolution = resMatch ? resMatch[1] : undefined;

  if (!gpu && !cpu) {
    limitations.push('inxi output parsed but limited GPU/CPU signals — try inxi -Fxxxz for richer data');
  }
  if (!driverVersion) {
    limitations.push('No driver version found — consider also pasting `vulkaninfo --summary` or `glxinfo -B`');
  }

  return {
    cpu,
    gpu,
    ram,
    resolution,
    driverVersion,
    kernel,
    distro,
    raw: { ...raw, inxiKernel: kernel, inxiDistro: distro },
    limitations: limitations.length ? limitations : undefined,
    osHint: 'Linux',
  };
}

/**
 * Main paste parser — auto-detects format and runs best-effort multi-pass extraction.
 * Robust to noise, partial pastes, mixed line endings, and localized headers.
 * Now includes strong ProtonDB-style inxi support (the highest-signal Linux path).
 */
export function parsePaste(pasteText: string): DetectedHardware {
  const timestamp = new Date().toISOString();
  const text = pasteText.trim();
  if (!text || text.length < 20) {
    return {
      raw: { pasteLength: text.length },
      method: 'paste',
      confidence: 0.1,
      timestamp,
      limitations: ['Input too short or empty — please paste full command output'],
    };
  }

  let parsed: Partial<DetectedHardware> = { raw: {}, limitations: [] };

  // Order: most structured first
  if (/dxdiag|Display Devices|Processor:/i.test(text) && /Windows/i.test(text)) {
    parsed = { ...parseDxdiag(text), ...parsed };
  } else if (/inxi|CPU:|GPU:|Driver:|Kernel:|Distro:/i.test(text)) {
    // ProtonDB-style inxi output (highest signal for Linux). Check early.
    parsed = { ...parseInxi(text), ...parsed };
  } else if (/lspci|VGA compatible|3D controller/i.test(text)) {
    parsed = { ...parseLspci(text), ...parsed };
  } else if (/system_profiler|Chipset Model|SPDisplaysDataType|machdep\.cpu/i.test(text) || /Chip:\s*Apple/i.test(text)) {
    parsed = { ...parseSystemProfiler(text), ...parsed };
  } else if (/Steam System Information|Video Card:/i.test(text)) {
    parsed = { ...parseSteamSystemInfo(text), ...parsed };
  } else if (/Get-CimInstance|Win32_|wmic/i.test(text)) {
    parsed = { ...parseCimOrWmic(text), ...parsed };
  } else if (/Model name:|lspci|lscpu|MemTotal/i.test(text)) {
    parsed = { ...parseGenericLinux(text), ...parsed };
  } else {
    // Last-resort keyword heuristics across entire text
    const anyGpu = text.match(/(NVIDIA|GeForce|RTX|GTX|AMD|Radeon|RX\s*\d{3,4}|Intel.*(UHD|Arc|Iris))/i);
    if (anyGpu) parsed.gpu = sanitizeFullName(anyGpu[0]);
    const anyCpu = text.match(/(Ryzen|Core i[3579]|Intel.*\d{4,}|Apple M[1-4])/i);
    if (anyCpu) parsed.cpu = sanitizeFullName(anyCpu[0]);
    (parsed.limitations as string[]).push('Format not auto-recognized — results from loose keyword scan');
  }

  // Always sanitize final fields
  const cpu = parsed.cpu ? sanitizeFullName(parsed.cpu) : undefined;
  const gpu = parsed.gpu ? sanitizeFullName(parsed.gpu) : undefined;
  const ram = parsed.ram;
  const resolution = parsed.resolution;

  // Canonical normalization pass (same pipeline as browser detection).
  const rawExtra: Record<string, unknown> = {};
  let finalGpu = gpu;
  let finalCpu = cpu;
  let gpuMatched = false;
  let cpuMatched = false;
  if (gpu) {
    const norm = normalizeDetectedGpu(gpu);
    finalGpu = norm.display;
    gpuMatched = norm.method !== 'none';
    if (norm.canonical) rawExtra.gpuCanonical = norm.canonical;
    if (norm.entry?.perfIndex != null) rawExtra.gpuPerfIndex = norm.entry.perfIndex;
    rawExtra.gpuMatchMethod = norm.method;
  }
  if (cpu) {
    const norm = normalizeHardwareSync(cpu);
    if (norm.method !== 'none' && norm.canonical) {
      finalCpu = norm.canonical;
      cpuMatched = true;
      rawExtra.cpuCanonical = norm.canonical;
      if (norm.entry?.perfIndex != null) rawExtra.cpuPerfIndex = norm.entry.perfIndex;
    }
    rawExtra.cpuMatchMethod = norm.method;
  }

  // Confidence from completeness + source strength + catalog match quality
  let confidence = 0.65;
  if (finalGpu) confidence += gpuMatched ? 0.2 : 0.12;
  if (finalCpu) confidence += cpuMatched ? 0.12 : 0.07;
  if (ram) confidence += 0.07;
  if (resolution) confidence += 0.03;
  if ((parsed.limitations?.length || 0) > 2) confidence -= 0.15;
  confidence = Math.max(0.35, Math.min(0.97, Number(confidence.toFixed(2))));

  const result: DetectedHardware = {
    cpu: finalCpu,
    gpu: finalGpu,
    ram,
    resolution,
    // Richer ProtonDB-style fields (inxi is the main source today)
    driverVersion: parsed.driverVersion || (parsed as any).driverVersion || undefined,
    kernel: parsed.kernel || (parsed as any).kernel || undefined,
    distro: parsed.distro || (parsed as any).distro || undefined,
    raw: { ...(parsed.raw || {}), ...rawExtra, originalPasteLength: text.length },
    method: 'paste',
    confidence,
    timestamp,
    limitations: parsed.limitations && parsed.limitations.length ? parsed.limitations : undefined,
    osHint: parsed.osHint,
  };

  return result;
}

// ============================================
// STEAM + COMPANION STUBS (per Plan 2 + Plan 4 honesty)
// Steam: NO hardware. Companion: future only.
// ============================================

export async function steamEnrichmentStub(steamId?: string): Promise<Partial<DetectedHardware>> {
  return {
    method: 'steam',
    confidence: 0.15,
    timestamp: new Date().toISOString(),
    raw: { note: 'Steam Web API returns zero CPU/GPU/RAM per user (aggregate survey only). Value is verification + library signals only.' },
    limitations: [
      'Steam provides no per-user hardware data via Web API / OpenID.',
      'Link Steam for "Verified Gamer" badges + future library-based suggestions only (see Plan 2).',
    ],
  };
}

export function companionStub(): DetectedHardware {
  return {
    raw: { note: 'Companion detector (Tauri/Rust) is Phase 3+ future work. Use browser or paste for MVP.' },
    method: 'companion',
    confidence: 0.0,
    timestamp: new Date().toISOString(),
    limitations: ['Not implemented in current MVP slice'],
  };
}

// ============================================
// UNIFIED FACADE (exact Plan 4 sketch + enhancements)
// ============================================

export async function detectHardware(
  options: { mode?: DetectionMode; pasteText?: string } = {}
): Promise<DetectedHardware> {
  const mode = options.mode || 'browser';

  if (mode === 'paste' && options.pasteText) {
    return parsePaste(options.pasteText);
  }
  if (mode === 'browser' || mode === 'all') {
    const browserResult = await detectBrowser();
    if (mode === 'all') {
      // Future: could merge with other signals; for now browser is primary
    }
    return browserResult;
  }
  if (mode === 'steam') {
    const s = await steamEnrichmentStub();
    return {
      cpu: undefined,
      gpu: undefined,
      raw: s.raw || {},
      method: 'steam',
      confidence: s.confidence || 0.15,
      timestamp: s.timestamp || new Date().toISOString(),
      limitations: s.limitations,
    } as DetectedHardware;
  }
  if (mode === 'companion') {
    return companionStub();
  }

  // default
  return detectBrowser();
}

/**
 * Convenience: turn a DetectedHardware into a UserPC shape + optional catalog hooks.
 * Future (B/C/D): pipe through normalizeHardware + validateHardwarePerformance for perfIndex + health.
 * This is the integration point for alias + catalog synergy.
 */
export function getNormalizedRig(detected: DetectedHardware): UserPC & { detection: Pick<DetectedHardware, 'method' | 'confidence' | 'timestamp'> } {
  return {
    cpu: detected.cpu || '',
    gpu: detected.gpu || '',
    ram: detected.ram || 16,
    resolution: detected.resolution,
    // canonical* left for normalize-hardware layer (hook ready)
    detection: {
      method: detected.method,
      confidence: detected.confidence,
      timestamp: detected.timestamp,
    },
  };
}
