'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchFeed } from '@/components/match-feed';
import { ValueLoopExplainer } from './value-loop-explainer';
import { Game, UserPC, MAIN_RESOLUTIONS } from '@/lib/types';
import {
  loadMyRigAsync,
  saveMyRigAsync,
  clearMyRigAsync,
  getAllGames,
  getAllHardwareCatalogAsync,
} from '@/lib/data';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { showUserError } from '@/lib/toast';
import { Monitor, Save, Trash2 } from 'lucide-react';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import type { DetectedHardware } from '@/lib/types';
import { applicableHardwareFields } from '@/lib/hardware-detector';
import { useHardwareDetection } from '@/components/use-hardware-detection';
import { sanitizeFullName } from '@/lib/sanitize';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { IgpuSuggestDialog } from '@/components/igpu-suggest-dialog';
import { shouldOfferIgpuOnEmptyGpu } from '@/lib/cpu-igpu';

interface CompatibilityCheckerProps {
  embedded?: boolean;
  preselectedGameSlug?: string;
}

function coerceMainResolution(value: string | undefined) {
  return ((MAIN_RESOLUTIONS as readonly string[]).includes(value || '') ? value : MAIN_RESOLUTIONS[1]) as string;
}

export function CompatibilityChecker({ embedded = false }: CompatibilityCheckerProps) {
  const [myRig, setMyRig] = useState<UserPC | null>(null);
  const [cpu, setCpu] = useState('');
  const [gpu, setGpu] = useState('');
  const [ram, setRam] = useState(32);
  const [resolution, setResolution] = useState<string>(MAIN_RESOLUTIONS[1]);
  const [igpuDialogOpen, setIgpuDialogOpen] = useState(false);
  const [pendingIgpu, setPendingIgpu] = useState<string | null>(null);
  const [gpuPickerOpen, setGpuPickerOpen] = useState(false);

  // Phase 2 complete (Master Plan): Loaded async from data layer (user_rigs primary for logged-in + profiles fallback,
  // or localStorage guest fallback only). Auth listener keeps in sync on sign in/out.
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [isLoadingRig, setIsLoadingRig] = useState(true);
  const [isLoadingGames, setIsLoadingGames] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Hardware Identification (Plan 4) — shared detect → review → apply state machine
  const detection = useHardwareDetection((result: DetectedHardware) => {
    const fields = applicableHardwareFields(result);
    if (fields.cpu) setCpu(fields.cpu);
    if (fields.gpu) setGpu(fields.gpu);
    if (fields.ram != null) setRam(fields.ram);
    if (fields.resolution) setResolution(fields.resolution);
  });

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
          setResolution(coerceMainResolution(saved.resolution));
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
              setResolution(coerceMainResolution(saved.resolution));
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

  const persistRig = async (safeCpu: string, safeGpu: string, safeResolution: string) => {
    const rig: UserPC = { cpu: safeCpu, gpu: safeGpu, ram, resolution: safeResolution || undefined };

    setIsSaving(true);
    try {
      await saveMyRigAsync(rig);
      setMyRig(rig);
      toast.success('Rig saved!', {
        description: 'Compatibility predictions will now use your hardware (persisted to DB for logged-in users).',
      });
    } catch {
      showUserError('Could not save your rig. Please try again.');
      // Still update local state so UI works even if DB write had transient issue
      setMyRig(rig);
    } finally {
      setIsSaving(false);
    }
  };

  const saveRig = async () => {
    const safeCpu = sanitizeFullName(cpu);
    const safeGpu = sanitizeFullName(gpu);
    const safeResolution = sanitizeFullName(resolution);

    if (!safeCpu) {
      showUserError('Please enter your CPU and GPU');
      return;
    }

    if (!safeGpu) {
      try {
        const catalog = await getAllHardwareCatalogAsync();
        const offer = shouldOfferIgpuOnEmptyGpu(safeCpu, '', catalog);
        if (offer.offer) {
          setPendingIgpu(offer.igpuCanonical);
          setIgpuDialogOpen(true);
          return;
        }
      } catch {
        // fall through
      }
      showUserError('Please enter your CPU and GPU');
      return;
    }

    await persistRig(safeCpu, safeGpu, safeResolution);
  };

  const clearRig = async () => {
    setMyRig(null);
    setCpu('');
    setGpu('');
    setRam(32);
    setResolution(MAIN_RESOLUTIONS[1]);

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

  const isLoading = isLoadingRig || isLoadingGames;

  // Has the form diverged from the saved rig? When no rig is saved yet, there is always
  // something to save. Once a rig exists (incl. one saved on another page), the button is
  // only meaningful if the user has edited a field — otherwise matches already show below.
  const isDirty =
    !myRig ||
    cpu !== myRig.cpu ||
    gpu !== myRig.gpu ||
    ram !== myRig.ram ||
    resolution !== coerceMainResolution(myRig.resolution);

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
                  onDetect={detection.handleDetected}
                  state={detection.detectionState}
                  onRequestPaste={detection.openPasteModal}
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
                detected={detection.detectedRig}
                onApply={detection.applyDetected}
                onRefine={detection.refineDetection}
                onDismiss={detection.clearDetection}
                applied={detection.detectionState === 'applied'}
              />
            </div>
            <div className="lg:col-span-2">
              <Label>GPU</Label>
              <HardwareCombobox
                value={gpu}
                onChange={(val) => setGpu(val)}
                componentType="gpu"
                relatedCpu={cpu}
                open={gpuPickerOpen}
                onOpenChange={setGpuPickerOpen}
                placeholder="Search RTX 4070 Ti / integrated graphics..."
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
              disabled={isSaving || isLoadingRig || (!!myRig && !isDirty)}
            >
              <Save className="h-4 w-4" /> {isSaving ? 'Saving...' : myRig ? 'Update Rig' : 'Save My Rig'}
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

          {myRig && <MatchFeed rig={myRig} allGames={allGames} />}

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

      <IgpuSuggestDialog
        open={igpuDialogOpen}
        onOpenChange={setIgpuDialogOpen}
        igpuCanonical={pendingIgpu || ''}
        cpuLabel={cpu}
        onUse={() => {
          if (!pendingIgpu) return;
          const igpu = pendingIgpu;
          const safeCpu = sanitizeFullName(cpu);
          const safeResolution = sanitizeFullName(resolution);
          setGpu(igpu);
          setIgpuDialogOpen(false);
          setPendingIgpu(null);
          if (!safeCpu) {
            showUserError('Please enter your CPU and GPU');
            return;
          }
          void persistRig(safeCpu, igpu, safeResolution);
        }}
        onPickManually={() => {
          setIgpuDialogOpen(false);
          setPendingIgpu(null);
          setGpuPickerOpen(true);
        }}
      />

      {/* Paste modal — merges with any prior browser detection, then applies */}
      <PasteHardwareModal
        open={detection.pasteModalOpen}
        onOpenChange={detection.setPasteModalOpen}
        onApply={detection.handlePasteApply}
      />
    </div>
  );
}
