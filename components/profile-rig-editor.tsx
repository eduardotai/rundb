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
import { DetectedHardwareBanner } from '@/components/detected-hardware-banner';
import { PasteHardwareModal } from '@/components/paste-hardware-modal';
import type { DetectedHardware } from '@/lib/types';
import { HardwareCombobox } from '@/components/hardware-combobox';
import { MAIN_RESOLUTIONS } from '@/lib/types';

interface ProfileRigEditorProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      username?: string;
      full_name?: string;
      avatar_url?: string;
    };
    app_metadata?: {
      provider?: string;
    };
    is_anonymous?: boolean;
  };
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
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Hardware Identification (Plan 4)
  const [detectedRig, setDetectedRig] = useState<DetectedHardware | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  const supabase = createClient();

  const isAnonymous =
    user.is_anonymous ||
    user.app_metadata?.provider === 'anonymous' ||
    !user.email;

  // displayName prefers the editable username state (after load), then metadata fallbacks (legacy full_name support)
  const displayName =
    username ||
    user.user_metadata?.username ||
    user.user_metadata?.full_name ||
    user.email ||
    (isAnonymous ? 'Anonymous Guest' : 'User');

  // Load existing profile data (My Rig fields from profiles table)
  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('main_cpu, main_gpu, main_ram, preferred_resolution, username')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows found (new anon or edge case) — ignore, start blank
          console.warn('[profile] Could not load profile rig:', error.message);
        }

        if (data) {
          const loadedRes = data.preferred_resolution || '2560x1440';
          const safeRes = (MAIN_RESOLUTIONS as readonly string[]).includes(loadedRes) ? loadedRes : '2560x1440';
          setRig({
            cpu: data.main_cpu || '',
            gpu: data.main_gpu || '',
            ram: data.main_ram ?? '',
            resolution: safeRes,
          });
          setUsername(data.username || '');
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
    const safeUsername = sanitizeFullName(username).slice(0, 32);

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
        username: safeUsername || null,
        main_cpu: safeCpu,
        main_gpu: safeGpu,
        main_ram: ramNum,
        preferred_resolution: safeResolution,
      });

      if (error) throw error;

      // Sync username to auth user_metadata so header / other client reads see it without reload
      if (safeUsername) {
        try {
          await supabase.auth.updateUser({ data: { username: safeUsername } });
        } catch (metaErr) {
          // Non-fatal: profile row is the source of truth
          console.warn('[profile] username metadata sync skipped:', metaErr);
        }
      }

      // Update local state so displayName and UI reflect immediately
      setUsername(safeUsername || '');

      showUserSuccess('Rig saved!');
    } catch (error) {
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
    <div className="space-y-6">
      {/* Account summary */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {isAnonymous
              ? 'You are signed in anonymously. Your profile is stored in Supabase and tied to this session.'
              : 'Signed in with persistent account.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div>
            <Label htmlFor="profile-username" className="text-xs text-muted-foreground">Username / Nickname</Label>
            <Input
              id="profile-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your display name (no real name)"
              disabled={isSaving}
              className="mt-1"
              maxLength={32}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Shown in header, profile, etc. Change anytime. No personal data required.</p>
          </div>
          {user.email && (
            <p>
              <span className="text-muted-foreground">Email:</span> {user.email}
            </p>
          )}
          <p>
            <span className="text-muted-foreground">User ID:</span>{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{user.id.slice(0, 8)}…</code>
          </p>
        </CardContent>
      </Card>

      {/* My Rig editor — saved to profiles table */}
      <Card>
        <CardHeader>
          <CardTitle>My Rig</CardTitle>
          <CardDescription>
            Edit your primary hardware configuration. This is stored in the <code>profiles</code> table
            and will power personalized features (compatibility predictions, report filtering) in future phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ram">RAM (GB)</Label>
              <Input
                id="ram"
                type="number"
                min={4}
                max={128}
                placeholder="32"
                value={rig.ram}
                onChange={(e) => updateField('ram', e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')}
                disabled={isSaving}
              />
              <p className="text-xs text-muted-foreground mt-1">4–128 GB</p>
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
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Common resolutions only.</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button 
              onClick={handleSave} 
              disabled={isSaving} 
              size="lg"
              className="bg-white text-black font-medium hover:bg-white/90"
            >
              {isSaving ? 'Saving...' : 'Save Username & My Rig'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Username + rig saved to Supabase profiles / user_rigs.
            </p>
          </div>

          <div className="text-xs text-muted-foreground border-t pt-4">
            Tip: Saving here writes to the <code>profiles</code> table (main_* fields). The CompatibilityChecker

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
            (and header/game pages) prefer <code>user_rigs</code> for logged-in users but fall back to your profile
            data; localStorage only for guests. Full DB persistence complete (see data.ts Phase 2 adapter).
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
