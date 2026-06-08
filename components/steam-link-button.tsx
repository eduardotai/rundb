'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { showUserError, showUserSuccess } from '@/lib/toast';
import { Link as LinkIcon, Unlink, Loader2 } from 'lucide-react';
import type { SteamLinkStatus } from '@/lib/data';

interface SteamLinkButtonProps {
  status: SteamLinkStatus | null;
  onLinked?: () => void;
  onUnlinked?: () => void;
  size?: 'sm' | 'default';
}

export function SteamLinkButton({ status, onLinked, onUnlinked, size = 'default' }: SteamLinkButtonProps) {
  const [loading, setLoading] = useState(false);

  const linked = !!status?.linked;

  const handleLink = async () => {
    if (linked) return;

    const consent = window.confirm(
      'Link your Steam account?\n\n' +
      'We will only read your public profile (name, avatar) and (optionally) a small sample of owned games for suggestions.\n' +
      'We NEVER access friends, messages, private data, or hardware.\n\n' +
      'You will be redirected to Steam to approve. After linking you can still paste your hardware details (Steam System Information) once per device for accurate CPU/RAM/GPU.\n\n' +
      'You can unlink anytime.'
    );
    if (!consent) return;

    setLoading(true);
    try {
      const res = await fetch('/api/steam/start-link');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start Steam link');
      }
      const { url } = await res.json();
      // Redirect to Steam
      window.location.href = url;
    } catch (e: any) {
      showUserError(e?.message || 'Could not start Steam linking. Please try again.');
      setLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (!linked) return;

    if (!window.confirm('Unlink Steam account? Your saved devices/rigs will remain, but you will lose the verified badge and future library-based features.')) {
      return;
    }

    setLoading(true);
    try {
      const { unlinkSteamAccount } = await import('@/lib/data');
      const ok = await unlinkSteamAccount();
      if (ok) {
        showUserSuccess('Steam account unlinked');
        onUnlinked?.();
      } else {
        showUserError('Failed to unlink. Please try again.');
      }
    } catch {
      showUserError('Error unlinking Steam account.');
    } finally {
      setLoading(false);
    }
  };

  if (linked && status) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <LinkIcon className="h-3.5 w-3.5" />
          <span>Steam linked{status.persona ? ` as ${status.persona}` : ''}</span>
        </div>
        <Button
          variant="ghost"
          size={size === 'sm' ? 'sm' : 'default'}
          onClick={handleUnlink}
          disabled={loading}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3.5 w-3.5 mr-1" />}
          Unlink
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleLink}
      disabled={loading}
      size={size}
      variant="outline"
      className="gap-2"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LinkIcon className="h-4 w-4" />
      )}
      Link Steam account
    </Button>
  );
}
