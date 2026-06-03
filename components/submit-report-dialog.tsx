'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Game, GraphicsPreset, PerformanceTier } from '@/lib/types';
import { addUserReport, isSupabaseConfigured } from '@/lib/data';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { sanitizeFullName } from '@/lib/sanitize';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { normalizeHardwareSync } from '@/lib/normalize-hardware';
import { HardwareDetectButton } from '@/components/hardware-detect-button';
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import { PerformanceBadge } from '@/components/performance-badge';
import type { DetectedHardware } from '@/lib/types';
import { mergeDetected } from '@/lib/hardware-detector';
import { loadMyRigAsync, loadUserDevices } from '@/lib/data';
import { Cpu, Zap, Monitor } from 'lucide-react';
import { upgradeCoverImageSrc } from '@/lib/cover-image-url';

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
  ramSpeed: z.string()
    .max(20, 'RAM speed is too long')
    .optional()
    .transform((v) => (v ? sanitizeFullName(v) : undefined)),
  resolution: z.string().min(3).max(20),
  refreshRate: z.coerce.number().optional(),
  settingsPreset: z.enum(['Low', 'Medium', 'High', 'Ultra', 'Custom']),
  customSettingsNotes: z.string()
    .max(300, 'Custom settings notes are too long')
    .optional()
    .transform((v) => (v ? sanitizeFullName(v) : undefined)),
  avgFps: z.coerce.number().min(1, 'Average FPS must be at least 1').max(600, 'Average FPS must be at most 600'),
  fps1PercentLow: z.coerce.number().optional(),
  notes: z.string()
    .max(500, 'Notes are too long')
    .optional()
    .transform((v) => v ? sanitizeFullName(v) : undefined),
  issues: z.string()
    .max(500, 'Issues are too long')
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

// Common resolutions — extends the 3 "main" ones with ultrawide + lower options so the
// picker reflects what real players actually run (data parity with the schema's free-text column).
const RESOLUTION_OPTIONS: { value: string; label: string }[] = [
  { value: '1280x720', label: '1280×720 (720p)' },
  { value: '1920x1080', label: '1920×1080 (1080p)' },
  { value: '2560x1080', label: '2560×1080 (UW 1080p)' },
  { value: '2560x1440', label: '2560×1440 (1440p)' },
  { value: '3440x1440', label: '3440×1440 (UW 1440p)' },
  { value: '3840x2160', label: '3840×2160 (4K)' },
];

// Mirror of the server-side tier calc (app/actions/reports.ts) so the preview can show the
// tier a given Average FPS will produce. Kept in sync intentionally — the authoritative
// calculation stays server-side; this is a non-authoritative hint only.
function previewTier(avgFps: number): PerformanceTier | null {
  if (!Number.isFinite(avgFps) || avgFps < 1) return null;
  if (avgFps >= 90) return 'Excellent';
  if (avgFps >= 60) return 'Good';
  if (avgFps >= 40) return 'Playable';
  if (avgFps >= 25) return 'Struggling';
  return 'Unplayable';
}

// Small section wrapper — gives the form clear, scannable groupings instead of one long list.
function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</h3>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function SubmitReportDialog({ open, onOpenChange, game, onSuccess }: SubmitReportDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hardware Identification (Plan 4) — same pattern as compatibility-checker + profile editor
  const [detectedRig, setDetectedRig] = useState<DetectedHardware | null>(null);
  const [detectionState, setDetectionState] = useState<'idle' | 'detecting' | 'detected' | 'applied'>('idle');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [savedDevices, setSavedDevices] = useState<any[]>([]);
  const [coverError, setCoverError] = useState(false);

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

  // Watch the whole form so the left-pane live preview stays in sync as the user types.
  const v = form.watch();
  const preset = v.settingsPreset;
  const avgFpsNum = Number(v.avgFps);
  const onePctNum = Number(v.fps1PercentLow);
  const tierPreview = useMemo(() => previewTier(avgFpsNum), [avgFpsNum]);

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
    const isHint = (s?: string) => !!s && /browser hint/i.test(s);

    // Only prefill cpu/ram from detection if they are real values (not browser estimates).
    // Browser "Detect" still shows the hints in the banner + tells you to Paste for actual CPU/RAM.
    if (detected.cpu && !isHint(detected.cpu)) form.setValue('cpu', detected.cpu, { shouldValidate: true });
    if (detected.gpu) form.setValue('gpu', detected.gpu, { shouldValidate: true });
    if (detected.ram != null && !isHint(detected.cpu)) {
      // Only auto-apply real RAM numbers (from paste). Browser hints are shown in banner but not forced into the form.
      form.setValue('ram', detected.ram, { shouldValidate: true });
    }
    if (detected.resolution) form.setValue('resolution', detected.resolution, { shouldValidate: true });
    if (detected.driverVersion) form.setValue('driverVersion', detected.driverVersion, { shouldValidate: true });
    if (detected.refreshRate != null) form.setValue('refreshRate', detected.refreshRate, { shouldValidate: true });

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
        ramSpeed: values.ramSpeed,
        resolution: values.resolution,
        refreshRate: values.refreshRate,
        settingsPreset: values.settingsPreset,
        customSettingsNotes: values.settingsPreset === 'Custom' ? values.customSettingsNotes : undefined,
        avgFps: values.avgFps,
        fps1PercentLow: values.fps1PercentLow,
        notes: values.notes,
        issues: values.issues,
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
      <DialogContent className="max-w-4xl gap-0 overflow-y-auto !bg-card p-0 shadow-2xl md:overflow-hidden max-h-[92vh]">
        <div className="grid md:grid-cols-[260px_1fr]">
          {/* ============================================================ */}
          {/* LEFT — game + live preview                                   */}
          {/* ============================================================ */}
          <aside className="relative flex flex-col gap-4 border-b border-border bg-gradient-to-b from-muted/40 to-card p-5 md:border-b-0 md:border-r">
            {/* Cover — square banner to match promotional square art style */}
            <div className="flex items-center gap-3 md:flex-col md:items-start">
              <div className="relative w-16 aspect-square shrink-0 overflow-hidden rounded-lg border border-border bg-muted md:w-full md:max-w-[220px]">
                {!coverError ? (
                  /* Square frame to match the reference promo style. The banner is shown fully (no cropping) thanks to object-contain (letterbox bars appear on sides for standard portrait covers). */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={upgradeCoverImageSrc(game.coverImage, game.steamAppId)}
                    alt={game.name}
                    className="h-full w-full object-contain"
                    onError={() => setCoverError(true)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/60 p-2 text-center">
                    <span className="text-[11px] font-semibold leading-tight text-foreground/80">{game.name}</span>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold leading-tight md:mt-3">{game.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {game.developer}
                  {game.releaseYear ? ` • ${game.releaseYear}` : ''}
                </div>
              </div>
            </div>

            {/* Live preview of the report card */}
            <div className="hidden md:block">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                Live preview
              </div>
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Zap className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                      <span className={`truncate ${v.gpu ? '' : 'text-muted-foreground/60'}`}>
                        {v.gpu || 'Your GPU'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Cpu className="h-3 w-3 shrink-0" />
                      <span className={`truncate ${v.cpu ? '' : 'text-muted-foreground/60'}`}>
                        {v.cpu || 'Your CPU'}
                      </span>
                    </div>
                  </div>
                  {tierPreview && <PerformanceBadge tier={tierPreview} size="sm" />}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <Monitor className="h-3 w-3" />
                    {v.resolution}
                    {Number(v.refreshRate) > 0 ? ` @ ${Number(v.refreshRate)}Hz` : ''}
                  </span>
                  <span className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] font-medium">
                    {v.settingsPreset}
                    {v.settingsPreset === 'Custom' && <span className="ml-1 text-[10px] text-muted-foreground">(custom)</span>}
                  </span>
                  {Number(v.ram) > 0 && (
                    <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                      {Number(v.ram)} GB
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                    {Number.isFinite(avgFpsNum) && avgFpsNum > 0 ? avgFpsNum : '—'}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">FPS</span>
                  {Number.isFinite(onePctNum) && onePctNum > 0 && (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">{onePctNum}</span> 1% low
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground/70">
                This is roughly how your report will appear to others. The tier is set automatically from your FPS.
              </p>
            </div>
          </aside>

          {/* ============================================================ */}
          {/* RIGHT — form                                                 */}
          {/* ============================================================ */}
          <div className="max-h-[92vh] overflow-y-auto p-5 md:p-6">
            <div className="space-y-1 pr-8">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Cpu className="h-5 w-5 text-primary" />
                Submit a performance report
              </DialogTitle>
              <DialogDescription>
                How does it run on your hardware? Takes ~45 seconds — only CPU, GPU and Average FPS are required.
              </DialogDescription>
            </div>

            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 space-y-7" noValidate>
              {/* -------------------------------------------------------- */}
              {/* Hardware */}
              {/* -------------------------------------------------------- */}
              <Section label="Your hardware" hint="Detect, paste, or type">
                {/* Quick actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <HardwareDetectButton
                    mode="browser"
                    onDetect={handleDetected}
                    state={detectionState}
                    onRequestPaste={openPasteModal}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={useSavedRig} className="h-7 text-xs">
                    Use my saved rig
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={openPasteModal} className="h-7 text-xs">
                    Paste system info
                  </Button>

                  {savedDevices.length > 1 && (
                    <select
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                      onChange={(e) => {
                        const dev = savedDevices.find((d) => d.id === e.target.value);
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

                {/* Detection banner (educational + Apply button). Same component as checker/profile. */}
                <DetectedHardwareBanner
                  detected={detectedRig}
                  onApply={applyDetectedToForm}
                  onRefine={() => setDetectedRig(null)}
                  onDismiss={handleClearDetection}
                  onTryPaste={openPasteModal}
                  applied={detectionState === 'applied'}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1 block">CPU <span className="text-destructive">*</span></Label>
                    <HardwareCombobox
                      value={form.watch('cpu')}
                      onChange={(val) => form.setValue('cpu', val, { shouldValidate: true })}
                      componentType="cpu"
                      placeholder="Ryzen 7 7800X3D, i5-13600K…"
                    />
                    {form.formState.errors.cpu && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.cpu.message}</p>
                    )}
                  </div>
                  <div>
                    <Label className="mb-1 block">GPU <span className="text-destructive">*</span></Label>
                    <HardwareCombobox
                      value={form.watch('gpu')}
                      onChange={(val) => form.setValue('gpu', val, { shouldValidate: true })}
                      componentType="gpu"
                      placeholder="RTX 4070 Ti, RX 7800 XT…"
                    />
                    {form.formState.errors.gpu && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.gpu.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ram" className="mb-1 block">RAM (GB)</Label>
                    <Input id="ram" type="number" {...form.register('ram')} />
                    {form.formState.errors.ram && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.ram.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="ramSpeed" className="mb-1 block">RAM speed (optional)</Label>
                    <Input id="ramSpeed" placeholder="6000 MT/s" {...form.register('ramSpeed')} />
                    {form.formState.errors.ramSpeed && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.ramSpeed.message}</p>
                    )}
                  </div>
                </div>
              </Section>

              {/* -------------------------------------------------------- */}
              {/* Display & graphics */}
              {/* -------------------------------------------------------- */}
              <Section label="Display & graphics">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <Label className="mb-1 block">Resolution</Label>
                    <Select
                      value={form.watch('resolution')}
                      onValueChange={(val) => form.setValue('resolution', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RESOLUTION_OPTIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="refresh" className="mb-1 block">Refresh rate</Label>
                    <Input id="refresh" type="number" placeholder="144" {...form.register('refreshRate')} />
                  </div>
                  <div>
                    <Label className="mb-1 block">Preset</Label>
                    <Select
                      value={form.watch('settingsPreset')}
                      onValueChange={(val) => form.setValue('settingsPreset', val as GraphicsPreset)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESETS.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Progressive disclosure: only ask what "Custom" means when it's selected. */}
                {preset === 'Custom' && (
                  <div>
                    <Label htmlFor="customSettings" className="mb-1 block">What did you customize?</Label>
                    <Textarea
                      id="customSettings"
                      placeholder="Textures Ultra, shadows Medium, volumetrics Low, motion blur off…"
                      rows={2}
                      {...form.register('customSettingsNotes')}
                    />
                    {form.formState.errors.customSettingsNotes && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.customSettingsNotes.message}</p>
                    )}
                  </div>
                )}
              </Section>

              {/* -------------------------------------------------------- */}
              {/* Performance */}
              {/* -------------------------------------------------------- */}
              <Section label="Performance">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <Label htmlFor="avgFps">Average FPS <span className="text-destructive">*</span></Label>
                      {tierPreview && (
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          Predicted
                          <PerformanceBadge tier={tierPreview} size="sm" />
                        </span>
                      )}
                    </div>
                    <Input id="avgFps" type="number" {...form.register('avgFps')} />
                    {form.formState.errors.avgFps && (
                      <p className="mt-1 text-xs text-destructive">{form.formState.errors.avgFps.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="onePercent" className="mb-1 block">1% low FPS (optional)</Label>
                    <Input id="onePercent" type="number" placeholder="58" {...form.register('fps1PercentLow')} />
                  </div>
                </div>
              </Section>

              {/* -------------------------------------------------------- */}
              {/* Details */}
              {/* -------------------------------------------------------- */}
              <Section label="Details" hint="Optional, but very helpful">
                <div>
                  <Label htmlFor="tweaks" className="mb-1 block">Tweaks / config</Label>
                  <Textarea
                    id="tweaks"
                    placeholder="DLSS Quality + Frame Generation, shadows lowered, ReBAR on…"
                    rows={2}
                    {...form.register('tweaks')}
                  />
                </div>
                <div>
                  <Label htmlFor="notes" className="mb-1 block">Notes / overall impression</Label>
                  <Textarea
                    id="notes"
                    placeholder="Buttery smooth after the 2.1 patch. Looks great at these settings."
                    rows={2}
                    {...form.register('notes')}
                  />
                </div>
                <div>
                  <Label htmlFor="issues" className="mb-1 block">Issues / bugs</Label>
                  <Textarea
                    id="issues"
                    placeholder="Minor stuttering in Dogtown, occasional shader-comp hitch on first load."
                    rows={2}
                    {...form.register('issues')}
                  />
                </div>
                <div>
                  <Label htmlFor="driver" className="mb-1 block">Driver version</Label>
                  <Input id="driver" placeholder="560.81" {...form.register('driverVersion')} className="sm:max-w-xs" />
                </div>
              </Section>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !form.formState.isValid}
                  className="bg-white text-black font-medium hover:bg-white/90"
                >
                  {isSubmitting ? 'Submitting…' : 'Submit report'}
                </Button>
              </div>

              <p className="text-center text-[11px] text-muted-foreground">
                {process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true' && isSupabaseConfigured()
                  ? 'Real mode: report publishes immediately; community voting handles credibility.'
                  : 'Demo/local mode: report saved locally (localStorage) for this browser only.'}
              </p>
            </form>
          </div>
        </div>

        {/* Paste modal (inxi / dxdiag / Steam sysinfo — the ProtonDB precision path) */}
        <PasteHardwareModal
          open={pasteModalOpen}
          onOpenChange={setPasteModalOpen}
          onApply={(pasteDetected) => {
            // Merge any prior browser detection (res/refresh/UA-CH) with paste (exact cpu/gpu/ram) for richest signal.
            const merged = mergeDetected(detectedRig, pasteDetected);
            applyDetectedToForm(merged);
            setPasteModalOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
