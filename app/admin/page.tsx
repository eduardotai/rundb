'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  getAdminOverviewStats, 
  getModerationQueue, 
  updateReportStatus,
  getHardwareAliases, 
  addHardwareAlias, 
  updateHardwareAlias, 
  deleteHardwareAlias,
  getAllGamesForAdmin,
  bulkImportGames,
  parseCSV,
  getReportImages,
  updateImageStatus,
  deleteReportImage,
} from '@/lib/data';
import type { AdminReport, HardwareAlias, ReportStatus, BulkImportResult } from '@/lib/types';
import {
  getModerationQueueAction,
  moderateReportAction,
  triggerIngestionAction,
} from '@/app/actions/reports';  // Agent 4 protected Server Action
import {
  getIngestQueueStatsAction,
  runIngestBatchAction,
  retryFailedIngestAction,
  getFailedIngestRowsAction,
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

  // Data states — compute via memos from pure getters to avoid setState-in-effect
  const [reportFilter, setReportFilter] = useState<ReportStatus | 'all'>('pending');
  const [realReports, setRealReports] = useState<AdminReport[]>([]);
  const [isReportsLoading, setIsReportsLoading] = useState(false);
  const [isModeratingReport, setIsModeratingReport] = useState(false);
  const [aliasSearch, setAliasSearch] = useState('');
  const [gameSearch, setGameSearch] = useState('');
  const [imageFilter, setImageFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
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

  // Reactive data via useMemo (avoids setState inside effects)
  const stats = useMemo(() => getAdminOverviewStats(), [refreshKey]);
  const mockReports = useMemo(() => getModerationQueue(reportFilter), [reportFilter, refreshKey]);
  const reports = USE_REAL ? realReports : mockReports;
  const aliases = useMemo(() => getHardwareAliases(aliasSearch), [aliasSearch, refreshKey]);
  const games = useMemo(() => getAllGamesForAdmin(), [refreshKey]);
  const images = useMemo(() => getReportImages(imageFilter), [imageFilter, refreshKey]);

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
      const result = bulkImportGames(Array.isArray(rows) ? rows : [rows]);
      setImportResult(result);

      if (result.success > 0) {
        toast.success(`Imported ${result.success} game(s)`, {
          description: result.errors.length ? `${result.errors.length} row(s) had errors` : undefined,
        });
        setRefreshKey((k) => k + 1);
      } else {
        showUserError('Import finished with some issues. Check the list.');
      }
    } catch {
      showUserError('Import failed. Please try again.');
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
      // Reuse existing bulk import (demo / mock path) to "trigger" format validation
      const result = bulkImportGames(arr);
      const msg = `Simulated Phase 1 seed: ${result.success} games would import (mock). ${result.errors.length ? result.errors.length + ' issues' : 'Clean.'}`;
      setPhase1SimResult(msg);
      toast.success('Phase 1 simulation complete (uses bulkImportGames for preview)');
      setRefreshKey((k) => k + 1);
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

  React.useEffect(() => {
    if (!USE_REAL) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIsReportsLoading(true);
      getModerationQueueAction(reportFilter)
        .then((rows) => {
          if (!cancelled) setRealReports(rows);
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setRealReports([]);
            showUserError(e instanceof Error ? e.message : 'Failed to load moderation queue.');
          }
        })
        .finally(() => {
          if (!cancelled) setIsReportsLoading(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [reportFilter, refreshKey]);

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

  const performModerationAction = async (reportId: string, status: ReportStatus, notes?: string) => {
    if (!canModerate) {
      toast.error('Insufficient permissions (demo role)');
      return;
    }
    if (USE_REAL) {
      setIsModeratingReport(true);
      try {
        await moderateReportAction(reportId, status, notes);
        toast.success(`Report ${status}`, { description: notes ? 'Notes saved' : undefined });
        setRefreshKey((k) => k + 1);
      } catch (e: unknown) {
        showUserError(e instanceof Error ? e.message : 'Failed to update status');
      } finally {
        setIsModeratingReport(false);
        setShowNotesDialog(false);
        setActiveReportId('');
      }
      return;
    }

    const ok = updateReportStatus(reportId, status, notes);
    if (ok) {
      toast.success(`Report ${status}`, { description: notes ? 'Notes saved' : undefined });
      setRefreshKey((k) => k + 1);
    } else {
      toast.error('Failed to update status');
    }
    setShowNotesDialog(false);
    setActiveReportId('');
  };

  const quickModerate = (reportId: string, status: ReportStatus) => {
    void performModerationAction(reportId, status);
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

  const saveAlias = () => {
    const safeRaw = sanitizeFullName(aliasForm.rawString);
    const safeCanonical = sanitizeFullName(aliasForm.canonical);
    const safeVendor = sanitizeFullName(aliasForm.vendor || '');
    const safeSeries = sanitizeFullName(aliasForm.series || '');

    if (!safeRaw || !safeCanonical) {
      showUserError('Raw string and canonical name are required');
      return;
    }

    if (editingAlias) {
      const ok = updateHardwareAlias(editingAlias.id, {
        rawString: safeRaw,
        canonical: safeCanonical,
        vendor: safeVendor || undefined,
        series: safeSeries || undefined,
      });
      if (ok) toast.success('Alias updated');
    } else {
      const created = addHardwareAlias(
        safeRaw,
        safeCanonical,
        safeVendor || undefined,
        safeSeries || undefined
      );
      if (created) {
        toast.success('Alias added');
      } else {
        toast.error('Alias already exists for that raw string');
        return;
      }
    }
    setShowAliasDialog(false);
    setRefreshKey((k) => k + 1);
  };

  const handleDeleteAlias = (id: string, raw: string) => {
    if (!canAdmin) {
      toast.error('Only admins can delete aliases');
      return;
    }
    if (!confirm(`Delete alias for "${raw}"?`)) return;
    if (deleteHardwareAlias(id)) {
      toast.success('Alias deleted');
      setRefreshKey((k) => k + 1);
    }
  };

  // ===== IMAGES =====
  const handleImageAction = (imageId: string, status: 'approved' | 'rejected' | 'pending') => {
    if (!canModerate) {
      toast.error('Moderator+ required');
      return;
    }
    if (updateImageStatus(imageId, status)) {
      toast.success(`Image ${status}`);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleDeleteImage = (imageId: string) => {
    if (!canAdmin) {
      toast.error('Admin only');
      return;
    }
    if (!confirm('Delete this image reference?')) return;
    if (deleteReportImage(imageId)) {
      toast.success('Image removed');
      setRefreshKey((k) => k + 1);
    }
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
              <p className="text-muted-foreground">Phase 4 • RunDB Migration • Role-based tools</p>
            </div>
          </div>
        </div>

        {/* Demo Role Switcher (visual + functional guard) */}
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
      </div>

      {/* Warning banner */}
      <div className="mb-6 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-200">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <strong>Demo mode:</strong> All changes persist in your browser (localStorage). 
            In production this page would enforce <code>profiles.role IN (&apos;moderator&apos;,&apos;admin&apos;)</code> via Supabase RLS + server checks.
            No real database writes occur yet.
          </div>
        </div>
      </div>

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
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={isReportsLoading}>
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

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      {isReportsLoading ? 'Loading moderation queue...' : 'No reports match the current filter.'}
                    </TableCell>
                  </TableRow>
                )}
                {reports.slice(0, 50).map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/30">
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
            <Button variant="outline" onClick={() => setRefreshKey((k) => k + 1)} size="icon"><RefreshCw className="h-4 w-4" /></Button>
          </div>

          {USE_REAL && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold">Ingest Queue (ProtonDB → IGDB enrich)</div>
                  <div className="text-xs text-muted-foreground">
                    Two-phase catalog: skeleton from <code className="text-[10px]">npm run seed:queue</code>, enrich via worker or batch below.
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
                  <p className="text-[10px] text-muted-foreground">
                    CLI: <code>npm run build:seed</code> → <code>npm run seed:queue</code> → <code>npm run ingest:worker -- --batch=50</code>.
                    ProtonDB data ODbL · IGDB · Steam.
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
          <p className="text-xs text-muted-foreground">Showing up to 30 matches. Preview thumbnails added (Agent 4). Imported games persist in this browser. Use Protected Action or ingest script for real Supabase covers.</p>
        </TabsContent>

        {/* HARDWARE NORMALIZATION WORKBENCH */}
        <TabsContent value="hardware" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Hardware Normalization Workbench</h2>
              <p className="text-sm text-muted-foreground">Map raw user-entered strings (GPU/CPU) to canonical names for better matching.</p>
            </div>
            <Button onClick={() => openAliasDialog()} disabled={!canAdmin} className="gap-2">
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
                {aliases.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8">No aliases.</TableCell></TableRow>}
                {aliases.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.rawString}</TableCell>
                    <TableCell className="font-medium">{a.canonical}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.vendor} {a.series && `· ${a.series}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" className="h-8 w-8 hover:bg-accent/70" onClick={() => openAliasDialog(a)}><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!canAdmin} onClick={() => handleDeleteAlias(a.id, a.rawString)}>
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {images.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed p-12 text-center text-muted-foreground">No images for this filter.</div>
            )}
            {images.map((img) => (
              <div key={img.id} className="group overflow-hidden rounded-xl border border-border bg-card">
                <div className="relative aspect-video bg-black">
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
                    <Button size="sm" variant="outline" disabled={!canModerate} onClick={() => handleImageAction(img.id, 'approved')} className="flex-1">Approve</Button>
                    <Button size="sm" variant="outline" disabled={!canModerate} onClick={() => handleImageAction(img.id, 'rejected')} className="flex-1">Reject</Button>
                    <Button size="sm" variant="destructive" disabled={!canAdmin} onClick={() => handleDeleteImage(img.id)}>
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
              Full implementation aligns with the Master Implementation Plan (schema: reports.status, hardware_aliases, report_images, profiles.role).
              Future steps: Server Actions + Supabase RLS for real moderation, audit logs, and bulk job queues.
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
              onClick={saveAlias}
              className="bg-white text-black font-medium hover:bg-white/90"
            >
              {editingAlias ? 'Save Changes' : 'Add Alias'}
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
              onClick={() => void performModerationAction(activeReportId, actionStatus, moderatorNotes || undefined)}
            >
              {isModeratingReport ? 'Saving...' : `Confirm ${actionStatus}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
