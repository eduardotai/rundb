'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAdminOverviewStats,
  getModerationQueue,
  moderateReports,
  deleteReports,
  getHardwareAliases,
  createHardwareAlias,
  updateHardwareAlias,
  deleteHardwareAlias,
  getAllGamesForAdmin,
  bulkImportGames,
  parseCSV,
  getReportImages,
  moderateReportImages,
  deleteReportImages,
  type ImageStatus,
} from '@/lib/admin';
import { EMPTY_ADMIN_STATS, parseBulkGameRows } from '@/lib/admin-logic';
import type { Game, HardwareAlias, ReportStatus, BulkImportResult } from '@/lib/types';
import { triggerIngestionAction } from '@/app/actions/reports';
import {
  getIngestQueueStatsAction,
  runIngestBatchAction,
  retryFailedIngestAction,
  getFailedIngestRowsAction,
  discoverAndEnqueueLatestAction,
} from '@/app/actions/ingest-queue';
import type { IngestQueueStats } from '@/lib/types';
import { USE_REAL } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PerformanceBadge } from '@/components/performance-badge';
import { toast } from 'sonner';
import { showUserError } from '@/lib/toast';
import { 
  Shield, 
  Database, 
  Users, 
  Image as ImageIcon, 
  Upload, 
  Check, 
  X, 
  Flag, 
  Plus, 
  Trash2, 
  Edit2, 
  RefreshCw,
  FileText,
  AlertTriangle
} from 'lucide-react';
import { gameMediaLoader } from '@/lib/utils';
import { sanitizeFullName } from '@/lib/sanitize';
import { getHardwareCatalogStats } from '@/lib/hardware-catalog';

const EMPTY_GAMES: Game[] = [];

type DemoRole = 'user' | 'moderator' | 'admin';

const ROLE_LABELS: Record<DemoRole, string> = {
  user: 'User',
  moderator: 'Moderator',
  admin: 'Admin',
};

export default function AdminPage() {
  // Demo role simulation (persisted) — in real migration this comes from profiles.role via Supabase
  const [demoRole, setDemoRole] = useState<DemoRole>(() => {
    if (typeof window === 'undefined') return 'admin';
    const saved = localStorage.getItem('rundb_demo_role') as DemoRole | null;
    return (saved && ['user', 'moderator', 'admin'].includes(saved)) ? saved : 'admin';
  });

  const queryClient = useQueryClient();
  const [reportFilter, setReportFilter] = useState<ReportStatus | 'all'>('pending');
  const [isModeratingReport, setIsModeratingReport] = useState(false);
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(() => new Set());
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set());
  const [isModeratingImages, setIsModeratingImages] = useState(false);
  const [isSavingAlias, setIsSavingAlias] = useState(false);
  const [aliasSearch, setAliasSearch] = useState('');
  const [gameSearch, setGameSearch] = useState('');
  const [imageFilter, setImageFilter] = useState<ImageStatus | 'all'>('pending');
  const [refreshKey, setRefreshKey] = useState(0);

  // Phase 1 Ingestion trigger support (simple admin UI for CLI + simulation, no new files)
  const [phase1SeedText, setPhase1SeedText] = useState('[\n  {"name": "Cyberpunk 2077", "slug": "cyberpunk-2077"},\n  {"name": "Elden Ring", "slug": "elden-ring"}\n]');
  const [phase1Command, setPhase1Command] = useState('');
  const [phase1SimResult, setPhase1SimResult] = useState<string | null>(null);

  // Agent 4: protected Server Action state
  const [ingestActionResult, setIngestActionResult] = useState<string | null>(null);
  const [isIngestingAction, setIsIngestingAction] = useState(false);

  // Ingest queue dashboard (Choice 4 — real Supabase mode)
  const [queueStats, setQueueStats] = useState<IngestQueueStats | null>(null);
  const [failedIngestRows, setFailedIngestRows] = useState<Array<{ slug: string; name: string; last_error: string | null }>>([]);
  const [isRunningIngestBatch, setIsRunningIngestBatch] = useState(false);

  // New automated discover+enqueue (for latest Steam catalog integration)
  const [isDiscoveringEnqueue, setIsDiscoveringEnqueue] = useState(false);
  const [discoverEnqueueResult, setDiscoverEnqueueResult] = useState<string | null>(null);

  // Modals & forms
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importTab, setImportTab] = useState<'csv' | 'json'>('csv');
  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [parsedPreview, setParsedPreview] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [showAliasDialog, setShowAliasDialog] = useState(false);
  const [editingAlias, setEditingAlias] = useState<HardwareAlias | null>(null);
  const [aliasForm, setAliasForm] = useState({ rawString: '', canonical: '', vendor: '', series: '' });

  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string>('');
  const [actionStatus, setActionStatus] = useState<ReportStatus>('approved');
  const [moderatorNotes, setModeratorNotes] = useState('');

  const canModerate = USE_REAL || demoRole === 'moderator' || demoRole === 'admin';
  const canAdmin = USE_REAL || demoRole === 'admin';

  const persistRole = (role: DemoRole) => {
    setDemoRole(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('rundb_demo_role', role);
    }
    toast.success(`Switched to ${ROLE_LABELS[role]} (demo only)`);
  };

  // All admin data flows through the dual-mode adapter (@/lib/admin) via React Query.
  // Mutations call invalidateAdmin() which refetches every ['admin', ...] query.
  const invalidateAdmin = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    setRefreshKey((k) => k + 1);
  }, [queryClient]);

  const statsQuery = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: getAdminOverviewStats,
    staleTime: 30_000,
  });
  const stats = statsQuery.data ?? EMPTY_ADMIN_STATS;

  const reportsQuery = useQuery({
    queryKey: ['admin', 'reports', reportFilter],
    queryFn: () => getModerationQueue(reportFilter),
    staleTime: 15_000,
  });
  const reports = reportsQuery.data ?? [];
  const isReportsLoading = reportsQuery.isPending;

  const aliasesQuery = useQuery({
    queryKey: ['admin', 'aliases', aliasSearch],
    queryFn: () => getHardwareAliases(aliasSearch),
    staleTime: 30_000,
  });
  const aliases = aliasesQuery.data ?? [];

  const gamesQuery = useQuery({
    queryKey: ['admin', 'games'],
    queryFn: getAllGamesForAdmin,
    staleTime: 60_000,
  });
  const games = gamesQuery.data ?? EMPTY_GAMES;

  const imagesQuery = useQuery({
    queryKey: ['admin', 'images', imageFilter],
    queryFn: () => getReportImages(imageFilter),
    staleTime: 15_000,
  });
  const images = imagesQuery.data ?? [];

  React.useEffect(() => {
    const err = statsQuery.error ?? reportsQuery.error ?? aliasesQuery.error ?? imagesQuery.error;
    if (err) showUserError(err instanceof Error ? err.message : 'Failed to load admin data.');
  }, [statsQuery.error, reportsQuery.error, aliasesQuery.error, imagesQuery.error]);

  // Filtered games
  const filteredGames = useMemo(() => {
    if (!gameSearch) return games;
    const q = gameSearch.toLowerCase();
    return games.filter(
      (g) => g.name.toLowerCase().includes(q) || g.developer.toLowerCase().includes(q) || g.slug.includes(q)
    );
  }, [games, gameSearch]);

  // ===== BULK IMPORT HANDLERS =====
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportText(text);
      processImportText(text, file.name.endsWith('.json') ? 'json' : 'csv');
    };
    reader.readAsText(file);
  };

  const processImportText = (text: string, forceType?: 'csv' | 'json') => {
    const type = forceType || importTab;
    setImportResult(null);
    try {
      let rows: any[] = [];
      if (type === 'json') {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        rows = parseCSV(text);
      }
      setParsedPreview(rows.slice(0, 12)); // preview first 12
    } catch {
      showUserError('Could not parse the data. Check the format.');
      setParsedPreview([]);
    }
  };

  const runBulkImport = async () => {
    if (!importText.trim() || parsedPreview.length === 0) {
      showUserError('No data to import.');
      return;
    }
    setIsImporting(true);
    try {
      const rows = importTab === 'json' ? JSON.parse(importText) : parseCSV(importText);
      const result = await bulkImportGames(Array.isArray(rows) ? rows : [rows]);
      setImportResult(result);

      if (result.success > 0) {
        toast.success(`Imported ${result.success} game(s)`, {
          description: result.errors.length ? `${result.errors.length} row(s) had errors` : undefined,
        });
        invalidateAdmin();
      } else {
        showUserError('Import finished with some issues. Check the list.');
      }
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Import failed. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const resetImport = () => {
    setImportText('');
    setParsedPreview([]);
    setImportResult(null);
    setImportFileName('');
  };

  const closeImportDialog = () => {
    setShowImportDialog(false);
    resetImport();
  };

  // ===== PHASE 1 INGESTION FROM ADMIN UI (CLI flag + JSON seed + simulate) =====
  const generatePhase1Command = () => {
    const seed = phase1SeedText.trim();
    if (!seed) {
      toast.error('Provide JSON seed list first');
      return;
    }
    // Escape for shell (simple single quotes)
    const escaped = seed.replace(/'/g, "'\\''");
    const cmd = `SEED_JSON='${escaped}' DRY_RUN=true npm run ingest:games`;
    setPhase1Command(cmd);
    // Also support --admin-trigger in full CLI if wanted
    toast.success('CLI command generated (copy + run in terminal with IGDB keys + service role)');
  };

  const copyPhase1Command = async () => {
    if (!phase1Command) {
      generatePhase1Command();
      return;
    }
    try {
      await navigator.clipboard.writeText(phase1Command);
      toast.success('Copied! Paste in terminal (ensure .env has IGDB + SUPABASE_SERVICE_ROLE_KEY)');
    } catch {
      toast.error('Copy failed — select & copy manually');
    }
  };

  const simulatePhase1WithSeed = () => {
    try {
      const rows = JSON.parse(phase1SeedText);
      const arr = Array.isArray(rows) ? rows : [rows];
      // Validation-only preview (no writes): reuses the shared bulk-import row parser.
      const parsed = parseBulkGameRows(arr);
      const ok = parsed.filter((p) => p.ok).length;
      const issues = parsed.length - ok;
      const msg = `Seed preview: ${ok} row(s) valid. ${issues ? issues + ' issue(s).' : 'Clean.'}`;
      setPhase1SimResult(msg);
      toast.success('Seed preview complete (no data written)');
    } catch (e: any) {
      toast.error('Invalid JSON seed for simulation', { description: e.message });
      setPhase1SimResult(null);
    }
  };

  const clearPhase1 = () => {
    setPhase1Command('');
    setPhase1SimResult(null);
  };

  const refreshIngestQueue = async () => {
    if (!USE_REAL) return;
    try {
      const stats = await getIngestQueueStatsAction();
      setQueueStats(stats);
      const failed = await getFailedIngestRowsAction(10);
      setFailedIngestRows(
        failed.map((r) => ({ slug: r.slug, name: r.name, last_error: r.last_error }))
      );
    } catch {
      setQueueStats(null);
    }
  };

  React.useEffect(() => {
    if (!canAdmin || !USE_REAL) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshIngestQueue();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, canAdmin]);

  const handleRunIngestBatch = async (batchSize = 10) => {
    setIsRunningIngestBatch(true);
    try {
      const result = await runIngestBatchAction(batchSize);
      setQueueStats(result.stats);
      toast.success(`Batch done: ${result.success} ok, ${result.failed} failed`);
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Ingest batch failed');
    } finally {
      setIsRunningIngestBatch(false);
    }
  };

  const handleRetryFailedIngest = async () => {
    try {
      const { reset } = await retryFailedIngestAction();
      toast.success(`Reset ${reset} failed rows to pending`);
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Retry failed');
    }
  };

  // Automated discovery + enqueue for new Steam catalog games (admin only, uses queue path)
  const handleDiscoverAndEnqueueLatest = async (limit = 20) => {
    if (!USE_REAL) {
      toast('Discovery + enqueue is for real Supabase mode only');
      return;
    }
    setIsDiscoveringEnqueue(true);
    setDiscoverEnqueueResult(null);
    try {
      const res = await discoverAndEnqueueLatestAction({ limit });
      const msg = `${res.message} Pending now: ${res.stats.pending} (total ${res.stats.total}).`;
      setDiscoverEnqueueResult(msg);
      setQueueStats(res.stats);
      toast.success('Discover & Enqueue complete', {
        description: `${res.fresh} fresh → ${res.queueUpserted} queued (games ${res.gamesUpserted})`,
      });
      setRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Discover/enqueue failed';
      setDiscoverEnqueueResult(`ERROR: ${errMsg}`);
      showUserError(errMsg);
    } finally {
      setIsDiscoveringEnqueue(false);
    }
  };

  // ===== AGENT 4: PROTECTED SERVER ACTION HANDLER (ingestion trigger + normalize) =====
  const runProtectedIngestionAction = async (useFull18 = false) => {
    setIsIngestingAction(true);
    setIngestActionResult(null);
    try {
      let seeds: any[] = [];
      if (useFull18) {
        // Exact 18 using canonical slugs (guarantees match with lib/mock-data.ts + ingest script).
        // We pass explicit slugs for titles that would otherwise produce different results via normalizeSlug.
        seeds = [
          { name: 'Cyberpunk 2077', slug: 'cyberpunk-2077' },
          { name: 'Elden Ring', slug: 'elden-ring' },
          { name: 'Black Myth: Wukong', slug: 'black-myth-wukong' },
          { name: 'Starfield', slug: 'starfield' },
          { name: "Baldur's Gate 3", slug: 'baldurs-gate-3' },
          { name: 'Helldivers 2', slug: 'helldivers-2' },
          { name: 'Alan Wake 2', slug: 'alan-wake-2' },
          { name: 'Hogwarts Legacy', slug: 'hogwarts-legacy' },
          { name: 'The Witcher 3: Wild Hunt', slug: 'the-witcher-3' },
          { name: 'Counter-Strike 2', slug: 'counter-strike-2' },
          { name: 'VALORANT', slug: 'valorant' },
          { name: 'League of Legends', slug: 'league-of-legends' },
          { name: 'Dragon Age: The Veilguard', slug: 'dragon-age-veilguard' },
          { name: 'Monster Hunter Wilds', slug: 'monster-hunter-wilds' },
          { name: 'Palworld', slug: 'palworld' },
          { name: 'Hades II', slug: 'hades-2' },
          { name: 'Warhammer 40,000: Darktide', slug: 'warhammer-darktide' },
          { name: 'Factorio', slug: 'factorio' },
        ];
      } else {
        try {
          const parsed = JSON.parse(phase1SeedText || '[]');
          seeds = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          seeds = [];
        }
      }
      const res = await triggerIngestionAction(seeds);
      const msg = `Protected Action: ${res.message} | ${res.count} seeds normalized via normalizeSlug. Authorized: ${res.authorized}. (Run CLI ingest for full IGDB+Storage pipeline.)`;
      setIngestActionResult(msg);
      toast.success('Protected ingestion action succeeded', { description: `${res.count} seeds` });
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      const errMsg = e?.message || 'Protected action failed (role check or network). Use demo admin role + real auth for full enforcement.';
      setIngestActionResult(`ERROR: ${errMsg}`);
      showUserError(`Ingestion action denied or failed: ${errMsg}`);
    } finally {
      setIsIngestingAction(false);
    }
  };

  // ===== REPORTS MODERATION =====
  const openNotesForAction = (reportId: string, status: ReportStatus) => {
    setActiveReportId(reportId);
    setActionStatus(status);
    setModeratorNotes('');
    setShowNotesDialog(true);
  };

  const performModerationAction = async (reportIds: string[], status: ReportStatus, notes?: string) => {
    if (!canModerate) {
      toast.error('Insufficient permissions (demo role)');
      return;
    }
    if (reportIds.length === 0) return;
    setIsModeratingReport(true);
    try {
      const updated = await moderateReports(reportIds, status, notes);
      toast.success(
        reportIds.length === 1 ? `Report ${status}` : `${updated} report(s) ${status}`,
        { description: notes ? 'Notes saved' : undefined }
      );
      setSelectedReportIds((prev) => {
        const next = new Set(prev);
        for (const id of reportIds) next.delete(id);
        return next;
      });
      invalidateAdmin();
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setIsModeratingReport(false);
      setShowNotesDialog(false);
      setActiveReportId('');
    }
  };

  const quickModerate = (reportId: string, status: ReportStatus) => {
    void performModerationAction([reportId], status);
  };

  const bulkModerateSelected = (status: ReportStatus) => {
    void performModerationAction(Array.from(selectedReportIds), status);
  };

  const bulkDeleteSelectedReports = async () => {
    if (!canAdmin) {
      toast.error('Only admins can delete reports');
      return;
    }
    const ids = Array.from(selectedReportIds);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} report(s)? This cannot be undone.`)) return;
    setIsModeratingReport(true);
    try {
      const deleted = await deleteReports(ids);
      toast.success(`${deleted} report(s) deleted`);
      setSelectedReportIds(new Set());
      invalidateAdmin();
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to delete reports');
    } finally {
      setIsModeratingReport(false);
    }
  };

  const visibleReports = reports.slice(0, 50);
  const allVisibleReportsSelected =
    visibleReports.length > 0 && visibleReports.every((r) => selectedReportIds.has(r.id));

  const toggleReportSelected = (id: string) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisibleReports = () => {
    setSelectedReportIds((prev) => {
      if (allVisibleReportsSelected) return new Set();
      const next = new Set(prev);
      for (const r of visibleReports) next.add(r.id);
      return next;
    });
  };

  // ===== HARDWARE ALIASES =====
  const openAliasDialog = (alias?: HardwareAlias) => {
    if (alias) {
      setEditingAlias(alias);
      setAliasForm({
        rawString: alias.rawString,
        canonical: alias.canonical,
        vendor: alias.vendor || '',
        series: alias.series || '',
      });
    } else {
      setEditingAlias(null);
      setAliasForm({ rawString: '', canonical: '', vendor: '', series: '' });
    }
    setShowAliasDialog(true);
  };

  const saveAlias = async () => {
    if (!canModerate) {
      toast.error('Moderator+ required');
      return;
    }
    const safeRaw = sanitizeFullName(aliasForm.rawString);
    const safeCanonical = sanitizeFullName(aliasForm.canonical);
    const safeVendor = sanitizeFullName(aliasForm.vendor || '');
    const safeSeries = sanitizeFullName(aliasForm.series || '');

    if (!safeRaw || !safeCanonical) {
      showUserError('Raw string and canonical name are required');
      return;
    }

    const input = {
      rawString: safeRaw,
      canonical: safeCanonical,
      vendor: safeVendor || null,
      series: safeSeries || null,
    };

    setIsSavingAlias(true);
    try {
      if (editingAlias) {
        await updateHardwareAlias(editingAlias.id, input);
        toast.success('Alias updated');
      } else {
        await createHardwareAlias(input);
        toast.success('Alias added');
      }
      setShowAliasDialog(false);
      invalidateAdmin();
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to save alias');
    } finally {
      setIsSavingAlias(false);
    }
  };

  const handleDeleteAlias = async (id: string, raw: string) => {
    if (!canAdmin) {
      toast.error('Only admins can delete aliases');
      return;
    }
    if (!confirm(`Delete alias for "${raw}"?`)) return;
    try {
      const ok = await deleteHardwareAlias(id);
      if (ok) {
        toast.success('Alias deleted');
        invalidateAdmin();
      } else {
        toast.error('Alias not found');
      }
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to delete alias');
    }
  };

  // ===== IMAGES =====
  const handleImageAction = async (imageIds: string[], status: ImageStatus) => {
    if (!canModerate) {
      toast.error('Moderator+ required');
      return;
    }
    if (imageIds.length === 0) return;
    setIsModeratingImages(true);
    try {
      const updated = await moderateReportImages(imageIds, status);
      toast.success(imageIds.length === 1 ? `Image ${status}` : `${updated} image(s) ${status}`);
      setSelectedImageIds((prev) => {
        const next = new Set(prev);
        for (const id of imageIds) next.delete(id);
        return next;
      });
      invalidateAdmin();
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to update image status');
    } finally {
      setIsModeratingImages(false);
    }
  };

  const handleDeleteImages = async (imageIds: string[]) => {
    if (!canAdmin) {
      toast.error('Admin only');
      return;
    }
    if (imageIds.length === 0) return;
    if (!confirm(imageIds.length === 1 ? 'Delete this image reference?' : `Delete ${imageIds.length} image references?`)) return;
    setIsModeratingImages(true);
    try {
      const deleted = await deleteReportImages(imageIds);
      toast.success(`${deleted} image(s) removed`);
      setSelectedImageIds(new Set());
      invalidateAdmin();
    } catch (e: unknown) {
      showUserError(e instanceof Error ? e.message : 'Failed to delete images');
    } finally {
      setIsModeratingImages(false);
    }
  };

  const toggleImageSelected = (id: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Admin Header */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Admin Tools</h1>
              <p className="text-muted-foreground">
                {USE_REAL ? 'Live moderation • Supabase RLS + audited RPCs' : 'Demo mode • localStorage-backed tools'}
              </p>
            </div>
          </div>
        </div>

        {/* Demo Role Switcher (demo mode only; real mode enforces profiles.role server-side) */}
        {!USE_REAL && (
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-1 py-1 text-xs">
            <span className="pl-2 text-muted-foreground">Demo role:</span>
            {(['user', 'moderator', 'admin'] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={demoRole === r ? 'default' : 'ghost'}
                className="h-7 px-3 text-xs"
                onClick={() => persistRole(r)}
              >
                {ROLE_LABELS[r]}
              </Button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {demoRole === 'admin' && 'Full access • '}
            {canModerate ? 'Can moderate reports & images' : 'Read-only in this role (demo)'}
          </div>
        </div>
        )}
      </div>

      {/* Mode banner */}
      {USE_REAL ? (
        <div className="mb-6 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <strong>Live mode:</strong> moderation, alias and image changes are written to Supabase through
              staff-checked Server Actions and <code>SECURITY DEFINER</code> RPCs, and every change is recorded in{' '}
              <code>moderation_log</code>. Requires <code>supabase/incremental-admin-moderation.sql</code>.
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <strong>Demo mode:</strong> All changes persist in your browser (localStorage).
              With Supabase keys configured this page enforces <code>profiles.role IN (&apos;moderator&apos;,&apos;admin&apos;)</code> via RLS + server checks.
            </div>
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total Games', value: stats.totalGames, icon: Database },
          { label: 'Total Reports', value: stats.totalReports, icon: FileText },
          { label: 'Pending Reports', value: stats.pendingReports, icon: AlertTriangle, highlight: true },
          { label: 'Hardware Aliases', value: stats.hardwareAliases, icon: Users },
          { label: 'Pending Images', value: stats.pendingImages, icon: ImageIcon },
          { label: 'Imported Games', value: stats.importedGames, icon: Upload },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="h-4 w-4" />
              <span className="text-xs uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className={`mt-1 text-3xl font-semibold tabular-nums ${stat.highlight ? 'text-amber-400' : ''}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Tabbed Interface */}
      <Tabs defaultValue="reports" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="reports">Reports Queue</TabsTrigger>
          <TabsTrigger value="games">Games Management</TabsTrigger>
          <TabsTrigger value="hardware">Hardware Aliases</TabsTrigger>
          <TabsTrigger value="catalog">Hardware Catalog</TabsTrigger>
          <TabsTrigger value="images">Image Review</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
        </TabsList>

        {/* REPORTS MODERATION QUEUE */}
        <TabsContent value="reports" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Moderation Queue</h2>
              <p className="text-sm text-muted-foreground">Review, approve, reject or flag user-submitted reports.</p>
            </div>
            <Button variant="outline" size="sm" onClick={invalidateAdmin} disabled={isReportsLoading}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
          </div>

          {/* Status Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'pending', 'approved', 'rejected', 'flagged'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={reportFilter === s ? 'default' : 'outline'}
                onClick={() => setReportFilter(s)}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>

          {selectedReportIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span className="font-medium">{selectedReportIds.size} selected</span>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingReport} onClick={() => bulkModerateSelected('approved')}>
                <Check className="mr-1 h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingReport} onClick={() => bulkModerateSelected('rejected')}>
                <X className="mr-1 h-3.5 w-3.5" /> Reject
              </Button>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingReport} onClick={() => bulkModerateSelected('flagged')}>
                <Flag className="mr-1 h-3.5 w-3.5" /> Flag
              </Button>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingReport} onClick={() => bulkModerateSelected('pending')}>
                Back to pending
              </Button>
              {canAdmin && (
                <Button size="sm" variant="destructive" disabled={isModeratingReport} onClick={() => void bulkDeleteSelectedReports()}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedReportIds(new Set())}>Clear</Button>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible reports"
                      className="h-4 w-4 accent-primary"
                      checked={allVisibleReportsSelected}
                      onChange={toggleAllVisibleReports}
                      disabled={visibleReports.length === 0}
                    />
                  </TableHead>
                  <TableHead>Game</TableHead>
                  <TableHead>Hardware</TableHead>
                  <TableHead className="text-right">FPS</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(isReportsLoading || reports.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {isReportsLoading ? 'Loading moderation queue...' : 'No reports match the current filter.'}
                    </TableCell>
                  </TableRow>
                )}
                {visibleReports.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30" data-state={selectedReportIds.has(r.id) ? 'selected' : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select report ${r.gameName || r.id}`}
                        className="h-4 w-4 accent-primary"
                        checked={selectedReportIds.has(r.id)}
                        onChange={() => toggleReportSelected(r.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/games/${r.gameId}`} className="hover:underline text-primary">
                        {r.gameName || 'Unknown Game'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.gpu}<br />{r.cpu} • {r.ram}GB
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">{r.avgFps}</TableCell>
                    <TableCell><PerformanceBadge tier={r.performanceTier} size="sm" /></TableCell>
                    <TableCell>
                      <Badge 
                        variant={r.status === 'pending' ? 'secondary' : r.status === 'approved' ? 'default' : 'destructive'}
                        className="capitalize"
                      >
                        {r.status}
                      </Badge>
                      {r.moderatorNotes && <div className="mt-1 text-[10px] text-muted-foreground line-clamp-1">{r.moderatorNotes}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-7 text-green-400 hover:bg-green-950/60 hover:text-green-300"
                          disabled={!canModerate || isModeratingReport}
                          onClick={() => quickModerate(r.id, 'approved')}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-7 text-red-400 hover:bg-red-950/60 hover:text-red-300"
                          disabled={!canModerate || isModeratingReport}
                          onClick={() => quickModerate(r.id, 'rejected')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-7 hover:bg-accent/70"
                          disabled={!canModerate || isModeratingReport}
                          onClick={() => openNotesForAction(r.id, 'flagged')}
                        >
                          <Flag className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-7 text-xs hover:bg-accent/70"
                          disabled={!canModerate || isModeratingReport}
                          onClick={() => openNotesForAction(r.id, r.status === 'pending' ? 'approved' : r.status || 'approved')}
                        >
                          Notes
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {reports.length > 50 && (
            <p className="text-center text-xs text-muted-foreground">Showing first 50 results.</p>
          )}
        </TabsContent>

        {/* GAMES MANAGEMENT + BULK IMPORT */}
        <TabsContent value="games" className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Games Management</h2>
              <p className="text-sm text-muted-foreground">Browse current catalog (with preview thumbnails) and bulk-import. Protected ingestion for exact 18 games via Server Action (Agent 4).</p>
            </div>
            <Button onClick={() => setShowImportDialog(true)} className="gap-2">
              <Upload className="h-4 w-4" /> Bulk Import (CSV / JSON)
            </Button>
          </div>

          <div className="flex gap-3">
            <Input
              placeholder="Search games by name, developer, slug..."
              value={gameSearch}
              onChange={(e) => setGameSearch(sanitizeFullName(e.target.value))}
              className="max-w-md"
            />
            <Button variant="outline" onClick={invalidateAdmin} size="icon"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {USE_REAL && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold">Ingest Queue (ProtonDB → IGDB enrich)</div>
                  <div className="text-xs text-muted-foreground">
                    Two-phase catalog: skeleton from <code className="text-[10px]">npm run seed:queue</code> or Discover button, enrich via worker or batch below. Automated latest via Steam discovery.
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={refreshIngestQueue} disabled={!canAdmin}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                </Button>
              </div>

              {queueStats ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-center text-sm">
                    <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-semibold">{queueStats.pending}</div><div className="text-[10px] text-muted-foreground uppercase">Pending</div></div>
                    <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-semibold">{queueStats.processing}</div><div className="text-[10px] text-muted-foreground uppercase">Processing</div></div>
                    <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-semibold text-green-500">{queueStats.done}</div><div className="text-[10px] text-muted-foreground uppercase">Done</div></div>
                    <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-semibold text-amber-500">{queueStats.failed}</div><div className="text-[10px] text-muted-foreground uppercase">Failed</div></div>
                    <div className="rounded-lg bg-muted/40 p-2"><div className="text-lg font-semibold">{queueStats.total}</div><div className="text-[10px] text-muted-foreground uppercase">Total</div></div>
                  </div>
                  {queueStats.total > 0 && (
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${Math.round((queueStats.done / queueStats.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => handleRunIngestBatch(10)} disabled={!canAdmin || isRunningIngestBatch}>
                      {isRunningIngestBatch ? 'Running…' : 'Run batch (10)'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => handleRunIngestBatch(50)} disabled={!canAdmin || isRunningIngestBatch}>
                      Run batch (50)
                    </Button>
                    {queueStats.failed > 0 && (
                      <Button size="sm" variant="outline" onClick={handleRetryFailedIngest} disabled={!canAdmin}>
                        Retry failed ({queueStats.failed})
                      </Button>
                    )}
                  </div>

                  {/* Automated discovery integration path (plan AC3) */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
                    <Button 
                      size="sm" 
                      onClick={() => handleDiscoverAndEnqueueLatest(15)} 
                      disabled={!canAdmin || isDiscoveringEnqueue}
                      className="gap-1.5"
                      title="Admin-only: call discover + enqueueSeeds for Steam chart releases not yet present (idempotent; populates skeletons + pending queue)"
                    >
                      {isDiscoveringEnqueue ? 'Discovering & Enqueuing…' : 'Discover & Enqueue Latest Games'}
                    </Button>
                    <span className="text-[10px] text-muted-foreground">Steam charts → fresh candidates → game rows + queue (no manual seeds)</span>
                  </div>
                  {failedIngestRows.length > 0 && (
                    <div className="text-xs space-y-1 max-h-32 overflow-y-auto">
                      <div className="font-medium text-muted-foreground">Recent failures</div>
                      {failedIngestRows.map((r) => (
                        <div key={r.slug} className="font-mono text-[10px] text-amber-600/90">
                          {r.name}: {r.last_error ?? 'unknown'}
                        </div>
                      ))}
                    </div>
                  )}

                  {discoverEnqueueResult && (
                    <div className="rounded bg-primary/5 border border-primary/20 p-2 text-xs font-mono break-words">
                      {discoverEnqueueResult}
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground">
                    CLI: <code>npm run build:seed</code> → <code>npm run seed:queue</code> → <code>npm run ingest:worker -- --batch=50</code>.
                    Or use Discover button above for automated Steam latest. ProtonDB data ODbL · IGDB · Steam.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Queue not available — run <code className="text-xs">supabase/incremental-game-ingest-queue.sql</code> then seed.
                </p>
              )}
            </div>
          )}

          {/* PHASE 1 / AGENT 4 REAL INGESTION TRIGGER — protected Server Action + CLI + sim */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold flex items-center gap-2">Phase 1 Ingestion + Admin Tooling (Agent 4 / PR 4)</div>
                <div className="text-xs text-muted-foreground">Protected Server Action (admin role) + CLI generator. Exact current 18 games + clean slug normalization. Preview thumbnails below in catalog.</div>
              </div>
              <Button variant="outline" size="sm" onClick={clearPhase1}>Clear</Button>
            </div>

            <Textarea
              value={phase1SeedText}
              onChange={(e) => setPhase1SeedText(e.target.value)}
              placeholder='[{"name":"Game Name","slug":"game-slug"}]'
              className="h-20 font-mono text-xs"
            />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={generatePhase1Command} className="gap-2">
                Generate CLI Command (DRY_RUN)
              </Button>
              <Button size="sm" variant="secondary" onClick={copyPhase1Command} disabled={!phase1Command}>
                Copy Command
              </Button>
              <Button size="sm" variant="outline" onClick={simulatePhase1WithSeed}>
                Simulate Seed (mock bulk)
              </Button>
              {/* New protected button per mission */}
              <Button 
                size="sm" 
                onClick={() => runProtectedIngestionAction(false)} 
                disabled={isIngestingAction || !canAdmin}
                className="gap-2"
                title={canAdmin ? 'Calls protected triggerIngestionAction (real role check in prod)' : 'Admin role required (demo toggle above)'}
              >
                {isIngestingAction ? 'Authorizing…' : 'Protected Ingest (Server Action)'}
              </Button>
              <Button 
                size="sm" 
                variant="default"
                onClick={() => runProtectedIngestionAction(true)} 
                disabled={isIngestingAction || !canAdmin}
                className="gap-2"
              >
                {isIngestingAction ? '…' : 'Ingest All Exact 18 (Protected)'}
              </Button>
            </div>

            {phase1Command && (
              <div className="rounded bg-muted/50 p-2 text-[10px] font-mono break-all border">
                {phase1Command}
              </div>
            )}
            {phase1SimResult && (
              <div className="text-xs text-green-400">{phase1SimResult}</div>
            )}
            {ingestActionResult && (
              <div className="rounded bg-primary/10 border border-primary/30 p-2 text-xs font-mono">{ingestActionResult}</div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Tip: Protected Action normalizes via shared fn (exact 18 slugs). For full pipeline (IGDB+Sharp+Storage) run the CLI cmd with keys. Thumbnails + bulk dialog updated for Agent 4.
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Thumb</TableHead>
                  <TableHead>Name / Slug</TableHead>
                  <TableHead>Developer</TableHead>
                  <TableHead>Genres</TableHead>
                  <TableHead>Year</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGames.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No games found.</TableCell></TableRow>
                )}
                {filteredGames.slice(0, 30).map((game) => (
                  <TableRow key={game.id}>
                    <TableCell>
                      {/* Agent 4: preview thumbnails in admin catalog (uses picsum for mock; gameMediaLoader for real covers) */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={game.coverImage || `https://picsum.photos/id/${(game.id.charCodeAt(0) % 30) + 10}/48/64`} 
                        alt={game.name} 
                        className="h-10 w-8 object-cover rounded border border-border" 
                        loading="lazy"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{game.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{game.slug}</div>
                    </TableCell>
                    <TableCell className="text-sm">{game.developer}</TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{game.genres.slice(0,3).map(g => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}</div></TableCell>
                    <TableCell>{game.releaseYear}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing up to 30 matches. {USE_REAL ? 'Bulk-imported games are inserted as skeleton rows (admin only) and enriched by the ingest worker.' : 'Imported games persist in this browser.'}
          </p>
        </TabsContent>

        {/* HARDWARE NORMALIZATION WORKBENCH */}
        <TabsContent value="hardware" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Hardware Normalization Workbench</h2>
              <p className="text-sm text-muted-foreground">Map raw user-entered strings (GPU/CPU) to canonical names for better matching.</p>
            </div>
            <Button onClick={() => openAliasDialog()} disabled={!canModerate} className="gap-2">
              <Plus className="h-4 w-4" /> Add Alias
            </Button>
          </div>

          <Input
            placeholder="Search aliases (raw, canonical, vendor)..."
            value={aliasSearch}
            onChange={(e) => setAliasSearch(sanitizeFullName(e.target.value))}
            className="max-w-md"
          />

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raw String</TableHead>
                  <TableHead>Canonical</TableHead>
                  <TableHead>Vendor / Series</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8">{aliasesQuery.isPending ? 'Loading aliases...' : 'No aliases.'}</TableCell></TableRow>}
                {aliases.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.rawString}</TableCell>
                    <TableCell className="font-medium">{a.canonical}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.vendor} {a.series && `· ${a.series}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" className="h-8 w-8 hover:bg-accent/70" disabled={!canModerate} onClick={() => openAliasDialog(a)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!canAdmin} onClick={() => void handleDeleteAlias(a.id, a.rawString)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* IMAGE MANAGEMENT */}
        <TabsContent value="images" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Image Management</h2>
              <p className="text-sm text-muted-foreground">Review and moderate user-uploaded proof screenshots attached to reports.</p>
            </div>
            <div className="flex gap-2">
              {(['all','pending','approved','rejected'] as const).map((f) => (
                <Button key={f} size="sm" variant={imageFilter === f ? 'default' : 'outline'} onClick={() => setImageFilter(f)}>
                  {f}
                </Button>
              ))}
            </div>
          </div>

          {selectedImageIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <span className="font-medium">{selectedImageIds.size} selected</span>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingImages} onClick={() => void handleImageAction(Array.from(selectedImageIds), 'approved')}>Approve</Button>
              <Button size="sm" variant="outline" disabled={!canModerate || isModeratingImages} onClick={() => void handleImageAction(Array.from(selectedImageIds), 'rejected')}>Reject</Button>
              {canAdmin && (
                <Button size="sm" variant="destructive" disabled={isModeratingImages} onClick={() => void handleDeleteImages(Array.from(selectedImageIds))}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedImageIds(new Set())}>Clear</Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {images.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed p-12 text-center text-muted-foreground">
                {imagesQuery.isPending ? 'Loading images...' : 'No images for this filter.'}
              </div>
            )}
            {images.map((img) => (
              <div key={img.id} className="group overflow-hidden rounded-xl border border-border bg-card">
                <div className="relative aspect-video bg-black">
                  <label className="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/60">
                    <input
                      type="checkbox"
                      aria-label="Select image"
                      className="h-4 w-4 accent-primary"
                      checked={selectedImageIds.has(img.id)}
                      onChange={() => toggleImageSelected(img.id)}
                    />
                  </label>
                  {/* Phase 1 image strategy: Next Image + custom loader (WebP/AVIF/responsive via Supabase transforms or optimized files) */}
                  <Image
                    loader={gameMediaLoader}
                    src={img.imageUrl}
                    alt={img.caption || 'Report screenshot'}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                  <div className="absolute top-2 right-2">
                    <Badge variant={img.status === 'pending' ? 'secondary' : img.status === 'approved' ? 'default' : 'destructive'}>
                      {img.status}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 text-sm">
                  <div className="line-clamp-1 font-medium">{img.caption || 'No caption'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Report #{img.reportId.slice(0, 8)}</div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" disabled={!canModerate || isModeratingImages} onClick={() => void handleImageAction([img.id], 'approved')} className="flex-1">Approve</Button>
                    <Button size="sm" variant="outline" disabled={!canModerate || isModeratingImages} onClick={() => void handleImageAction([img.id], 'rejected')} className="flex-1">Reject</Button>
                    <Button size="sm" variant="destructive" disabled={!canAdmin || isModeratingImages} onClick={() => void handleDeleteImages([img.id])}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* OVERVIEW / HELP */}
        <TabsContent value="overview">
          <div className="prose prose-invert max-w-none rounded-xl border border-border bg-card p-8">
            <h3 className="mt-0">RunDB Admin Console — Phase 4</h3>
            <p>
              This section provides the core administrative tooling required for operating a healthy community hardware database.
            </p>
            <ul className="space-y-1 text-sm">
              <li><strong>Reports Queue</strong> — The heart of moderation. Bulk actions + per-report notes.</li>
              <li><strong>Games Management + Bulk Import</strong> — CSV/JSON ingestion + preview thumbnails. Protected Server Action for exact 18 games (clean slug normalization via shared util). See Agent 4 / ingest script.</li>
              <li><strong>Hardware Normalization</strong> — Curated alias table powers future similarity / canonical matching in the compatibility engine.</li>
              <li><strong>Image Review</strong> — Lightweight moderation for user-submitted proof images.</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-6">
              Real mode: Server Actions in <code>app/actions/admin.ts</code> verify <code>profiles.role</code> (or the server-only
              <code> ADMIN_EMAILS</code> allowlist) and call the audited RPCs from <code>supabase/incremental-admin-moderation.sql</code>
              (<code>moderate_reports</code>, <code>moderate_report_images</code>, admin-only deletes). Every change lands in <code>moderation_log</code>.
            </p>
          </div>
        </TabsContent>

        {/* HARDWARE CATALOG — Now Live in Production */}
        <TabsContent value="catalog" className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold">Hardware Catalog (Live)</h3>
              <p className="text-sm text-muted-foreground">
                Production hardware database. When <code>NEXT_PUBLIC_USE_REAL_DATA=true</code>, the combobox, similarity engine, and predictions use this table.
              </p>
            </div>
            <Button 
              onClick={async () => {
                if (!canAdmin) return alert('Only admins can seed the live catalog')
                if (!confirm('Seed the entire static catalog into the live database? This is safe (idempotent).')) return
                
                try {
                  const { seedStaticCatalogIntoDatabase } = await import('@/app/actions/hardware-catalog')
                  const res = await seedStaticCatalogIntoDatabase()
                  alert(res.message)
                  window.location.reload()
                } catch (e: any) {
                  alert('Seeding failed: ' + (e.message || e))
                }
              }}
              disabled={!canAdmin}
              className="gap-2"
            >
              <Upload className="h-4 w-4" /> Seed Static Catalog into Live DB
            </Button>
          </div>

          <div className="rounded-xl border p-6 bg-muted/30">
            <div className="text-sm">
              <strong>Status:</strong> Using static catalog as primary source + DB overrides when available.
              <br />
              Run the seed button above (as admin) after setting up the <code>hardware_catalog</code> table in Supabase to go fully live.
            </div>
            <div className="mt-3 text-sm font-medium">
              Current static catalog (expanded 2015-16+ per plan):{' '}
              {(() => {
                try {
                  const s = getHardwareCatalogStats();
                  return `${s.gpuCount} GPUs + ${s.cpuCount} CPUs (total ${s.total}, years ${s.minReleaseYear}-${s.maxReleaseYear})`;
                } catch { return 'loading stats...'; }
              })()}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            The catalog is already powering the new HardwareCombobox everywhere. Adding entries to the DB table will make them appear in production autocomplete and improve matching. Use bulkUpsertHardwareCatalogEntries (via future dialog or script) for CSV/JSON adds of older cards.
          </div>
        </TabsContent>
      </Tabs>

      {/* ===== IMPORT DIALOG ===== */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Games</DialogTitle>
            <DialogDescription>
              Upload a CSV or JSON file, or paste data. Supports common columns (name, slug, developer, genres, releaseYear, coverImage, publisher). Thumbnails shown in preview (Agent 4).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Tabs value={importTab} onValueChange={(v) => { setImportTab(v as any); if (importText) processImportText(importText, v as any); }}>
              <TabsList>
                <TabsTrigger value="csv">CSV</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex gap-3">
              <label className="flex-1 cursor-pointer rounded-md border border-dashed border-border p-6 text-center hover:bg-accent/50">
                <Upload className="mx-auto h-6 w-6 mb-2" />
                <div className="text-sm font-medium">Drop or click to upload .csv / .json</div>
                <input type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={handleFileUpload} />
                {importFileName && <div className="mt-1 text-xs text-primary">{importFileName}</div>}
              </label>
              <div className="flex-1">
                <Textarea
                  placeholder={importTab === 'csv' ? 'name,slug,developer,genres,year\nCyberpunk 2077,cyberpunk-2077,CDPR,"Action,RPG",2020' : '[{ "name": "...", "slug": "..." }]'}
                  value={importText}
                  onChange={(e) => { setImportText(e.target.value); processImportText(e.target.value); }}
                  className="h-32 font-mono text-xs"
                />
              </div>
            </div>

            {parsedPreview.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Preview ({parsedPreview.length} rows shown)</div>
                <div className="max-h-48 overflow-auto rounded border border-border bg-background p-2 text-xs font-mono">
                  {JSON.stringify(parsedPreview.slice(0, 5), null, 2)}
                </div>
              </div>
            )}

            {importResult && (
              <div className="rounded border border-border bg-muted/50 p-3 text-sm">
                <div className="font-medium">Import complete: {importResult.success} success, {importResult.errors.length} error(s)</div>
                {importResult.errors.length > 0 && (
                  <ul className="mt-1 text-xs text-destructive">
                    {importResult.errors.slice(0, 4).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="hover:bg-accent/70" onClick={resetImport}>Reset</Button>
            <Button onClick={runBulkImport} disabled={isImporting || parsedPreview.length === 0}>
              {isImporting ? 'Importing...' : 'Import Games'}
            </Button>
            <Button variant="ghost" className="hover:bg-accent/70" onClick={closeImportDialog}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== ALIAS EDIT/ADD DIALOG ===== */}
      <Dialog open={showAliasDialog} onOpenChange={setShowAliasDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAlias ? 'Edit' : 'Add'} Hardware Alias</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs text-muted-foreground">Raw String (what users type)</label>
              <Input value={aliasForm.rawString} onChange={(e) => setAliasForm({ ...aliasForm, rawString: e.target.value })} placeholder="rtx 4090" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Canonical Name</label>
              <Input value={aliasForm.canonical} onChange={(e) => setAliasForm({ ...aliasForm, canonical: e.target.value })} placeholder="NVIDIA GeForce RTX 4090" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Vendor</label>
                <Input value={aliasForm.vendor} onChange={(e) => setAliasForm({ ...aliasForm, vendor: e.target.value })} placeholder="NVIDIA" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Series</label>
                <Input value={aliasForm.series} onChange={(e) => setAliasForm({ ...aliasForm, series: e.target.value })} placeholder="RTX 40" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="hover:bg-accent/70" onClick={() => setShowAliasDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => void saveAlias()}
              disabled={isSavingAlias}
              className="bg-white text-black font-medium hover:bg-white/90"
            >
              {isSavingAlias ? 'Saving...' : editingAlias ? 'Save Changes' : 'Add Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== MODERATION NOTES DIALOG ===== */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Moderate Report</DialogTitle>
            <DialogDescription>
              Set status to <strong>{actionStatus}</strong> and (optionally) add moderator notes.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Notes for the submitter or internal record (visible to moderators)..."
            value={moderatorNotes}
            onChange={(e) => setModeratorNotes(e.target.value)}
            className="min-h-[120px]"
          />
          <DialogFooter>
            <Button variant="ghost" className="hover:bg-accent/70" onClick={() => setShowNotesDialog(false)}>Cancel</Button>
            <Button
              disabled={isModeratingReport || !activeReportId}
              onClick={() => void performModerationAction([activeReportId], actionStatus, moderatorNotes || undefined)}
            >
              {isModeratingReport ? 'Saving...' : `Confirm ${actionStatus}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
