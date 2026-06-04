// RunDB Core Types — designed to be 1:1 replaceable with Supabase/Postgres later

export type PerformanceTier =
  | 'Excellent'
  | 'Good'
  | 'Playable'
  | 'Struggling'
  | 'Unplayable';

export type GraphicsPreset = 'Low' | 'Medium' | 'High' | 'Ultra' | 'Custom';

export const MAIN_RESOLUTIONS = ['1920x1080', '2560x1440', '3840x2160'] as const;
export type MainResolution = typeof MAIN_RESOLUTIONS[number];

// Phase 2: Approved schema status enum (maps 1:1 to report_status in Postgres)
export type ReportStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export interface HardwareSpec {
  cpu: string;
  gpu: string;
  ram: number; // GB
  storage?: string;
}

// ============================================
// Hardware Catalog Types (full structured hardware database)
// Primary: Static curated catalog in lib/hardware-catalog.ts
// Optional denorm fields added to Report/UserPC for future server-side similarity + validation
// ============================================

export type HardwareComponentType = 'cpu' | 'gpu' | 'ram' | 'motherboard' | 'psu';

export interface HardwareCatalogEntry {
  canonical: string;                    // Authoritative marketing name, e.g. "NVIDIA GeForce RTX 4070 Ti Super"
  componentType: HardwareComponentType;
  vendor: 'NVIDIA' | 'AMD' | 'Intel' | 'Other';
  series: string;                       // 'RTX 40' | 'RDNA 3' | 'Zen 4' | 'DDR5-6000' etc.
  perfIndex?: number;                   // 0-100 relative gaming performance (flagship ~100). GPU-dominant for this app.
  releaseYear?: number;
  // GPU-specific
  vramGB?: number;
  architecture?: string;                // Ada, RDNA3, Blackwell, etc.
  // CPU-specific
  cores?: number;
  threads?: number;
  has3DVCache?: boolean;
  tdpW?: number;
  // RAM-specific
  memoryType?: 'DDR4' | 'DDR5' | 'LPDDR5X';
  speedMTs?: number;                    // e.g. 6000
  // General / future
  notes?: string;
  source: string;                       // Attribution + curation date
  lastUpdated: string;                  // ISO
}

export interface HardwareNormalizationResult {
  canonical?: string;
  entry?: HardwareCatalogEntry;
  confidence: number;                   // 0-1
  method: 'exact' | 'alias' | 'heuristic' | 'none';
  originalInput: string;
}

export interface Game {
  id: string;
  slug: string;
  name: string;
  coverImage: string; // picsum or high-quality placeholder (or real IGDB/Steam/Supabase key art)
  /** Optional attribution/credit string for the cover (from game_media.attribution or cover source). Rendered subtly when present. */
  coverAttribution?: string;
  genres: string[];
  releaseYear: number;
  developer: string;
  publisher?: string;
  officialMinReqs?: HardwareSpec;
  officialRecReqs?: HardwareSpec;
  // Phase 5 / Agent 5: Public API Resilience Layer — external IDs from cached resolver (Steam-first + fallbacks)
  // Populated for demo seeds, bulk import, and runtime enrichment. Matches supabase games.steam_app_id / igdb_id.
  steamAppId?: string;
  igdbId?: string;
  externalIdAttribution?: string; // From Agent 5 resolver (source + credit for the IDs)
  /** Supabase ingest_status — skeleton rows await background enrichment */
  ingestStatus?: 'skeleton' | 'enriched' | 'failed';
}

export interface Report {
  id: string;
  gameId: string;
  gameName?: string; // denormalized convenience
  cpu: string;
  gpu: string;
  ram: number;
  ramSpeed?: string;
  resolution: string; // e.g. "2560x1440"
  refreshRate?: number;
  settingsPreset: GraphicsPreset;
  customSettingsNotes?: string;
  avgFps: number;
  fps1PercentLow?: number;
  performanceTier: PerformanceTier;
  notes?: string;
  tweaks?: string;
  issues?: string;
  driverVersion?: string;
  kernel?: string;
  distro?: string;
  createdAt: string; // ISO
  helpfulVotes: number;
  downvoteVotes?: number;
  voteScore?: number;
  credibilityBadge?: CredibilityBadge;
  credibilityScore?: number;

  // Phase 2 real-data / moderation fields (from Master Plan approved schema)
  // Only populated for moderators via /admin/reports or internal; public RLS filters to approved only
  status?: ReportStatus;
  userId?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
  moderatorNotes?: string | null;

  // Hardware Catalog (added Phase 6+ database) — optional for full backward compat
  canonicalCpu?: string;
  canonicalGpu?: string;
  gpuPerfIndex?: number;
  cpuPerfIndex?: number;

  // Optionally embedded game metadata (cover/slug/developer/year) joined at query time.
  // Lets the /reports "By game" view render banners without fetching the whole catalog.
  game?: Game;

  // Reporter attribution + badges (enriched post-fetch in real mode via profiles join/policy).
  // Populated for public display on game report pages and ReportCard (username + their overall badge).
  // userId remains the raw FK for ownership/voting logic.
  reporter?: {
    id?: string;
    username?: string | null;
    avatarUrl?: string | null;
    credibilityBadge?: CredibilityBadge | null;
  };
}

export type CredibilityBadge = 'New' | 'Helpful' | 'Trusted' | 'Expert' | 'Legend';

export interface UserPC {
  cpu: string;
  gpu: string;
  ram: number;
  resolution?: string;

  // Hardware Catalog (added Phase 6+ database) — optional for full backward compat
  canonicalCpu?: string;
  canonicalGpu?: string;

  // Hardware Identification (Plan 4 Hybrid feature)
  // Additive only — never populated automatically on load.
  // Set only when user explicitly uses "Identify My Hardware" and saves.
  detectionMethod?: DetectionMethod;
  detectedAt?: string; // ISO timestamp
  detectedRaw?: Record<string, unknown>; // raw strings from browser/paste for alias learning

  // Rich ProtonDB-style details (populated when user uses high-quality paste like inxi)
  driverVersion?: string;
  kernel?: string;
  distro?: string;
}

// Phase 2: Multi-device support (ProtonDB "My Devices" style)
export interface UserDevice {
  id?: string;           // DB id when persisted
  label: string;         // User-friendly name e.g. "Desktop RTX 4080", "Laptop", "Steam Deck"
  cpu: string;
  gpu: string;
  ram: number;
  resolution?: string;
  isPrimary?: boolean;
  driverVersion?: string;
  kernel?: string;
  distro?: string;
  updatedAt?: string;
}

// Filter shapes used across UI
export interface ReportFilters {
  resolution?: string;
  gpuSeries?: string; // 'RTX 40' | 'RX 6000' etc.
  minFps?: number;
  maxFps?: number;
  preset?: GraphicsPreset | 'Any';
}

export interface GameStats {
  totalReports: number;
  tierDistribution: Record<PerformanceTier, number>;
  avgFpsByResolution: Record<string, number>;
  mostCommonPreset: GraphicsPreset | null;
  avgFpsOverall: number;
}

// For compatibility predictions
export interface PredictionResult {
  predictedTier: PerformanceTier;
  confidence: number; // 0-1
  matchingReports: Report[];
  explanation: string;
  recommendedSettings: string;
}

// Phase 2: Input shape for real report submission (Server Action / RPC)
// Aligns exactly with what submit_report expects (minus computed fields like performance_tier, status)
export interface SubmitReportInput {
  gameId: string;
  cpu: string;
  gpu: string;
  ram: number;
  resolution: string;
  refreshRate?: number;
  settingsPreset: GraphicsPreset;
  avgFps: number;
  fps1PercentLow?: number;
  notes?: string;
  tweaks?: string;
  issues?: string;
  driverVersion?: string;
  ramSpeed?: string;
  customSettingsNotes?: string;

  // Rich ProtonDB-style fields captured via detection (inxi etc.)
  kernel?: string;
  distro?: string;

  // Hardware Catalog (added Phase 6+ database) — optional, populated by normalization layer
  canonicalCpu?: string;
  canonicalGpu?: string;
}

// ============================================
// Phase 4 Admin Types (aligned with Supabase schema)
// ============================================

// ReportStatus already defined above (Phase 2). Duplicate removed for clean TypeScript compile.

export interface HardwareAlias {
  id: string;
  rawString: string;
  canonical: string;
  vendor?: string;
  series?: string;
  createdAt: string;
}

// ============================================
// Hardware Identification (Plan 4 Hybrid "Identify My Hardware")
// ============================================

export type DetectionMethod =
  | 'browser'   // WebGL UNMASKED_RENDERER + WebGPU + navigator heuristics
  | 'paste'     // user-provided dxdiag / lspci / system_profiler / Steam sysinfo etc.
  | 'steam'     // enrichment only (Steam provides ZERO per-user CPU/GPU/RAM)
  | 'manual'    // explicit user typing
  | 'companion'; // future Tauri/Rust desktop bridge

export interface DetectedHardware {
  cpu?: string;
  gpu?: string;
  ram?: number;
  resolution?: string;

  // Richer fields captured from high-signal sources (inxi, dxdiag, Steam sysinfo, etc.)
  // These are the ProtonDB-style details that make reports much more valuable.
  driverVersion?: string;
  kernel?: string;
  distro?: string;

  // Additional coverage fields (additive, all optional):
  // - vram: dedicated GPU memory in GB (from catalog match or structured paste).
  // - refreshRate: display refresh in Hz (browser rAF sampling or structured paste).
  // - cpuArch: CPU architecture family from UA Client Hints ('x86', 'arm', ...) — a hint, not a model.
  // - osVersion: precise OS string (e.g. 'Windows 11', 'Windows 10') from UA-CH platformVersion or paste.
  vram?: number;
  refreshRate?: number;
  cpuArch?: string;
  osVersion?: string;

  raw: Record<string, unknown>; // raw unprocessed values (for debugging + alias learning)
  method: DetectionMethod;
  confidence: number; // 0.0–1.0
  timestamp: string; // ISO
  limitations?: string[];
  osHint?: string;
}

// Steam linking (Plan 2 + C)
export interface LinkedAccount {
  id: string;
  user_id: string;
  provider: 'steam';
  provider_user_id: string;
  provider_data?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface SteamProfileSnapshot {
  steamId: string;
  personaName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  linkedAt: string;
}

export interface AdminReport extends Report {
  status?: ReportStatus;
  moderatorNotes?: string;
  moderatedBy?: string; // user id or name
  moderatedAt?: string;
}

export interface ReportImage {
  id: string;
  reportId: string;
  imageUrl: string;
  caption?: string;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface BulkImportResult {
  success: number;
  errors: Array<{ row: number; message: string }>;
  imported: Game[];
}

export interface GamesPageResult {
  games: Game[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type IngestQueueStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface IngestQueueStats {
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
}
