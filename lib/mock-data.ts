/**
 * RunDB Mock Data Layer
 *
 * 18 popular games (real metadata).
 *
 * Report persistence (demo mode):
 * - A small set of realistic *seed* reports is included so /reports (advanced browser), home trending/recent/stats,
 *   game detail report lists, and filters have useful data on first load / for demos/screenshots.
 * - Real user submissions (via submit dialog) are saved to localStorage and appear on top of seeds.
 * - Real mode (NEXT_PUBLIC_USE_REAL_DATA=true): only live Supabase data (no seeds).
 *
 * Games + pure helpers remain for offline/dev use.
 */

import {
  Game,
  Report,
  UserPC,
  PerformanceTier,
  GraphicsPreset,
  GameStats,
  ReportFilters,
  PredictionResult,
  ReportStatus,
  HardwareAlias,
  AdminReport,
  ReportImage,
  BulkImportResult,
  MAIN_RESOLUTIONS,
  MainResolution,
} from './types';
import { normalizeSlug } from './utils';

// Shared pure helpers (also used by lib/data.ts real paths) — moved to data-logic.ts
import {
  filterReports,
  predictForUserRigFromReports,
  computeGameStatsFromReports,
} from './data-logic';
export {
  filterReports,
  predictForUserRigFromReports,
  computeGameStatsFromReports,
  formatRelativeTime,
  parseCSV,
} from './data-logic';

// Agent 5 / PR 5 Public API Resilience Layer integration note (demo seeds):
// The cached resolver (lib/game-id-resolver) is the single source for Steam AppID + fallbacks.
// Bulk import (below) and admin seeding flows now accept pre-enriched rows containing steamAppId/igdbId + externalIdAttribution.
// Callers (e.g. future async admin action or scripts) should do:
//   import { enrichGameWithExternalIds, resolveManyGameExternalIds } from '@/lib/game-id-resolver';
//   const enriched = await Promise.all(rows.map(enrichGameWithExternalIds));
// Then pass to bulkImportGames. Attribution is stored on the resulting Game objects.
// This keeps mock-data pure/sync while enabling full resolver usage for seeds + runtime.

// ============================================
// GAMES — canonical starter catalog (moved to starter-games.ts; re-exported for compat)
// ============================================

import { GAMES } from './starter-games';
export { GAMES } from './starter-games';

// ============================================
// DEMO SEED REPORTS (for !USE_REAL / demo mode UX)
// ~45 realistic reports across the 18 games. Enough to populate the /reports browser
// with the nice banner rows, exercise all filters (GPU series, tier, min FPS), show
// recent reports on home, drive trending, and make stats non-zero.
// User submissions in demo are additive (localStorage).
// Real mode ignores these entirely and uses only Supabase.
// ============================================

const SAMPLE_GPUS = [
  'RTX 4090', 'RTX 4080 Super', 'RTX 4070 Ti', 'RTX 4070', 'RTX 4060 Ti', 'RTX 3060 Ti', 'RTX 3070',
  'RX 7900 XTX', 'RX 7800 XT', 'RX 6800 XT', 'RX 6700 XT', 'Arc A770', 'RTX 2080 Ti', 'RTX 3080',
  'RX 9070 XT', 'RTX 5070', 'RX 9060 XT', 'RTX 5060 Ti'
];
const SAMPLE_CPUS = [
  'Ryzen 7 7800X3D', 'Ryzen 5 7600X', 'Intel Core i7-14700K', 'Intel Core i5-13600K',
  'Ryzen 7 5800X3D', 'Intel Core i9-12900K', 'Ryzen 5 5600X',
  'Ryzen 7 5700X3D', 'Ryzen 9 9950X3D', 'Intel Core Ultra 7 265K'
];
const RESOLUTIONS: readonly MainResolution[] = MAIN_RESOLUTIONS;
const PRESETS: GraphicsPreset[] = ['Low', 'Medium', 'High', 'Ultra', 'Custom'];

function generateSeedReports(): Report[] {
  const reports: Report[] = [];
  let idCounter = 1001;

  for (let gi = 0; gi < GAMES.length; gi++) {
    const game = GAMES[gi];
    // 2–4 reports per game for nice distribution in the reports browser
    const num = 2 + (gi % 3);
    for (let i = 0; i < num; i++) {
      const gpu = SAMPLE_GPUS[(gi + i * 2) % SAMPLE_GPUS.length];
      const cpu = SAMPLE_CPUS[(gi + i) % SAMPLE_CPUS.length];
      const resolution = RESOLUTIONS[i % RESOLUTIONS.length];
      const preset = PRESETS[(gi + i) % PRESETS.length];

      // Rough FPS model so tiers + filters feel real
      let fps = 48 + ((gi * 5 + i * 9) % 70);
      if (gpu.includes('4090') || gpu.includes('7900') || gpu.includes('9070') || gpu.includes('5090')) fps += 22;
      if (gpu.includes('3060') || gpu.includes('6700')) fps -= 8;
      if (resolution === '3840x2160') fps -= 28;
      if (preset === 'Low') fps += 18;
      if (preset === 'Ultra') fps -= 12;
      if (preset === 'Custom') fps += 4;

      const avgFps = Math.max(23, Math.min(158, Math.round(fps + (i - 1) * 2.5)));
      let tier: PerformanceTier;
      if (avgFps >= 105) tier = 'Excellent';
      else if (avgFps >= 72) tier = 'Good';
      else if (avgFps >= 52) tier = 'Playable';
      else if (avgFps >= 36) tier = 'Struggling';
      else tier = 'Unplayable';

      const daysAgo = 2 + ((gi * 3 + i * 2) % 38);
      const createdAt = new Date(Date.now() - daysAgo * 86400000 - i * 3900000).toISOString();

      reports.push({
        id: `seed-${idCounter++}`,
        gameId: game.id,
        gameName: game.name,
        cpu,
        gpu,
        ram: [16, 32, 32, 64][i % 4],
        ramSpeed: i % 2 === 0 ? 'DDR5-6000' : 'DDR4-3200',
        resolution,
        refreshRate: resolution === '3840x2160' ? 60 : (gpu.includes('4090') ? 165 : 144),
        settingsPreset: preset,
        customSettingsNotes: preset === 'Custom' ? 'DLSS Quality, RT Medium, FG on' : undefined,
        avgFps,
        fps1PercentLow: Math.max(18, Math.round(avgFps * (0.68 + (i % 3) * 0.04))),
        performanceTier: tier,
        notes: i % 5 === 0 ? 'Rock solid after driver update' : undefined,
        tweaks: i % 3 === 0 ? 'Curve optimizer + fast RAM timings' : undefined,
        issues: avgFps < 38 ? 'Occasional shader stutter in new areas' : undefined,
        driverVersion: '551.86',
        createdAt,
        helpfulVotes: Math.floor(Math.random() * 7) + (avgFps > 85 ? 2 : 0),
      });
    }
  }
  return reports;
}

const SEED_REPORTS: Report[] = generateSeedReports();
const EXTRA_REPORTS: Report[] = [];
const ALL_SEED_REPORTS: Report[] = [...SEED_REPORTS, ...EXTRA_REPORTS];

// ============================================
// LOCALSTORAGE PERSISTENCE (demo only)
// ============================================

const LS_USER_REPORTS = 'rundb_user_reports';
const LS_MY_RIG = 'rundb_my_rig';
const LS_MODERATION = 'rundb_moderation_overrides';
const LS_HARDWARE_ALIASES = 'rundb_hardware_aliases';
const LS_IMPORTED_GAMES = 'rundb_imported_games';
const LS_REPORT_IMAGES = 'rundb_report_images';

export function loadUserReports(): Report[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_USER_REPORTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUserReports(reports: Report[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_USER_REPORTS, JSON.stringify(reports));
}

export function addUserReport(report: Omit<Report, 'id' | 'createdAt' | 'helpfulVotes'>): Report {
  const userReports = loadUserReports();
  const newReport: Report = {
    ...report,
    id: `user_${Date.now()}`,
    createdAt: new Date().toISOString(),
    helpfulVotes: 0,
    downvoteVotes: 0,
    voteScore: 0,
    credibilityBadge: 'New',
    status: 'approved',
  };
  const updated = [newReport, ...userReports];
  saveUserReports(updated);
  return newReport;
}

export function loadMyRig(): UserPC | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_MY_RIG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveMyRig(rig: UserPC) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_MY_RIG, JSON.stringify(rig));
}

export function clearMyRig() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_MY_RIG);
}

// Phase 2 mock multi-device support (demo only)
export function loadUserDevices(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('rundb_user_devices');
    return raw ? JSON.parse(raw) : [
      { id: 'demo1', label: 'Desktop RTX 4080', cpu: 'AMD Ryzen 7 7800X3D', gpu: 'NVIDIA GeForce RTX 4080', ram: 32, resolution: '2560x1440', isPrimary: true },
      { id: 'demo2', label: 'Laptop 4070', cpu: 'Intel Core i7-13700H', gpu: 'NVIDIA GeForce RTX 4070', ram: 16, resolution: '1920x1200', isPrimary: false },
    ];
  } catch { return []; }
}

export function saveUserDevice(device: any) {
  if (typeof window === 'undefined') return;
  const devices = loadUserDevices();
  const idx = devices.findIndex(d => d.id === device.id);
  if (idx >= 0) devices[idx] = { ...devices[idx], ...device };
  else devices.push({ ...device, id: device.id || 'dev_' + Date.now() });
  localStorage.setItem('rundb_user_devices', JSON.stringify(devices));
}

export function deleteUserDevice(id: string) {
  if (typeof window === 'undefined') return;
  const devices = loadUserDevices().filter(d => d.id !== id);
  localStorage.setItem('rundb_user_devices', JSON.stringify(devices));
}

// Steam link mock (for !USE_REAL parity)
const LS_STEAM_LINK = 'rundb_steam_link';

export function loadSteamLink(): any {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_STEAM_LINK);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveSteamLink(link: any) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_STEAM_LINK, JSON.stringify({ ...link, linkedAt: new Date().toISOString() }));
}

export function clearSteamLink() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LS_STEAM_LINK);
}

// ============================================
// ADMIN STATE (localStorage for Phase 4 demo)
// ============================================

function loadModerationOverrides(): Record<string, { status: ReportStatus; moderatorNotes?: string; moderatedAt?: string; moderatedBy?: string }> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_MODERATION);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveModerationOverrides(overrides: Record<string, any>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_MODERATION, JSON.stringify(overrides));
}

export function loadHardwareAliases(): HardwareAlias[] {
  if (typeof window === 'undefined') return getDefaultHardwareAliases();
  try {
    const raw = localStorage.getItem(LS_HARDWARE_ALIASES);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Seed defaults on first access
  const seeded = getDefaultHardwareAliases();
  saveHardwareAliases(seeded);
  return seeded;
}

function saveHardwareAliases(aliases: HardwareAlias[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_HARDWARE_ALIASES, JSON.stringify(aliases));
}

function getDefaultHardwareAliases(): HardwareAlias[] {
  const now = new Date().toISOString();
  return [
    { id: 'ha1', rawString: 'rtx 4090', canonical: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA', series: 'RTX 40', createdAt: now },
    { id: 'ha2', rawString: '4090', canonical: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA', series: 'RTX 40', createdAt: now },
    { id: 'ha3', rawString: 'rtx4090', canonical: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA', series: 'RTX 40', createdAt: now },
    { id: 'ha4', rawString: 'rx 7900 xtx', canonical: 'AMD Radeon RX 7900 XTX', vendor: 'AMD', series: 'RDNA3', createdAt: now },
    { id: 'ha5', rawString: 'i9-14900k', canonical: 'Intel Core i9-14900K', vendor: 'Intel', series: 'Raptor Lake', createdAt: now },
    { id: 'ha6', rawString: 'ryzen 7 7800x3d', canonical: 'AMD Ryzen 7 7800X3D', vendor: 'AMD', series: 'Zen 4', createdAt: now },
  ];
}

export function loadImportedGames(): Game[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_IMPORTED_GAMES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveImportedGames(games: Game[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_IMPORTED_GAMES, JSON.stringify(games));
}

export function loadReportImages(): ReportImage[] {
  if (typeof window === 'undefined') return getDefaultReportImages();
  try {
    const raw = localStorage.getItem(LS_REPORT_IMAGES);
    if (raw) return JSON.parse(raw);
  } catch {}
  const seeded = getDefaultReportImages();
  saveReportImages(seeded);
  return seeded;
}

function saveReportImages(images: ReportImage[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LS_REPORT_IMAGES, JSON.stringify(images));
}

function getDefaultReportImages(): ReportImage[] {
  // No seed images — images only come from real user uploads (when implemented)
  return [];
}

// ============================================
// HELPER UTILITIES
// ============================================

export function getAllGames(): Game[] {
  const imported = loadImportedGames();
  // Merge imported (allow override by slug if needed, but simple append for demo)
  const existingSlugs = new Set(GAMES.map((g) => g.slug));
  const newOnes = imported.filter((g) => !existingSlugs.has(g.slug));
  return [...GAMES, ...newOnes];
}

export function getGameBySlug(slug: string): Game | undefined {
  return GAMES.find((g) => g.slug === slug);
}

export function getAllReports(): Report[] {
  const userReports = loadUserReports();
  // Only real user reports (localStorage in demo, Supabase in real mode). No seeds.
  return [...userReports, ...ALL_SEED_REPORTS];
}

/**
 * Enriched reports for admin (includes status from moderation overrides)
 */
export function getAllReportsForAdmin(): AdminReport[] {
  const base = getAllReports();
  const overrides = loadModerationOverrides();
  return base.map((r) => {
    const ov = overrides[r.id];
    if (ov) {
      return {
        ...r,
        status: ov.status,
        moderatorNotes: ov.moderatorNotes,
        moderatedAt: ov.moderatedAt,
        moderatedBy: ov.moderatedBy,
      } as AdminReport;
    }
    // No seed reports: everything is user-submitted and starts pending.
    return {
      ...r,
      status: 'pending' as ReportStatus,
    } as AdminReport;
  });
}

export function getReportsForGame(gameId: string, filters?: ReportFilters): Report[] {
  let reports = getAllReports().filter((r) => r.gameId === gameId);

  if (filters) {
    reports = filterReports(reports, filters);
  }
  return reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// filterReports / predictForUserRigFromReports / computeGameStatsFromReports /
// formatRelativeTime / parseCSV moved to data-logic.ts (imported + re-exported above).

// Thin wrappers for backward compat (used by sync callers + when flag=false)
export function predictForUserRig(userPC: UserPC, gameId: string): PredictionResult {
  const gameReports = getAllReports().filter((r) => r.gameId === gameId);
  return predictForUserRigFromReports(userPC, gameReports);
}

// Re-export similarity helpers (new engine + legacy for compat).
// Legacy calculateSimilarity / extract* / get* now live in hardware-similarity-heuristics.ts
// (re-exported via similarity.ts) to avoid circular module initialization
// (mock-data <-> similarity <-> data etc).
export { calculateHardwareAwareSimilarity, calculateSimilarity, extractGpuSeries, getCpuTier } from './similarity';

export function computeGameStats(gameId: string): GameStats {
  const reports = getAllReports().filter((r) => r.gameId === gameId);
  return computeGameStatsFromReports(reports);
}

// Convenience for home "trending"
export function getTrendingGames(limit = 6): Game[] {
  const counts = new Map<string, number>();
  for (const r of getAllReports()) {
    counts.set(r.gameId, (counts.get(r.gameId) ?? 0) + 1);
  }
  return [...GAMES]
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    .slice(0, limit);
}

// For the global reports browser
export function getFilteredGlobalReports(filters: {
  gameSlug?: string;
  gpuSeries?: string;
  minFps?: number;
  tier?: PerformanceTier;
}): Report[] {
  let reports = getAllReports();

  if (filters.gameSlug) {
    const game = getGameBySlug(filters.gameSlug);
    if (game) reports = reports.filter((r) => r.gameId === game.id);
  }
  if (filters.gpuSeries) {
    reports = reports.filter((r) => r.gpu.toUpperCase().includes(filters.gpuSeries!.toUpperCase()));
  }
  if (filters.minFps) {
    reports = reports.filter((r) => r.avgFps >= filters.minFps!);
  }
  if (filters.tier) {
    reports = reports.filter((r) => r.performanceTier === filters.tier);
  }

  return reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ============================================
// PHASE 4 ADMIN TOOLS (demo via localStorage + mock)
// These will be swapped for Supabase in full migration
// ============================================

// ---- Reports Moderation Queue ----

export function getModerationQueue(filterStatus?: ReportStatus | 'all'): AdminReport[] {
  let reports = getAllReportsForAdmin();
  if (filterStatus && filterStatus !== 'all') {
    reports = reports.filter((r) => r.status === filterStatus);
  }
  // Pending first, then newest
  return reports.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  moderatorNotes?: string,
  moderatorName = 'Admin Demo'
): boolean {
  const overrides = loadModerationOverrides();
  overrides[reportId] = {
    status,
    moderatorNotes: moderatorNotes || overrides[reportId]?.moderatorNotes,
    moderatedAt: new Date().toISOString(),
    moderatedBy: moderatorName,
  };
  saveModerationOverrides(overrides);

  // If it's a user report, also persist the status into the user_reports for consistency
  try {
    const userReports = loadUserReports();
    const idx = userReports.findIndex((r) => r.id === reportId);
    if (idx !== -1) {
      // Note: Report type extended loosely at runtime for demo
      (userReports[idx] as any).status = status;
      if (moderatorNotes) (userReports[idx] as any).moderatorNotes = moderatorNotes;
      saveUserReports(userReports);
    }
  } catch {}
  return true;
}

// ---- Hardware Normalization Workbench ----

export function getHardwareAliases(search?: string): HardwareAlias[] {
  let aliases = loadHardwareAliases();
  if (search) {
    const q = search.toLowerCase();
    aliases = aliases.filter(
      (a) =>
        a.rawString.toLowerCase().includes(q) ||
        a.canonical.toLowerCase().includes(q) ||
        (a.vendor && a.vendor.toLowerCase().includes(q))
    );
  }
  return aliases.sort((a, b) => a.rawString.localeCompare(b.rawString));
}

export function addHardwareAlias(rawString: string, canonical: string, vendor?: string, series?: string): HardwareAlias | null {
  if (!rawString.trim() || !canonical.trim()) return null;
  const aliases = loadHardwareAliases();
  // Avoid exact raw dupes
  if (aliases.some((a) => a.rawString.toLowerCase() === rawString.trim().toLowerCase())) {
    return null; // caller should handle "exists"
  }
  const newAlias: HardwareAlias = {
    id: 'ha-' + Date.now().toString(36),
    rawString: rawString.trim(),
    canonical: canonical.trim(),
    vendor: vendor?.trim(),
    series: series?.trim(),
    createdAt: new Date().toISOString(),
  };
  aliases.push(newAlias);
  saveHardwareAliases(aliases);
  return newAlias;
}

export function updateHardwareAlias(id: string, updates: Partial<Omit<HardwareAlias, 'id' | 'createdAt'>>): boolean {
  const aliases = loadHardwareAliases();
  const idx = aliases.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  aliases[idx] = { ...aliases[idx], ...updates };
  saveHardwareAliases(aliases);
  return true;
}

export function deleteHardwareAlias(id: string): boolean {
  const aliases = loadHardwareAliases();
  const filtered = aliases.filter((a) => a.id !== id);
  if (filtered.length === aliases.length) return false;
  saveHardwareAliases(filtered);
  return true;
}

// ---- Games Management + Bulk Import ----

export function bulkImportGames(rows: any[]): BulkImportResult {
  const result: BulkImportResult = { success: 0, errors: [], imported: [] };
  const currentImported = loadImportedGames();
  const existingSlugs = new Set([...GAMES.map((g) => g.slug), ...currentImported.map((g) => g.slug)]);

  const toAdd: Game[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2; // +1 header
    try {
      const name = String(row.name || row.Name || '').trim();
      const slug = String(row.slug || row.Slug || normalizeSlug(name)).trim();
      if (!name) {
        result.errors.push({ row: rowNum, message: 'Missing name' });
        return;
      }
      if (existingSlugs.has(slug)) {
        result.errors.push({ row: rowNum, message: `Duplicate slug: ${slug}` });
        return;
      }

      const game: Game = {
        id: 'imp-' + Date.now().toString(36) + '-' + index,
        slug,
        name,
        coverImage: row.coverImage || row.cover_url || 'https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900_2x.jpg',
        coverAttribution: row.coverAttribution || row.cover_attribution || row.attribution,
        genres: Array.isArray(row.genres) ? row.genres : String(row.genres || 'Action').split(',').map((s: string) => s.trim()),
        releaseYear: Number(row.releaseYear || row.year || 2024),
        developer: String(row.developer || row.Developer || 'Unknown'),
        publisher: row.publisher ? String(row.publisher) : undefined,
        // Agent 5: support pre-enriched rows from the Public API cached resolver (lib/game-id-resolver)
        // Demo seeds / admin bulk can call resolveManyGameExternalIds or enrichGameWithExternalIds first, then import.
        steamAppId: row.steamAppId || row.steam_app_id,
        igdbId: row.igdbId || row.igdb_id,
      };
      toAdd.push(game);
      existingSlugs.add(slug);
      result.success++;
      result.imported.push(game);
    } catch (e: any) {
      result.errors.push({ row: rowNum, message: e.message || 'Parse error' });
    }
  });

  if (toAdd.length > 0) {
    saveImportedGames([...currentImported, ...toAdd]);
  }
  return result;
}

// ---- Image Management ----

export function getReportImages(filterStatus?: 'pending' | 'approved' | 'rejected' | 'all'): ReportImage[] {
  let imgs = loadReportImages();
  if (filterStatus && filterStatus !== 'all') {
    imgs = imgs.filter((i) => i.status === filterStatus);
  }
  return imgs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function updateImageStatus(imageId: string, status: 'pending' | 'approved' | 'rejected'): boolean {
  const imgs = loadReportImages();
  const idx = imgs.findIndex((i) => i.id === imageId);
  if (idx === -1) return false;
  imgs[idx].status = status;
  saveReportImages(imgs);
  return true;
}

export function deleteReportImage(imageId: string): boolean {
  const imgs = loadReportImages();
  const filtered = imgs.filter((i) => i.id !== imageId);
  if (filtered.length === imgs.length) return false;
  saveReportImages(filtered);
  return true;
}

// Convenience for admin overview stats
export function getAdminOverviewStats() {
  const allReports = getAllReportsForAdmin();
  const pending = allReports.filter((r) => r.status === 'pending').length;
  const aliases = loadHardwareAliases().length;
  const imagesPending = loadReportImages().filter((i) => i.status === 'pending').length;
  const importedCount = loadImportedGames().length;
  return {
    totalGames: getAllGames().length,
    totalReports: allReports.length,
    pendingReports: pending,
    hardwareAliases: aliases,
    pendingImages: imagesPending,
    importedGames: importedCount,
  };
}
