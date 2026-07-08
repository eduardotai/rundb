'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { IgpuSuggestDialog } from '@/components/igpu-suggest-dialog';
import { PerformanceBadge } from '@/components/performance-badge';
import { GraphicsPreset, PerformanceTier } from '@/lib/types';
import type { ProfileReportLite } from '@/lib/server/profile';
import { updateReportAction } from '@/app/actions/reports';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { sanitizeFullName } from '@/lib/sanitize';
import { getAllHardwareCatalogAsync } from '@/lib/data';
import { shouldOfferIgpuOnEmptyGpu } from '@/lib/cpu-igpu';
import { Pencil } from 'lucide-react';

const PRESETS: GraphicsPreset[] = ['Low', 'Medium', 'High', 'Ultra', 'Custom'];

const RESOLUTION_OPTIONS: { value: string; label: string }[] = [
  { value: '1280x720', label: '1280×720 (720p)' },
  { value: '1920x1080', label: '1920×1080 (1080p)' },
  { value: '2560x1080', label: '2560×1080 (UW 1080p)' },
  { value: '2560x1440', label: '2560×1440 (1440p)' },
  { value: '3440x1440', label: '3440×1440 (UW 1440p)' },
  { value: '3840x2160', label: '3840×2160 (4K)' },
];

// Mirror of the server-side tier calc (app/actions/reports.ts) — non-authoritative preview only.
function previewTier(avgFps: number): PerformanceTier | null {
  if (!Number.isFinite(avgFps) || avgFps < 1) return null;
  if (avgFps >= 90) return 'Excellent';
  if (avgFps >= 60) return 'Good';
  if (avgFps >= 40) return 'Playable';
  if (avgFps >= 25) return 'Struggling';
  return 'Unplayable';
}

const formSchema = z.object({
  cpu: z.string().min(2, 'CPU is required').max(80, 'Too long').transform((v) => sanitizeFullName(v)),
  gpu: z.string().min(2, 'GPU is required').max(80, 'Too long').transform((v) => sanitizeFullName(v)),
  ram: z.coerce.number().min(2, 'Min 2 GB').max(256, 'Max 256 GB'),
  ramSpeed: z.string().max(20, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
  resolution: z.string().min(3).max(20),
  refreshRate: z.coerce.number().optional(),
  settingsPreset: z.enum(['Low', 'Medium', 'High', 'Ultra', 'Custom']),
  customSettingsNotes: z.string().max(300, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
  avgFps: z.coerce.number().min(1, 'Min 1').max(600, 'Max 600'),
  fps1PercentLow: z.coerce.number().optional(),
  notes: z.string().max(500, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
  issues: z.string().max(500, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
  tweaks: z.string().max(300, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
  driverVersion: z.string().max(40, 'Too long').optional().transform((v) => (v ? sanitizeFullName(v) : undefined)),
});

type FormValues = z.input<typeof formSchema>;

interface EditReportDialogProps {
  report: ProfileReportLite | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the parent can refresh server data. */
  onSaved?: () => void;
}

function num(v: number | null | undefined): number | undefined {
  return v == null ? undefined : v;
}

export function EditReportDialog({ report, open, onOpenChange, onSaved }: EditReportDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [igpuDialogOpen, setIgpuDialogOpen] = useState(false);
  const [pendingIgpu, setPendingIgpu] = useState<string | null>(null);
  const [gpuPickerOpen, setGpuPickerOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    mode: 'onTouched',
  });

  // Re-seed the form every time a different report is opened for editing.
  useEffect(() => {
    if (open && report) {
      form.reset({
        cpu: report.cpu,
        gpu: report.gpu,
        ram: report.ram,
        ramSpeed: report.ramSpeed ?? undefined,
        resolution: report.resolution || '2560x1440',
        refreshRate: num(report.refreshRate),
        settingsPreset: (PRESETS.includes(report.settingsPreset as GraphicsPreset)
          ? (report.settingsPreset as GraphicsPreset)
          : 'High'),
        customSettingsNotes: report.customSettingsNotes ?? undefined,
        avgFps: report.avgFps,
        fps1PercentLow: num(report.fps1PercentLow),
        notes: report.notes ?? undefined,
        issues: report.issues ?? undefined,
        tweaks: report.tweaks ?? undefined,
        driverVersion: report.driverVersion ?? undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report?.id]);

  const v = form.watch();
  const preset = v.settingsPreset;
  const avgFpsNum = Number(v.avgFps);
  const tierPreview = useMemo(() => previewTier(avgFpsNum), [avgFpsNum]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cpuVal = sanitizeFullName(String(form.getValues('cpu') || ''));
    const gpuVal = sanitizeFullName(String(form.getValues('gpu') || ''));
    if (cpuVal && !gpuVal) {
      try {
        const catalog = await getAllHardwareCatalogAsync();
        const offer = shouldOfferIgpuOnEmptyGpu(cpuVal, '', catalog);
        if (offer.offer) {
          setPendingIgpu(offer.igpuCanonical);
          setIgpuDialogOpen(true);
          return;
        }
      } catch {
        // fall through
      }
    }
    void form.handleSubmit(onSubmit)(e);
  };

  const onSubmit = async (values: FormValues) => {
    if (!report) return;
    setIsSaving(true);
    try {
      await updateReportAction(report.id, {
        cpu: values.cpu as string,
        gpu: values.gpu as string,
        ram: Number(values.ram),
        ramSpeed: (values.ramSpeed as string) || null,
        resolution: values.resolution,
        refreshRate: values.refreshRate != null && String(values.refreshRate) !== '' ? Number(values.refreshRate) : null,
        settingsPreset: values.settingsPreset,
        customSettingsNotes: values.settingsPreset === 'Custom' ? ((values.customSettingsNotes as string) || null) : null,
        avgFps: Number(values.avgFps),
        fps1PercentLow: values.fps1PercentLow != null && String(values.fps1PercentLow) !== '' ? Number(values.fps1PercentLow) : null,
        notes: (values.notes as string) || null,
        issues: (values.issues as string) || null,
        tweaks: (values.tweaks as string) || null,
        driverVersion: (values.driverVersion as string) || null,
      });

      showUserSuccess('Report updated');
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      const friendly = e?.message || 'Could not save changes. Please try again.';
      showUserError(friendly.length > 110 ? 'Could not save changes. Please try again.' : friendly);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto !bg-card p-0 shadow-2xl">
        <div className="p-5 md:p-6">
          <div className="space-y-1 pr-8">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Pencil className="h-5 w-5 text-primary" />
              Edit report
            </DialogTitle>
            <DialogDescription>
              {report ? (
                <>Update your report for <span className="font-medium text-foreground">{report.gameName}</span>. The performance tier is recalculated from your FPS automatically.</>
              ) : (
                'Update your report.'
              )}
            </DialogDescription>
          </div>

          <form onSubmit={handleFormSubmit} className="mt-5 space-y-7" noValidate>
            {/* Hardware */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your hardware</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block">CPU <span className="text-destructive">*</span></Label>
                  <HardwareCombobox
                    value={form.watch('cpu') as string}
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
                    value={form.watch('gpu') as string}
                    onChange={(val) => form.setValue('gpu', val, { shouldValidate: true })}
                    componentType="gpu"
                    relatedCpu={form.watch('cpu') as string}
                    open={gpuPickerOpen}
                    onOpenChange={setGpuPickerOpen}
                    placeholder="RTX 4070 Ti or integrated graphics…"
                  />
                  {form.formState.errors.gpu && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.gpu.message}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit-ram" className="mb-1 block">RAM (GB)</Label>
                  <Input id="edit-ram" type="number" {...form.register('ram')} />
                  {form.formState.errors.ram && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.ram.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="edit-ramSpeed" className="mb-1 block">RAM speed (optional)</Label>
                  <Input id="edit-ramSpeed" placeholder="6000 MT/s" {...form.register('ramSpeed')} />
                </div>
              </div>
            </section>

            {/* Display & graphics */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Display &amp; graphics</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label className="mb-1 block">Resolution</Label>
                  <Select value={form.watch('resolution')} onValueChange={(val) => form.setValue('resolution', val)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="edit-refresh" className="mb-1 block">Refresh rate</Label>
                  <Input id="edit-refresh" type="number" placeholder="144" {...form.register('refreshRate')} />
                </div>
                <div>
                  <Label className="mb-1 block">Preset</Label>
                  <Select value={form.watch('settingsPreset')} onValueChange={(val) => form.setValue('settingsPreset', val as GraphicsPreset)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRESETS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {preset === 'Custom' && (
                <div>
                  <Label htmlFor="edit-customSettings" className="mb-1 block">What did you customize?</Label>
                  <Textarea id="edit-customSettings" rows={2} placeholder="Textures Ultra, shadows Medium, motion blur off…" {...form.register('customSettingsNotes')} />
                </div>
              )}
            </section>

            {/* Performance */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Performance</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label htmlFor="edit-avgFps">Average FPS <span className="text-destructive">*</span></Label>
                    {tierPreview && (
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        Predicted
                        <PerformanceBadge tier={tierPreview} size="sm" />
                      </span>
                    )}
                  </div>
                  <Input id="edit-avgFps" type="number" {...form.register('avgFps')} />
                  {form.formState.errors.avgFps && (
                    <p className="mt-1 text-xs text-destructive">{form.formState.errors.avgFps.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="edit-onePercent" className="mb-1 block">1% low FPS (optional)</Label>
                  <Input id="edit-onePercent" type="number" placeholder="58" {...form.register('fps1PercentLow')} />
                </div>
              </div>
            </section>

            {/* Details */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Details</h3>
              <div>
                <Label htmlFor="edit-tweaks" className="mb-1 block">Tweaks / config</Label>
                <Textarea id="edit-tweaks" rows={2} placeholder="DLSS Quality + Frame Gen, ReBAR on…" {...form.register('tweaks')} />
              </div>
              <div>
                <Label htmlFor="edit-notes" className="mb-1 block">Notes / overall impression</Label>
                <Textarea id="edit-notes" rows={2} placeholder="Buttery smooth after the latest patch." {...form.register('notes')} />
              </div>
              <div>
                <Label htmlFor="edit-issues" className="mb-1 block">Issues / bugs</Label>
                <Textarea id="edit-issues" rows={2} placeholder="Minor stutter on first shader compile." {...form.register('issues')} />
              </div>
              <div>
                <Label htmlFor="edit-driver" className="mb-1 block">Driver version</Label>
                <Input id="edit-driver" placeholder="560.81" className="sm:max-w-xs" {...form.register('driverVersion')} />
              </div>
            </section>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-white font-medium text-black hover:bg-white/90"
              >
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>

    <IgpuSuggestDialog
      open={igpuDialogOpen}
      onOpenChange={setIgpuDialogOpen}
      igpuCanonical={pendingIgpu || ''}
      cpuLabel={String(form.watch('cpu') || '')}
      onUse={() => {
        if (!pendingIgpu) return;
        const igpu = pendingIgpu;
        form.setValue('gpu', igpu, { shouldValidate: true });
        setIgpuDialogOpen(false);
        setPendingIgpu(null);
        void form.handleSubmit(onSubmit)();
      }}
      onPickManually={() => {
        setIgpuDialogOpen(false);
        setPendingIgpu(null);
        setGpuPickerOpen(true);
      }}
    />
    </>
  );
}
