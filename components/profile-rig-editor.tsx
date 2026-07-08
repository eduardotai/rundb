'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { sanitizeFullName } from '@/lib/sanitize';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { IgpuSuggestDialog } from '@/components/igpu-suggest-dialog';
import { SteamLinkButton } from '@/components/steam-link-button';
import { MAIN_RESOLUTIONS } from '@/lib/types';
import { loadMyRigAsync, saveMyRigAsync, getAllHardwareCatalogAsync } from '@/lib/data';
import type { SteamLinkStatus } from '@/lib/data';
import type { DetectedHardware } from '@/lib/types';
import { mergeDetected, applicableHardwareFields } from '@/lib/hardware-detector';
import { shouldOfferIgpuOnEmptyGpu } from '@/lib/cpu-igpu';

interface ProfileRigEditorProps {
  /** Only the id is required — identity (name/avatar) is managed in the profile hero. */
  user: { id: string };
}

type RigFields = {
  cpu: string;
  gpu: string;
  ram: number | '';
  resolution: string;
};

export function ProfileRigEditor({ user }: ProfileRigEditorProps) {
  const [rig, setRig] = useState<RigFields>({
    cpu: '',
    gpu: '',
    ram: '',
    resolution: MAIN_RESOLUTIONS[1],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [lastBrowserDetect, setLastBrowserDetect] = useState<DetectedHardware | null>(null);
  const [steamStatus, setSteamStatus] = useState<SteamLinkStatus | null>(null);
  const [igpuDialogOpen, setIgpuDialogOpen] = useState(false);
  const [pendingIgpu, setPendingIgpu] = useState<string | null>(null);
  const [gpuPickerOpen, setGpuPickerOpen] = useState(false);

  // Load the saved My Rig through the data adapter (user_rigs preferred, profiles fallback).
  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      try {
        const saved = await loadMyRigAsync();
        if (saved) {
          const loadedRes = saved.resolution || '2560x1440';
          const safeRes = (MAIN_RESOLUTIONS as readonly string[]).includes(loadedRes)
            ? loadedRes
            : '2560x1440';
          setRig({
            cpu: saved.cpu || '',
            gpu: saved.gpu || '',
            ram: saved.ram ?? '',
            resolution: safeRes,
          });
        }
      } catch (err) {
        console.error('[profile] Unexpected error loading rig:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, [user.id]);

  // Load Steam link status (additive, for verified + easier device management)
  useEffect(() => {
    (async () => {
      try {
        const { getLinkedSteamProfile } = await import('@/lib/data');
        const s = await getLinkedSteamProfile();
        setSteamStatus(s);
      } catch {}
    })();
  }, []);

  const persistRig = async (cpu: string, gpu: string, resolution: string, ramNum: number) => {
    setIsSaving(true);
    try {
      // Adapter saves to user_rigs (authoritative for the compatibility checker)
      // and mirrors main_* fields to profiles, keeping both surfaces in sync.
      await saveMyRigAsync({
        cpu,
        gpu,
        ram: ramNum,
        resolution,
      });

      showUserSuccess('Rig saved!');
    } catch {
      showUserError('Could not save your rig. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const safeCpu = sanitizeFullName(rig.cpu);
    const safeGpu = sanitizeFullName(rig.gpu);
    const safeResolution = sanitizeFullName(rig.resolution);

    if (!safeCpu) {
      showUserError('CPU and GPU are required');
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
        // fall through to generic error
      }
      showUserError('CPU and GPU are required');
      return;
    }

    const ramNum = typeof rig.ram === 'number' ? rig.ram : parseInt(String(rig.ram), 10);
    if (isNaN(ramNum) || ramNum < 4 || ramNum > 128) {
      showUserError('RAM must be between 4 and 128 GB');
      return;
    }
    if (!safeResolution) {
      showUserError('Resolution is required');
      return;
    }

    await persistRig(safeCpu, safeGpu, safeResolution, ramNum);
  };

  const handleUseIgpu = async () => {
    if (!pendingIgpu) return;
    const igpu = pendingIgpu;
    const safeCpu = sanitizeFullName(rig.cpu);
    const safeResolution = sanitizeFullName(rig.resolution);
    const ramNum = typeof rig.ram === 'number' ? rig.ram : parseInt(String(rig.ram), 10);
    updateField('gpu', igpu);
    setIgpuDialogOpen(false);
    setPendingIgpu(null);
    if (!safeCpu || isNaN(ramNum) || ramNum < 4 || ramNum > 128 || !safeResolution) {
      showUserError('Fill RAM and resolution, then save again.');
      return;
    }
    await persistRig(safeCpu, igpu, safeResolution, ramNum);
  };

  const updateField = (field: keyof RigFields, value: string | number) => {
    setRig((prev) => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading your saved rig...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Rig</CardTitle>
        <CardDescription>
          Your primary hardware configuration. Saved as your primary rig (and mirrored to your
          profile) to power personalized compatibility predictions and report filtering.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>CPU</Label>
              <HardwareDetectButton
                mode="browser"
                onDetect={(r) => {
                  setLastBrowserDetect(r);
                  // Browser hints for CPU/RAM are never auto-filled into editable fields;
                  // paste (or type the real model) for actual CPU + RAM.
                  const fields = applicableHardwareFields(r);
                  if (fields.cpu) updateField('cpu', fields.cpu);
                  if (fields.gpu) updateField('gpu', fields.gpu);
                  if (fields.ram != null) updateField('ram', fields.ram);
                  if (fields.resolution) updateField('resolution', fields.resolution);
                }}
                onRequestPaste={() => setPasteModalOpen(true)}
              />
            </div>
            <HardwareCombobox
              value={rig.cpu}
              onChange={(val) => updateField('cpu', val)}
              componentType="cpu"
              placeholder="Search Ryzen 7 7800X3D or i5-13600K..."
              disabled={isSaving}
            />
          </div>
          <div>
            <Label>GPU</Label>
            <HardwareCombobox
              value={rig.gpu}
              onChange={(val) => updateField('gpu', val)}
              componentType="gpu"
              relatedCpu={rig.cpu}
              open={gpuPickerOpen}
              onOpenChange={setGpuPickerOpen}
              placeholder="Search RTX 4070 Super or integrated graphics..."
              disabled={isSaving}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ram">RAM (GB)</Label>
            <Input
              id="ram"
              type="number"
              min={4}
              max={128}
              placeholder="32"
              value={rig.ram}
              onChange={(e) =>
                updateField('ram', e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')
              }
              disabled={isSaving}
            />
            <p className="mt-1 text-xs text-muted-foreground">4–128 GB</p>
          </div>
          <div>
            <Label>Preferred Resolution</Label>
            <Select
              value={rig.resolution}
              onValueChange={(v) => updateField('resolution', v)}
              disabled={isSaving}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAIN_RESOLUTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">Common resolutions only.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="lg"
            className="bg-white font-medium text-black hover:bg-white/90"
          >
            {isSaving ? 'Saving...' : 'Save My Rig'}
          </Button>
          <p className="text-xs text-muted-foreground">Saved to your Supabase profile.</p>
        </div>

        {/* Steam linking makes managing hardware (My Devices / rigs) easier and persistent.
            Link once → easily select/import accurate rigs via paste of Steam System Information.
            Note: Steam itself provides no CPU/GPU/RAM — you still paste once per device using our excellent parsers. */}
        <div className="pt-4 border-t border-border/60">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Steam connection</div>
              <div className="text-[11px] text-muted-foreground">For verified badges + quick device selection across the app (profile, submit, checker).</div>
            </div>
            <SteamLinkButton
              status={steamStatus}
              onLinked={() => {
                // Reload status after redirect success
                import('@/lib/data').then(({ getLinkedSteamProfile }) => getLinkedSteamProfile().then(setSteamStatus));
              }}
              onUnlinked={() => setSteamStatus({ linked: false })}
              size="sm"
            />
          </div>
          {steamStatus?.linked && (
            <div className="space-y-1">
              <p className="text-[11px] text-emerald-400/80">
                Linked{steamStatus.persona ? ` as ${steamStatus.persona}` : ''}.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPasteModalOpen(true)}
              >
                Import hardware from Steam client (paste System Information once)
              </Button>
              <p className="text-[10px] text-muted-foreground">After pasting accurate data it will be available as a saved device in Submit / Checker.</p>
            </div>
          )}
        </div>

        <IgpuSuggestDialog
          open={igpuDialogOpen}
          onOpenChange={setIgpuDialogOpen}
          igpuCanonical={pendingIgpu || ''}
          cpuLabel={rig.cpu}
          onUse={() => {
            void handleUseIgpu();
          }}
          onPickManually={() => {
            setIgpuDialogOpen(false);
            setPendingIgpu(null);
            setGpuPickerOpen(true);
          }}
        />

        <PasteHardwareModal
          open={pasteModalOpen}
          onOpenChange={setPasteModalOpen}
          onApply={async (pasteDetected) => {
            // Merge prior browser result (if any) with this paste for richer rig (res + exact cpu/gpu/ram etc).
            const merged = mergeDetected(lastBrowserDetect, pasteDetected);
            if (merged.cpu) updateField('cpu', merged.cpu);
            if (merged.gpu) updateField('gpu', merged.gpu);
            if (merged.ram) updateField('ram', merged.ram);
            if (merged.resolution) updateField('resolution', merged.resolution);
            setLastBrowserDetect(null);
            setPasteModalOpen(false);

            // Also persist as a named user device so it appears in Submit "Choose saved device" and other surfaces.
            // This is the key UX win when Steam-linked: paste accurate hardware *once*.
            try {
              const { saveUserDevice } = await import('@/lib/data');
              await saveUserDevice({
                label: steamStatus?.persona ? `Steam: ${steamStatus.persona}` : 'Imported from Steam',
                cpu: merged.cpu || '',
                gpu: merged.gpu || '',
                ram: typeof merged.ram === 'number' ? merged.ram : (merged.ram ? parseInt(String(merged.ram), 10) : 16),
                resolution: merged.resolution,
                driverVersion: (merged as any).driverVersion,
                kernel: (merged as any).kernel,
                distro: (merged as any).distro,
                isPrimary: false,
              });
            } catch {}
          }}
        />
      </CardContent>
    </Card>
  );
}
