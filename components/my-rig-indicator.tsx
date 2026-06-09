'use client';

import { useState, useEffect } from 'react';
import { loadMyRigAsync, clearMyRigAsync } from '@/lib/data';
import { UserPC } from '@/lib/types';
import { Monitor } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * Client component for showing the current "My Rig" summary in the header.
 * Phase 2 full DB persistence (aligned with Master Plan):
 * - loadMyRigAsync / clearMyRigAsync: user_rigs primary (for CompatibilityChecker) + profiles fallback when logged in (incl. anonymous users via auth.uid())
 * - localStorage (mock) ONLY as guest fallback when no auth or !USE_REAL
 * - Auth state listener for live rig load/switch on sign in/out (no full reload needed).
 */
export function MyRigIndicator() {
  const [myRig, setMyRig] = useState<UserPC | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function load() {
      try {
        const saved = await loadMyRigAsync();
        if (mounted) setMyRig(saved);
      } catch (e) {
        console.warn('[MyRigIndicator] loadMyRigAsync error', e);
      }
    }

    load();

    // Auth listener: reload rig from correct source (DB vs localStorage guest fallback) on sign in/out
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      if (mounted) {
        loadMyRigAsync()
          .then((saved) => {
            if (mounted) setMyRig(saved);
          })
          .catch(() => {});
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleClearRig = async () => {
    setMyRig(null);
    try {
      await clearMyRigAsync();
    } catch {
      // clearMyRigAsync already falls back internally
    }

    // Defense in depth: clear any stale guest LS key (harmless when auth user; aligns with checker)
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem('rundb_my_rig'); } catch {}
    }
  };

  if (!myRig) return null;

  return (
    <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs md:flex">
      <Monitor className="h-3.5 w-3.5 text-cyan-400" />
      <span className="font-medium">{myRig.gpu.split(' ').slice(-1)}</span>
      <button
        onClick={handleClearRig}
        className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
        aria-label="Clear My Rig"
      >
        ×
      </button>
    </div>
  );
}
