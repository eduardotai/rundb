/**
 * Profile page — server-only data gatherer.
 *
 * Pulls the signed-in user's profile row + their submitted reports (RLS lets a
 * user read their own reports at any moderation status) and derives the
 * "creator" stats shown on the enhanced /profile page (reports, vote score,
 * games covered, tier distribution, favourite GPU, etc.).
 *
 * Every Supabase call is wrapped so a missing/unconfigured backend can never
 * crash the page — it degrades to empty stats, matching the repo's
 * "the app never breaks" ethos. Mirrors the pattern in lib/server/dashboard.ts.
 */
import { createClient } from '@/lib/supabase/server';
import type { CredibilityBadge, PerformanceTier } from '@/lib/types';

/** True when public Supabase env vars are present (matches lib/data.isSupabaseConfigured). */
function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export interface ProfileReportLite {
  id: string;
  gameId: string;
  gameName: string;
  cpu: string;
  gpu: string;
  ram: number;
  resolution: string;
  settingsPreset: string;
  avgFps: number;
  performanceTier: PerformanceTier;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  helpfulVotes: number;
  downvoteVotes: number;
  voteScore: number;
  createdAt: string;
  // Full editable content — carried so the owner-only "My Reports" edit dialog can
  // prefill without a second round-trip. All are base-schema columns, so they survive
  // the incremental-column fallback query below. Optional everywhere else.
  ramSpeed?: string | null;
  refreshRate?: number | null;
  customSettingsNotes?: string | null;
  fps1PercentLow?: number | null;
  notes?: string | null;
  tweaks?: string | null;
  issues?: string | null;
  driverVersion?: string | null;
}

export interface ProfileStats {
  totalReports: number;
  approvedReports: number;
  pendingReports: number;
  helpfulVotes: number;
  downvoteVotes: number;
  voteScore: number;
  votesCast: number;
  reputationScore: number;
  credibilityBadge: CredibilityBadge;
  gamesCovered: number;
  avgFps: number | null;
  topGpu: string | null;
  tierCounts: Record<PerformanceTier, number>;
}

export interface ProfileRecord {
  username: string | null;
  avatarUrl: string | null;
  role: 'user' | 'moderator' | 'admin';
  createdAt: string | null;
  mainCpu: string | null;
  mainGpu: string | null;
  mainRam: number | null;
  preferredResolution: string | null;
}

export interface ProfileData {
  profile: ProfileRecord | null;
  stats: ProfileStats;
  reports: ProfileReportLite[];
}

const EMPTY_TIERS: Record<PerformanceTier, number> = {
  Excellent: 0,
  Good: 0,
  Playable: 0,
  Struggling: 0,
  Unplayable: 0,
};

export function emptyStats(): ProfileStats {
  return {
    totalReports: 0,
    approvedReports: 0,
    pendingReports: 0,
    helpfulVotes: 0,
    downvoteVotes: 0,
    voteScore: 0,
    votesCast: 0,
    reputationScore: 0,
    credibilityBadge: 'New',
    gamesCovered: 0,
    avgFps: null,
    topGpu: null,
    tierCounts: { ...EMPTY_TIERS },
  };
}

const VALID_TIERS = new Set<PerformanceTier>([
  'Excellent',
  'Good',
  'Playable',
  'Struggling',
  'Unplayable',
]);

/** Newest-N cap — a creator's profile never needs to materialise thousands of rows. */
const REPORTS_CAP = 250;

function deriveStats(reports: ProfileReportLite[]): ProfileStats {
  if (reports.length === 0) return emptyStats();

  const tierCounts: Record<PerformanceTier, number> = { ...EMPTY_TIERS };
  const games = new Set<string>();
  const gpuFreq = new Map<string, number>();
  let helpful = 0;
  let downvotes = 0;
  let voteScore = 0;
  let approved = 0;
  let pending = 0;
  let fpsSum = 0;
  let fpsCount = 0;

  for (const r of reports) {
    if (VALID_TIERS.has(r.performanceTier)) tierCounts[r.performanceTier] += 1;
    if (r.gameId) games.add(r.gameId);
    helpful += r.helpfulVotes || 0;
    downvotes += r.downvoteVotes || 0;
    voteScore += r.voteScore ?? r.helpfulVotes ?? 0;
    if (r.status === 'approved') approved += 1;
    else if (r.status === 'pending' || r.status === 'flagged') pending += 1;
    if (Number.isFinite(r.avgFps) && r.avgFps > 0) {
      fpsSum += r.avgFps;
      fpsCount += 1;
    }
    if (r.gpu) gpuFreq.set(r.gpu, (gpuFreq.get(r.gpu) ?? 0) + 1);
  }

  let topGpu: string | null = null;
  let topGpuCount = 0;
  for (const [gpu, count] of gpuFreq) {
    if (count > topGpuCount) {
      topGpu = gpu;
      topGpuCount = count;
    }
  }

  const reputationScore = Math.max(0, approved * 8 + helpful * 3 + voteScore - downvotes * 2 + reports.length);
  const credibilityBadge: CredibilityBadge =
    reputationScore >= 500 ? 'Legend'
    : reputationScore >= 200 ? 'Expert'
    : reputationScore >= 75 ? 'Trusted'
    : reputationScore >= 20 ? 'Helpful'
    : 'New';

  return {
    totalReports: reports.length,
    approvedReports: approved,
    pendingReports: pending,
    helpfulVotes: helpful,
    downvoteVotes: downvotes,
    voteScore,
    votesCast: 0,
    reputationScore,
    credibilityBadge,
    gamesCovered: games.size,
    avgFps: fpsCount ? Math.round(fpsSum / fpsCount) : null,
    topGpu,
    tierCounts,
  };
}

function mapReportRow(row: Record<string, unknown>): ProfileReportLite {
  const tier = String(row.performance_tier ?? 'Playable') as PerformanceTier;
  const status = String(row.status ?? 'pending') as ProfileReportLite['status'];
  return {
    id: String(row.id),
    gameId: String(row.game_id ?? ''),
    gameName: String(row.game_name ?? 'Unknown game'),
    cpu: String(row.cpu ?? ''),
    gpu: String(row.gpu ?? ''),
    ram: Number(row.ram ?? 0),
    resolution: String(row.resolution ?? ''),
    settingsPreset: String(row.settings_preset ?? ''),
    avgFps: Number(row.avg_fps ?? 0),
    performanceTier: VALID_TIERS.has(tier) ? tier : 'Playable',
    status: ['pending', 'approved', 'rejected', 'flagged'].includes(status) ? status : 'pending',
    helpfulVotes: Number(row.helpful_votes ?? 0),
    downvoteVotes: Number(row.downvote_votes ?? 0),
    voteScore: Number(row.vote_score ?? row.helpful_votes ?? 0),
    createdAt: String(row.created_at ?? ''),
    ramSpeed: row.ram_speed != null ? String(row.ram_speed) : null,
    refreshRate: row.refresh_rate != null ? Number(row.refresh_rate) : null,
    customSettingsNotes: row.custom_settings_notes != null ? String(row.custom_settings_notes) : null,
    fps1PercentLow: row.fps_1_percent_low != null ? Number(row.fps_1_percent_low) : null,
    notes: row.notes != null ? String(row.notes) : null,
    tweaks: row.tweaks != null ? String(row.tweaks) : null,
    issues: row.issues != null ? String(row.issues) : null,
    driverVersion: row.driver_version != null ? String(row.driver_version) : null,
  };
}

/**
 * Fetch the enhanced profile payload for a signed-in user.
 * Always resolves (never throws): on any backend issue it returns empty stats so
 * the page still renders the account + rig editor.
 */
export async function getProfileData(userId: string): Promise<ProfileData> {
  if (!userId || !isSupabaseConfigured()) {
    return { profile: null, stats: emptyStats(), reports: [] };
  }

  try {
    const supabase = await createClient();

    const [profileRes, reportsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'username, avatar_url, role, created_at, main_cpu, main_gpu, main_ram, preferred_resolution'
        )
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('reports')
        .select(
          'id, game_id, game_name, cpu, gpu, ram, ram_speed, resolution, refresh_rate, settings_preset, custom_settings_notes, avg_fps, fps_1_percent_low, performance_tier, status, notes, tweaks, issues, driver_version, helpful_votes, downvote_votes, vote_score, created_at'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(REPORTS_CAP),
    ]);

    const pRow = (profileRes as { data: Record<string, unknown> | null }).data;
    const profile: ProfileRecord | null = pRow
      ? {
          username: (pRow.username as string) ?? null,
          avatarUrl: (pRow.avatar_url as string) ?? null,
          role: (['user', 'moderator', 'admin'].includes(String(pRow.role))
            ? (pRow.role as ProfileRecord['role'])
            : 'user'),
          createdAt: (pRow.created_at as string) ?? null,
          mainCpu: (pRow.main_cpu as string) ?? null,
          mainGpu: (pRow.main_gpu as string) ?? null,
          mainRam: pRow.main_ram != null ? Number(pRow.main_ram) : null,
          preferredResolution: (pRow.preferred_resolution as string) ?? null,
        }
      : null;

    let rRows: Record<string, unknown>[] = (reportsRes as { data: Record<string, unknown>[] | null }).data ?? [];
    if ((reportsRes as any)?.error) {
      const errMsg = String((reportsRes as any).error?.message || '');
      console.warn('[profile] reports select error (missing incremental cols?), retrying with base columns:', errMsg);
      // Fallback: select only columns guaranteed by base schema.sql so user's reports still appear in /profile
      // (downvote/vote/cred are maintained by incremental-reputation-voting.sql; without them stats are approx but list works)
      try {
        const fallbackRes = await supabase
          .from('reports')
          .select(
            'id, game_id, game_name, cpu, gpu, ram, ram_speed, resolution, refresh_rate, settings_preset, custom_settings_notes, avg_fps, fps_1_percent_low, performance_tier, status, notes, tweaks, issues, driver_version, helpful_votes, created_at'
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(REPORTS_CAP);
        rRows = (fallbackRes as { data: Record<string, unknown>[] | null }).data ?? [];
      } catch (fbErr) {
        console.warn('[profile] fallback reports query also failed:', fbErr);
        rRows = [];
      }
    }
    const reports = rRows.map(mapReportRow);

    const stats = deriveStats(reports);
    try {
      const { count } = await supabase
        .from('report_votes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      stats.votesCast = count ?? 0;
      stats.reputationScore += Math.min(stats.votesCast, 250);
      stats.credibilityBadge =
        stats.reputationScore >= 500 ? 'Legend'
        : stats.reputationScore >= 200 ? 'Expert'
        : stats.reputationScore >= 75 ? 'Trusted'
        : stats.reputationScore >= 20 ? 'Helpful'
        : 'New';
    } catch {}

    return { profile, stats, reports };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[profile] getProfileData failed, returning empty stats:', msg);
    return { profile: null, stats: emptyStats(), reports: [] };
  }
}
