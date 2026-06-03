'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PerformanceBadge } from './performance-badge';
import { ReportCard } from './report-card';
import { ValueLoopExplainer } from './value-loop-explainer';
import { Game, UserPC, MAIN_RESOLUTIONS, MainResolution } from '@/lib/types';
import {
  loadMyRigAsync,
  saveMyRigAsync,
  clearMyRigAsync,
  predictForUserRigAsync,
  getAllGames,
  getReportsForGameAsync,
} from '@/lib/data';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { Monitor, Save, Trash2, X, Cpu } from 'lucide-react';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import type { DetectedHardware } from '@/lib/types';
import { mergeDetected } from '@/lib/hardware-detector';
import { cn } from '@/lib/utils';
import { sanitizeFullName } from '@/lib/sanitize';
import { HardwareCombobox } from '@/components/hardware-combobox';

interface CompatibilityCheckerProps {
  embedded?: boolean;
  preselectedGameSlug?: string;
}

export function CompatibilityChecker({ embedded = false, preselectedGameSlug }: CompatibilityCheckerProps) {
  const [myRig, setMyRig] = useState<UserPC | null>(null);
  const [selectedGames, setSelectedGames] = useState<string[]>(preselectedGameSlug ? [preselectedGameSlug] : []);
  const [cpu, setCpu] = useState('');
  const [gpu, setGpu] = useState('');
  const [ram, setRam] = useState(32);
  const [resolution, setResolution] = useState<string>(MAIN_RESOLUTIONS[1]);

  // Phase 2 complete (Master Plan): Loaded async from data layer (user_rigs primary for logged-in + profiles fallback,
  // or localStorage guest fallback only). Auth listener keeps in sync on sign in/out.
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [isLoadingRig, setIsLoadingRig] = useState(true);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Hardware Identification (Plan 4) — client-only state
  const [detectedRig, setDetectedRig] = useState<DetectedHardware | null>(null);
  const [detectionState, setDetectionState] = useState<'idle' | 'detecting' | 'detected' | 'applied'>('idle');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  // Phase 2 complete: Predictions computed async so they can use real DB reports + similarity scoring
  // when NEXT_PUBLIC_USE_REAL_DATA=true (via predictForUserRigAsync + getReportsForGameAsync)
  const [predictions, setPredictions] = useState<Array<{
    game: Game;
    prediction: Awaited<ReturnType<typeof predictForUserRigAsync>> | null;
    sampleReports: Awaited<ReturnType<typeof getReportsForGameAsync>>;
  }>>([]);

  const supabase = createClient();

  // Load rig (DB if logged in + real, else localStorage) and games (real or mock)
  // Also subscribe to auth changes so rig updates without full page reload.
  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      setIsLoadingRig(true);
      setIsLoadingGames(true);

      // Load rig (the async adapter per Master Plan: DB user_rigs/profiles for logged-in incl. anon; localStorage ONLY guest fallback)
      try {
        const saved = await loadMyRigAsync();
        if (mounted && saved) {
          setMyRig(saved);
          setCpu(saved.cpu);
          setGpu(saved.gpu);
          setRam(saved.ram);
          const r = (saved.resolution || '2560x1440') as any;
          setResolution(MAIN_RESOLUTIONS.includes(r) ? r : '2560x1440');
        }
      } catch (e) {
        console.warn('[CompatibilityChecker] loadMyRigAsync error', e);
      } finally {
        if (mounted) setIsLoadingRig(false);
      }

      // Load games (async adapter for real data when flag on)
      try {
        const games = await getAllGames();
        if (mounted) setAllGames(games);
      } catch (e) {
        console.warn('[CompatibilityChecker] getAllGames error', e);
        // Fallback will have been handled inside the adapter
      } finally {
        if (mounted) setIsLoadingGames(false);
      }
    }

    loadInitial();

    // Auth listener (Phase 2 complete): reload rig from correct source (DB for logged / LS guest fallback) on sign in/out (supports anon too)
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      // Reload rig from the correct source (DB vs local) without full reload
      if (mounted) {
        loadMyRigAsync()
          .then((saved) => {
            if (!mounted) return;
            if (saved) {
              setMyRig(saved);
              setCpu(saved.cpu);
              setGpu(saved.gpu);
              setRam(saved.ram);
              const r = saved.resolution || MAIN_RESOLUTIONS[1];
              setResolution(((MAIN_RESOLUTIONS as readonly string[]).includes(r) ? r : MAIN_RESOLUTIONS[1]) as string);
            } else {
              // Signed out or no rig: clear form state
              setMyRig(null);
              setCpu('');
              setGpu('');
              setRam(32);
              setResolution(MAIN_RESOLUTIONS[1]);
            }
          })
          .catch(() => {});
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute predictions whenever rig, selection, or games list changes.
  // Uses the real-data async paths when the flag is on → real reports from DB + pure similarity scoring.
  useEffect(() => {
    let cancelled = false;

    async function recomputePredictions() {
      if (!myRig || selectedGames.length === 0 || allGames.length === 0) {
        if (!cancelled) setPredictions([]);
        return;
      }

      const results = await Promise.all(
        selectedGames.map(async (slug) => {
          const game = allGames.find((g) => g.slug === slug);
          if (!game) return null;

          let pred: Awaited<ReturnType<typeof predictForUserRigAsync>> | null = null;
          let sample: Awaited<ReturnType<typeof getReportsForGameAsync>> = [];

          try {
            pred = await predictForUserRigAsync(myRig, game.id);
          } catch (e) {
            console.warn('[CompatibilityChecker] predictForUserRigAsync failed', e);
          }

          try {
            const reports = await getReportsForGameAsync(game.id);
            sample = reports.slice(0, 3);
          } catch (e) {
            console.warn('[CompatibilityChecker] getReportsForGameAsync failed', e);
          }

          return { game, prediction: pred, sampleReports: sample };
        })
      );

      if (!cancelled) {
        setPredictions(results.filter((r): r is NonNullable<typeof r> => r !== null));
      }
    }

    recomputePredictions();

    return () => {
      cancelled = true;
    };
  }, [myRig, selectedGames, allGames]);

  const saveRig = async () => {
    const safeCpu = sanitizeFullName(cpu);
    const safeGpu = sanitizeFullName(gpu);
    const safeResolution = sanitizeFullName(resolution);

    if (!safeCpu || !safeGpu) {
      showUserError('Please enter your CPU and GPU');
      return;
    }
    const rig: UserPC = { cpu: safeCpu, gpu: safeGpu, ram, resolution: safeResolution || undefined };

    setIsSaving(true);
    try {
      await saveMyRigAsync(rig);
      setMyRig(rig);
      toast.success('Rig saved!', {
        description: 'Compatibility predictions will now use your hardware (persisted to DB for logged-in users).',
      });
    } catch (e: unknown) {
      showUserError('Could not save your rig. Please try again.');
      // Still update local state so UI works even if DB write had transient issue
      setMyRig(rig);
    } finally {
      setIsSaving(false);
    }
  };

  // Hardware Identification handlers (Plan 4 Hybrid)
  const handleDetected = (result: DetectedHardware) => {
    setDetectedRig(result);
    setDetectionState('detected');
  };

  const openPasteModal = () => setPasteModalOpen(true);
  const applyDetectedToForm = (result: DetectedHardware) => {
    const isHint = (s?: string) => !!s && /browser hint/i.test(s);
    if (result.cpu && !isHint(result.cpu)) setCpu(result.cpu);
    if (result.gpu) setGpu(result.gpu);
    if (result.ram != null && !isHint(result.cpu)) setRam(result.ram);
    if (result.resolution) setResolution(result.resolution);
    setDetectionState('applied');
    setDetectedRig(null);
  };
  const handleClearDetection = () => {
    setDetectedRig(null);
    setDetectionState('idle');
  };

  const clearRig = async () => {
    setMyRig(null);
    setCpu('');
    setGpu('');
    setRam(32);
    setResolution(MAIN_RESOLUTIONS[1]);
    setPredictions([]);

    try {
      await clearMyRigAsync();
    } catch {
      // clearMyRigAsync already falls back internally
    }

    // Defense in depth: purge any stale guest localStorage key (harmless for auth users; clearMyRigAsync already
    // removed from user_rigs for logged-in per plan; profile editor's data left untouched).
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem('rundb_my_rig'); } catch {}
    }

    toast.info('My Rig cleared');
  };

  const toggleGame = (slug: string) => {
    setSelectedGames((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const isLoading = isLoadingRig || isLoadingGames;

  return (
    <div className={embedded ? '' : 'max-w-5xl mx-auto'}>
      <Card className="border-border/60">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Monitor className="h-5 w-5 text-primary" /> My Rig — Check Compatibility
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Save your hardware once. See predicted performance + matching reports across games.
            {process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true' && (
              <span className="ml-1 text-emerald-400">(using real database reports + live hardware catalog)</span>
            )}
          </p>
          {!embedded && <ValueLoopExplainer variant="compact" />}
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Rig form */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between">
                <Label>CPU</Label>
                <HardwareDetectButton
                  mode="browser"
                  onDetect={handleDetected}
                  state={detectionState}
                  onRequestPaste={openPasteModal}
                />
              </div>
              <HardwareCombobox
                value={cpu}
                onChange={(val) => setCpu(val)}
                componentType="cpu"
                placeholder="Search Ryzen 7 7800X3D or i5-13600K..."
                disabled={isSaving || isLoadingRig}
              />
              <DetectedHardwareBanner
                detected={detectedRig}
                onApply={applyDetectedToForm}
                onRefine={() => setDetectedRig(null)}
                onDismiss={handleClearDetection}
                applied={detectionState === 'applied'}
              />
            </div>
            <div className="lg:col-span-2">
              <Label>GPU</Label>
              <HardwareCombobox
                value={gpu}
                onChange={(val) => setGpu(val)}
                componentType="gpu"
                placeholder="Search RTX 4070 Ti / RX 7800 XT..."
                disabled={isSaving || isLoadingRig}
              />
            </div>
            <div>
              <Label>RAM (GB)</Label>
              <Input
                type="number"
                value={ram}
                onChange={(e) => setRam(Number(e.target.value))}
                disabled={isSaving || isLoadingRig}
              />
            </div>
            <div>
              <Label>Preferred Resolution</Label>
              <Select
                value={resolution}
                onValueChange={(v) => setResolution(v as string)}
                disabled={isSaving || isLoadingRig}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIN_RESOLUTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-3">
            <Button 
              onClick={saveRig} 
              className="gap-2 bg-white text-black font-medium hover:bg-white/90" 
              disabled={isSaving || isLoadingRig}
            >
              <Save className="h-4 w-4" /> {isSaving ? 'Saving...' : 'Save My Rig'}
            </Button>
            {myRig && (
              <Button
                variant="ghost"
                className="gap-2 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                onClick={clearRig}
                disabled={isSaving}
              >
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            )}
            {isLoadingRig && <span className="text-xs text-muted-foreground self-center">Loading rig…</span>}
          </div>

          {/* Game selector */}
          <div>
            <Label className="mb-2 block">Check these games</Label>
            {isLoadingGames ? (
              <div className="text-sm text-muted-foreground">Loading games…</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allGames.slice(0, 12).map((g) => {
                  const active = selectedGames.includes(g.slug);
                  return (
                    <button
                      key={g.slug}
                      onClick={() => toggleGame(g.slug)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition',
                        active
                          ? 'border-primary bg-white text-black shadow-sm'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      {g.name}
                    </button>
                  );
                })}
                {selectedGames.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedGames([])}
                    className="h-7 gap-1 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Results — now driven by async real-DB predictions when flag enabled */}
          {myRig && predictions.length > 0 && (
            <div className="space-y-4 pt-2">
              <div className="text-sm font-medium text-muted-foreground">Predictions for your rig</div>

              {predictions.map(({ game, prediction, sampleReports }) => (
                <div key={game.slug} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div>
                      <div className="font-semibold">{game.name}</div>
                      {prediction && (
                        <div className="mt-1 text-sm text-muted-foreground">{prediction.explanation}</div>
                      )}
                    </div>
                    {prediction && <PerformanceBadge tier={prediction.predictedTier} size="lg" />}
                  </div>

                  {prediction && (
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">Recommended:</span> {prediction.recommendedSettings}
                    </div>
                  )}

                  {sampleReports.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                        Similar reports
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {sampleReports.map((r) => (
                          <ReportCard key={r.id} report={r} userRig={myRig} compact />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {isLoading && !myRig && (
            <div className="rounded-lg bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Loading your saved rig and games…
            </div>
          )}

          {!myRig && !isLoading && (
            <div className="rounded-lg bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Save your rig above to see personalized predictions and matching reports.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Paste modal — was declared but not rendered; now wired with merge support */}
      <PasteHardwareModal
        open={pasteModalOpen}
        onOpenChange={setPasteModalOpen}
        onApply={(pasteDetected) => {
          const merged = mergeDetected(detectedRig, pasteDetected);
          applyDetectedToForm(merged);
          setPasteModalOpen(false);
        }}
      />
    </div>
  );
}
