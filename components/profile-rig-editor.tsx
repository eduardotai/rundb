'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
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
import { MAIN_RESOLUTIONS } from '@/lib/types';

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

  const supabase = createClient();

  // Load existing My Rig fields from the profiles table.
  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('main_cpu, main_gpu, main_ram, preferred_resolution')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows found (new anon or edge case) — ignore, start blank
          console.warn('[profile] Could not load profile rig:', error.message);
        }

        if (data) {
          const loadedRes = data.preferred_resolution || '2560x1440';
          const safeRes = (MAIN_RESOLUTIONS as readonly string[]).includes(loadedRes)
            ? loadedRes
            : '2560x1440';
          setRig({
            cpu: data.main_cpu || '',
            gpu: data.main_gpu || '',
            ram: data.main_ram ?? '',
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
  }, [user.id, supabase]);

  const handleSave = async () => {
    const safeCpu = sanitizeFullName(rig.cpu);
    const safeGpu = sanitizeFullName(rig.gpu);
    const safeResolution = sanitizeFullName(rig.resolution);

    if (!safeCpu || !safeGpu) {
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

    setIsSaving(true);
    try {
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        main_cpu: safeCpu,
        main_gpu: safeGpu,
        main_ram: ramNum,
        preferred_resolution: safeResolution,
      });

      if (error) throw error;

      showUserSuccess('Rig saved!');
    } catch {
      showUserError('Could not save your rig. Please try again.');
    } finally {
      setIsSaving(false);
    }
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
          Your primary hardware configuration. Stored in the <code>profiles</code> table and used to
          power personalized compatibility predictions and report filtering.
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
                  if (r.cpu) updateField('cpu', r.cpu);
                  if (r.gpu) updateField('gpu', r.gpu);
                  if (r.ram) updateField('ram', r.ram);
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
              placeholder="Search RTX 4070 Super or RX 7800 XT..."
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

        <PasteHardwareModal
          open={pasteModalOpen}
          onOpenChange={setPasteModalOpen}
          onApply={(r) => {
            if (r.cpu) updateField('cpu', r.cpu);
            if (r.gpu) updateField('gpu', r.gpu);
            if (r.ram) updateField('ram', r.ram);
            setPasteModalOpen(false);
          }}
        />
      </CardContent>
    </Card>
  );
}
