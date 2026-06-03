'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Game, GraphicsPreset, MAIN_RESOLUTIONS } from '@/lib/types';
import { addUserReport, isSupabaseConfigured } from '@/lib/data';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { sanitizeFullName } from '@/lib/sanitize';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { normalizeHardwareSync } from '@/lib/normalize-hardware';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import type { DetectedHardware } from '@/lib/types';
import { loadMyRigAsync, loadUserDevices } from '@/lib/data';

const formSchema = z.object({
  gameId: z.string().min(1),
  cpu: z.string()
    .min(3, 'CPU is required')
    .max(80, 'CPU name is too long')
    .transform((v) => sanitizeFullName(v)),
  gpu: z.string()
    .min(3, 'GPU is required')
    .max(80, 'GPU name is too long')
    .transform((v) => sanitizeFullName(v)),
  ram: z.coerce.number().min(4, 'RAM must be at least 4 GB').max(128, 'RAM must be at most 128 GB'),
  resolution: z.string().min(3).max(20),
  refreshRate: z.coerce.number().optional(),
  settingsPreset: z.enum(['Low', 'Medium', 'High', 'Ultra', 'Custom']),
  avgFps: z.coerce.number().min(1, 'Average FPS must be at least 1').max(600, 'Average FPS must be at most 600'),
  fps1PercentLow: z.coerce.number().optional(),
  notes: z.string()
    .max(500, 'Notes are too long')
    .optional()
    .transform((v) => v ? sanitizeFullName(v) : undefined),
  tweaks: z.string()
    .max(300, 'Tweaks are too long')
    .optional()
    .transform((v) => v ? sanitizeFullName(v) : undefined),
  driverVersion: z.string()
    .max(40, 'Driver version is too long')
    .optional()
    .transform((v) => v ? sanitizeFullName(v) : undefined),
});

type FormValues = z.infer<typeof formSchema>;

interface SubmitReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Game;
  onSuccess?: () => void;
}

const PRESETS: GraphicsPreset[] = ['Low', 'Medium', 'High', 'Ultra', 'Custom'];

export function SubmitReportDialog({ open, onOpenChange, game, onSuccess }: SubmitReportDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hardware Identification (Plan 4) — same pattern as compatibility-checker + profile editor
  const [detectedRig, setDetectedRig] = useState<DetectedHardware | null>(null);
  const [detectionState, setDetectionState] = useState<'idle' | 'detecting' | 'detected' | 'applied'>('idle');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [savedDevices, setSavedDevices] = useState<any[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any, // zodResolver + coerce types edge case
    defaultValues: {
      gameId: game.id,
      cpu: '',
      gpu: '',
      ram: 32,
      resolution: '2560x1440',
      settingsPreset: 'High',
      avgFps: 60,
    },
    mode: 'onTouched',
  });

  // Auto-load saved rig when dialog opens (Phase 1 polish)
  // Also load multiple saved devices for Phase 2 selector
  useEffect(() => {
    if (open) {
      const t = setTimeout(async () => {
        try {
          const saved = await loadMyRigAsync();
          if (saved && !form.getValues('cpu') && !form.getValues('gpu')) {
            if (saved.cpu) form.setValue('cpu', saved.cpu);
            if (saved.gpu) form.setValue('gpu', saved.gpu);
            if (saved.ram) form.setValue('ram', saved.ram);
            if (saved.resolution) form.setValue('resolution', saved.resolution);
          }
          // Phase 2: load multiple devices for selector
          const devices = await (loadUserDevices as any)();
          if (Array.isArray(devices) && devices.length > 0) setSavedDevices(devices);
        } catch {}
      }, 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Detection handlers (consistent with other surfaces)
  const handleDetected = (result: DetectedHardware) => {
    setDetectedRig(result);
    setDetectionState('detected');
  };

  const openPasteModal = () => setPasteModalOpen(true);

  const applyDetectedToForm = (detected: DetectedHardware) => {
    if (detected.cpu) form.setValue('cpu', detected.cpu, { shouldValidate: true });
    if (detected.gpu) form.setValue('gpu', detected.gpu, { shouldValidate: true });
    if (detected.ram) form.setValue('ram', detected.ram, { shouldValidate: true });
    if (detected.resolution) form.setValue('resolution', detected.resolution, { shouldValidate: true });
    if (detected.driverVersion) form.setValue('driverVersion', detected.driverVersion, { shouldValidate: true });

    setDetectionState('applied');
    setDetectedRig(null);
  };

  const handleClearDetection = () => {
    setDetectedRig(null);
    setDetectionState('idle');
  };

  // Quick "Use my saved rig" prefill (very useful in submit flow)
  const useSavedRig = async () => {
    try {
      const saved = await loadMyRigAsync();
      if (saved) {
        if (saved.cpu) form.setValue('cpu', saved.cpu, { shouldValidate: true });
        if (saved.gpu) form.setValue('gpu', saved.gpu, { shouldValidate: true });
        if (saved.ram) form.setValue('ram', saved.ram, { shouldValidate: true });
        if (saved.resolution) form.setValue('resolution', saved.resolution, { shouldValidate: true });
        showUserSuccess('Loaded your saved rig');
      } else {
        showUserError('No saved rig found. Use Detect or fill manually.');
      }
    } catch {
      showUserError('Could not load saved rig.');
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);

    try {
      // Hardware Catalog normalization (Phase 6+)
      const cpuNorm = normalizeHardwareSync(values.cpu);
      const gpuNorm = normalizeHardwareSync(values.gpu);

      await addUserReport({
        gameId: values.gameId,
        cpu: values.cpu,
        gpu: values.gpu,
        ram: values.ram,
        resolution: values.resolution,
        refreshRate: values.refreshRate,
        settingsPreset: values.settingsPreset,
        avgFps: values.avgFps,
        fps1PercentLow: values.fps1PercentLow,
        notes: values.notes,
        tweaks: values.tweaks,
        driverVersion: values.driverVersion,
        // Pass canonicals for future denorm + validation
        canonicalCpu: cpuNorm.canonical,
        canonicalGpu: gpuNorm.canonical,
      });

      showUserSuccess('Report submitted — thank you!');

      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      // Server actions already throw friendly messages (rate limit, duplicate, etc.)
      const friendly = e?.message || 'Could not submit report. Please try again.';
      showUserError(friendly.length > 110 ? 'Could not submit report. Please try again.' : friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl !bg-[#111827] border-[#334155] shadow-2xl">
        <DialogHeader>
          <DialogTitle>Submit Performance Report</DialogTitle>
          <DialogDescription>
            Help the community — report your real experience with <span className="font-medium text-foreground">{game.name}</span>.
            Takes ~45 seconds.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 pt-2" noValidate>
          {/* Hardware row — now with full Identify My Hardware support (browser + paste, ProtonDB-style inxi on Linux) */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>CPU</Label>
                  <HardwareDetectButton
                    mode="browser"
                    onDetect={handleDetected}
                    state={detectionState}
                    onRequestPaste={openPasteModal}
                  />
                </div>
                <HardwareCombobox
                  value={form.watch('cpu')}
                  onChange={(val) => form.setValue('cpu', val, { shouldValidate: true })}
                  componentType="cpu"
                  placeholder="Search Ryzen 7 7800X3D, i5-13600K..."
                />
                {form.formState.errors.cpu && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.cpu.message}</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>GPU</Label>
                  <HardwareDetectButton
                    mode="browser"
                    onDetect={handleDetected}
                    state={detectionState}
                    onRequestPaste={openPasteModal}
                  />
                </div>
                <HardwareCombobox
                  value={form.watch('gpu')}
                  onChange={(val) => form.setValue('gpu', val, { shouldValidate: true })}
                  componentType="gpu"
                  placeholder="Search RTX 4070 Ti, RX 7800 XT..."
                />
                {form.formState.errors.gpu && (
                  <p className="mt-1 text-xs text-destructive">{form.formState.errors.gpu.message}</p>
                )}
              </div>
            </div>

            {/* Detection banner (educational + Apply button). Same component as checker/profile. */}
            <DetectedHardwareBanner
              detected={detectedRig}
              onApply={applyDetectedToForm}
              onRefine={() => setDetectedRig(null)}
              onDismiss={handleClearDetection}
              onTryPaste={openPasteModal}
              applied={detectionState === 'applied'}
            />

            {/* Quick actions + Phase 2 multi-device selector */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={useSavedRig}
                className="h-7 text-xs"
              >
                Use my saved rig
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openPasteModal}
                className="h-7 text-xs"
              >
                Paste system info (most accurate)
              </Button>

              {savedDevices.length > 1 && (
                <select
                  className="h-7 text-xs rounded border bg-background px-2"
                  onChange={(e) => {
                    const dev = savedDevices.find(d => d.id === e.target.value);
                    if (dev) {
                      form.setValue('cpu', dev.cpu, { shouldValidate: true });
                      form.setValue('gpu', dev.gpu, { shouldValidate: true });
                      form.setValue('ram', dev.ram, { shouldValidate: true });
                      if (dev.resolution) form.setValue('resolution', dev.resolution, { shouldValidate: true });
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Choose saved device…</option>
                  {savedDevices.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.label || 'Unnamed'} — {d.gpu}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="ram">RAM (GB)</Label>
              <Input id="ram" type="number" {...form.register('ram')} />
              {form.formState.errors.ram && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.ram.message}</p>
              )}
            </div>
            <div>
              <Label>Resolution</Label>
              <Select
                value={form.watch('resolution')}
                onValueChange={(v) => form.setValue('resolution', v)}
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
            </div>
            <div>
              <Label htmlFor="refresh">Refresh Rate (optional)</Label>
              <Input id="refresh" type="number" placeholder="144" {...form.register('refreshRate')} />
            </div>
          </div>

          {/* Settings + FPS */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label>Graphics Preset</Label>
              <Select
                value={form.watch('settingsPreset')}
                onValueChange={(v) => form.setValue('settingsPreset', v as GraphicsPreset)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="avgFps">Average FPS *</Label>
              <Input id="avgFps" type="number" {...form.register('avgFps')} />
              {form.formState.errors.avgFps && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.avgFps.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="onePercent">1% Low (optional)</Label>
              <Input id="onePercent" type="number" placeholder="58" {...form.register('fps1PercentLow')} />
            </div>
          </div>

          {/* Notes / tweaks */}
          <div>
            <Label htmlFor="tweaks">Tweaks / Config (optional)</Label>
            <Textarea
              id="tweaks"
              placeholder="DLSS Quality + Frame Generation, shadows lowered, driver 560.81..."
              rows={2}
              {...form.register('tweaks')}
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes / Issues (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Minor stuttering in Dogtown. Excellent everywhere else after 2.1 patch."
              rows={2}
              {...form.register('notes')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="driver">Driver Version (optional)</Label>
              <Input id="driver" placeholder="560.81" {...form.register('driverVersion')} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" className="hover:bg-accent/70" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-white text-black font-medium hover:bg-white/90"
              disabled={isSubmitting || !form.formState.isValid}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            {process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true' && isSupabaseConfigured()
              ? 'Real mode: report publishes immediately; community voting handles credibility.'
              : 'Demo/local mode: report saved locally (localStorage) for this browser only.'}
          </p>
        </form>

        {/* Paste modal (inxi / dxdiag / Steam sysinfo — the ProtonDB precision path) */}
        <PasteHardwareModal
          open={pasteModalOpen}
          onOpenChange={setPasteModalOpen}
          onApply={(r) => {
            // Apply directly into the form (also sets driverVersion when present)
            if (r.cpu) form.setValue('cpu', r.cpu, { shouldValidate: true });
            if (r.gpu) form.setValue('gpu', r.gpu, { shouldValidate: true });
            if (r.ram) form.setValue('ram', r.ram, { shouldValidate: true });
            if (r.resolution) form.setValue('resolution', r.resolution, { shouldValidate: true });
            if (r.driverVersion) form.setValue('driverVersion', r.driverVersion, { shouldValidate: true });
            setPasteModalOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
