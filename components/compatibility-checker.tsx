'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchFeed } from '@/components/match-feed';
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
import { Gauge, Monitor, Save, Trash2 } from 'lucide-react';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import type { DetectedHardware } from '@/lib/types';
import { applicableHardwareFields, HARDWARE_DETECT_UI_ENABLED } from '@/lib/hardware-detector';
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
      <Card>
        <CardHeader className="pb-5">
          <CardTitle className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
              <Monitor className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {myRig ? 'Your rig' : 'Tell us about your rig'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Save your hardware once to see predicted performance and matching reports across games.
            {process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true' && (
              <span className="ml-1 text-success">(using real database reports + live hardware catalog)</span>
            )}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Rig form */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <div className="mb-1.5 flex items-center justify-between">
                <Label>CPU</Label>
                {HARDWARE_DETECT_UI_ENABLED && (
                  <HardwareDetectButton
                    mode="browser"
                    onDetect={detection.handleDetected}
                    state={detection.detectionState}
                    onRequestPaste={detection.openPasteModal}
                  />
                )}
              </div>
              <HardwareCombobox
                value={cpu}
                onChange={(val) => setCpu(val)}
                componentType="cpu"
                placeholder="Search Ryzen 7 7800X3D or i5-13600K..."
                disabled={isSaving || isLoadingRig}
              />
              {HARDWARE_DETECT_UI_ENABLED && (
                <DetectedHardwareBanner
                  detected={detection.detectedRig}
                  onApply={detection.applyDetected}
                  onRefine={detection.refineDetection}
                  onDismiss={detection.clearDetection}
                  applied={detection.detectionState === 'applied'}
                />
              )}
            </div>
            <div className="lg:col-span-2">
              <Label className="mb-1.5 block">GPU</Label>
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
              <Label className="mb-1.5 block">RAM (GB)</Label>
              <Input
                type="number"
                value={ram}
                onChange={(e) => setRam(Number(e.target.value))}
                disabled={isSaving || isLoadingRig}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">Preferred resolution</Label>
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

          <div className="flex flex-wrap gap-3 border-t border-border pt-5">
            <Button
              onClick={saveRig}
              className="gap-2 rounded-full px-5"
              disabled={isSaving || isLoadingRig || (!!myRig && !isDirty)}
            >
              <Save className="h-4 w-4" /> {isSaving ? 'Saving…' : myRig ? 'Update rig' : 'Save my rig'}
            </Button>
            {myRig && (
              <Button
                variant="ghost"
                className="gap-2 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
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
            <div className="rounded-2xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">
              Loading your saved rig and games…
            </div>
          )}

          {!myRig && !isLoading && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-surface-2 px-6 py-10 text-center">
              <Gauge className="h-7 w-7 text-muted-foreground" aria-hidden />
              <div className="font-medium">Your predictions will appear here</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                Pick your CPU and GPU above and save — we&apos;ll match you with reports from similar hardware.
              </p>
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

      {/* Paste modal — kept for later; gated by HARDWARE_DETECT_UI_ENABLED */}
      {HARDWARE_DETECT_UI_ENABLED && (
        <PasteHardwareModal
          open={detection.pasteModalOpen}
          onOpenChange={detection.setPasteModalOpen}
          onApply={detection.handlePasteApply}
        />
      )}
    </div>
  );
}
