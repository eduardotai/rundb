'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Game, Report, UserPC } from '@/lib/types';
import type { MatchBreakdown } from '@/lib/similarity';
import { PerformanceBadge } from './performance-badge';
import { formatRelativeTime, calculateHardwareAwareSimilarity as calculateSimilarity } from '@/lib/data';
import { normalizeHardwareSync } from '@/lib/normalize-hardware';
import { cn, gameMediaLoader } from '@/lib/utils';
import { upgradeCoverImageSrc } from '@/lib/cover-image-url';
import {
  ArrowBigDown,
  ArrowBigUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Monitor,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { showUserError } from '@/lib/toast';

// Reports store the short model the user reported (e.g. "RTX 4070", "Ryzen 7 5700X3D").
// For display we resolve it to the full catalog name (e.g. "NVIDIA GeForce RTX 4070").
// Guarded: we only upgrade when the canonical name actually *contains* the reported
// string, so we add the vendor/brand prefix but never silently swap to a different model.
function fullHardwareName(raw: string, canonical?: string): string {
  const r = (raw || '').trim();
  if (!r) return raw;
  const candidates = [canonical, normalizeHardwareSync(r).entry?.canonical];
  for (const c of candidates) {
    if (c && c.toLowerCase().includes(r.toLowerCase())) return c;
  }
  return raw;
}

interface ReportCardProps {
  report: Report;
  userRig?: UserPC | null;
  onHelpful?: (id: string) => void | Promise<void>;
  onVote?: (id: string, value: 1 | -1 | 0) => void | Promise<void>;
  onViewFull?: (report: Report) => void;
  canVote?: boolean;
  compact?: boolean;
  showGame?: boolean;
  breakdown?: MatchBreakdown;
}

export function ReportCard({
  report,
  userRig,
  onHelpful,
  onVote,
  onViewFull,
  canVote = Boolean(onVote || onHelpful),
  compact = false,
  showGame = false,
  breakdown,
}: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Which way the current user has voted (drives button highlight + undo).
  const [userVote, setUserVote] = useState<1 | -1 | 0>(0);
  // Optimistic score offset not yet reflected in the authoritative `report` prop.
  const [pendingDelta, setPendingDelta] = useState(0);
  // Direction of the most recent score change, used to animate the counter.
  const [scoreDir, setScoreDir] = useState(1);
  const [voting, setVoting] = useState(false);

  // Full GPU/CPU names (vendor-prefixed) for display, resolved from the catalog.
  const gpuName = useMemo(() => fullHardwareName(report.gpu, report.canonicalGpu), [report.gpu, report.canonicalGpu]);
  const cpuName = useMemo(() => fullHardwareName(report.cpu, report.canonicalCpu), [report.cpu, report.canonicalCpu]);

  const similarity = userRig ? calculateSimilarity(report, userRig) : 0;
  const isSimilar = similarity > 65;
  const hasDetails = !!(report.tweaks || report.issues || report.driverVersion || report.notes || report.kernel || report.distro);
  const baseScore = report.voteScore ?? report.helpfulVotes ?? 0;
  const displayedScore = baseScore + pendingDelta;
  const reportBadge = report.credibilityBadge || (displayedScore >= 10 ? 'Trusted' : displayedScore >= 3 ? 'Helpful' : 'New');

  // When authoritative data arrives (e.g. after refetch), it already includes the
  // user's vote — so clear the local optimistic offset to avoid double-counting.
  const prevBaseRef = useRef(baseScore);
  useEffect(() => {
    if (prevBaseRef.current !== baseScore) {
      prevBaseRef.current = baseScore;
      setPendingDelta(0);
    }
  }, [baseScore]);

  const handleVote = async (value: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation();
    if (voting) return;
    if (!canVote) {
      showUserError('Sign in to vote on reports.');
      return;
    }

    const prevVote = userVote;
    // Clicking the already-active direction clears the vote (undo).
    const nextVote: 1 | -1 | 0 = prevVote === value ? 0 : value;
    const delta = nextVote - prevVote;

    // Optimistic update for snappy feedback; reverted if the request fails.
    setScoreDir(delta >= 0 ? 1 : -1);
    setUserVote(nextVote);
    setPendingDelta((d) => d + delta);
    setVoting(true);
    try {
      const maybePromise = onVote
        ? onVote(report.id, nextVote)
        : nextVote === 1
          ? onHelpful?.(report.id)
          : undefined;
      if (maybePromise instanceof Promise) await maybePromise;
    } catch (err: unknown) {
      // Revert optimistic state on failure.
      setUserVote(prevVote);
      setPendingDelta((d) => d - delta);
      console.warn('[ReportCard] vote failed:', err instanceof Error ? err.message : err);
    } finally {
      setVoting(false);
    }
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className={cn(
        'report-card group cursor-pointer rounded-2xl border border-border bg-card p-4 md:p-5',
        'hover:border-slate-600/70',
        compact && 'p-3 md:p-4'
      )}
      onClick={() => onViewFull?.(report)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {showGame && report.game?.coverImage && <GameCoverThumb game={report.game} />}
          <div className="min-w-0 flex-1">
          {showGame && (report.gameName || report.game?.name) && (
            <div className="mb-1 truncate text-xs font-semibold uppercase text-primary">
              {report.gameName || report.game?.name}
            </div>
          )}
          <div className="flex flex-col gap-1 text-sm">
            {/* Full hardware names (e.g. "NVIDIA GeForce RTX 4070", "AMD Ryzen 7 5700X3D") —
                stacked on their own lines so the entire name is shown, not just the model. */}
            <div className="flex items-start gap-1.5 font-medium text-foreground">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              <span className="break-words">{gpuName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
              <div className="flex items-start gap-1.5">
                <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{cpuName}</span>
              </div>
              <span className="inline-flex items-center rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {report.ram} GB
              </span>
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
            <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Monitor className="h-3 w-3" />
              {report.resolution}
              {report.refreshRate && ` @ ${report.refreshRate}Hz`}
            </div>
            <span className="rounded-md border border-border bg-background/60 px-2 py-0.5 text-xs font-medium">
              {report.settingsPreset}
              {report.customSettingsNotes && <span className="ml-1 text-[10px] text-muted-foreground">(custom)</span>}
            </span>
          </div>
          </div>
        </div>

        <PerformanceBadge tier={report.performanceTier} size={compact ? 'sm' : 'md'} />
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-semibold tabular-nums text-foreground md:text-4xl">
            {report.avgFps}
          </span>
          <span className="text-sm font-medium text-muted-foreground">FPS</span>
        </div>
        {report.fps1PercentLow && (
          <div className="text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">{report.fps1PercentLow}</span>
            <span className="ml-0.5 text-xs">1% low</span>
          </div>
        )}
      </div>

      {(report.notes || report.tweaks) && (
        <div className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground">
          {report.tweaks || report.notes}
        </div>
      )}

      {(breakdown || isSimilar) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            <Zap className="h-3 w-3" /> {breakdown ? breakdown.score : similarity}% match
          </span>
          {breakdown && (
            <>
              <MatchChip label="GPU" level={breakdown.gpu} />
              <MatchChip label="CPU" level={breakdown.cpu} />
              <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {report.ram}GB{breakdown.ram === 'exact' ? ' ok' : ''}
              </span>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>{formatRelativeTime(report.createdAt)}</span>
          {report.reporter?.username && (
            <span className="text-muted-foreground/70">
              · by {report.reporter.username}
              {report.reporter.credibilityBadge && report.reporter.credibilityBadge !== 'New' ? ` · ${report.reporter.credibilityBadge}` : ''}
            </span>
          )}
          <div className="inline-flex items-center overflow-hidden rounded-full border border-border bg-background/60">
            <motion.button
              onClick={(e) => handleVote(1, e)}
              disabled={voting}
              aria-disabled={!canVote}
              whileTap={{ scale: 0.82 }}
              className={cn(
                'relative grid h-6 w-7 place-items-center transition hover:bg-muted hover:text-foreground disabled:opacity-60',
                !canVote && 'opacity-50 hover:bg-transparent hover:text-muted-foreground',
                userVote === 1 && 'text-emerald-400'
              )}
              title={!canVote ? 'Sign in to upvote reports' : userVote === 1 ? 'Remove your upvote' : 'Upvote report credibility'}
              aria-pressed={userVote === 1}
            >
              <AnimatePresence>
                {userVote === 1 && (
                  <motion.span
                    key="up-burst"
                    initial={{ scale: 0, opacity: 0.55 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 rounded-full bg-emerald-400/40"
                  />
                )}
              </AnimatePresence>
              <motion.span
                animate={userVote === 1 ? { scale: [1, 1.45, 1], y: [0, -2, 0] } : { scale: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="relative grid place-items-center"
              >
                <ArrowBigUp className={cn('h-4 w-4', userVote === 1 && 'fill-current')} />
              </motion.span>
            </motion.button>
            <span className="relative grid min-w-8 place-items-center overflow-hidden border-x border-border px-1 font-mono tabular-nums text-foreground">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={displayedScore}
                  initial={{ y: scoreDir > 0 ? 12 : -12, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: scoreDir > 0 ? -12 : 12, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 550, damping: 32 }}
                  className={cn(
                    'block',
                    userVote === 1 && 'text-emerald-400',
                    userVote === -1 && 'text-rose-400'
                  )}
                >
                  {displayedScore}
                </motion.span>
              </AnimatePresence>
            </span>
            <motion.button
              onClick={(e) => handleVote(-1, e)}
              disabled={voting}
              aria-disabled={!canVote}
              whileTap={{ scale: 0.82 }}
              className={cn(
                'relative grid h-6 w-7 place-items-center transition hover:bg-muted hover:text-foreground disabled:opacity-60',
                !canVote && 'opacity-50 hover:bg-transparent hover:text-muted-foreground',
                userVote === -1 && 'text-rose-400'
              )}
              title={!canVote ? 'Sign in to downvote reports' : userVote === -1 ? 'Remove your downvote' : 'Downvote report credibility'}
              aria-pressed={userVote === -1}
            >
              <AnimatePresence>
                {userVote === -1 && (
                  <motion.span
                    key="down-burst"
                    initial={{ scale: 0, opacity: 0.55 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 rounded-full bg-rose-400/40"
                  />
                )}
              </AnimatePresence>
              <motion.span
                animate={userVote === -1 ? { scale: [1, 1.45, 1], y: [0, 2, 0] } : { scale: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="relative grid place-items-center"
              >
                <ArrowBigDown className={cn('h-4 w-4', userVote === -1 && 'fill-current')} />
              </motion.span>
            </motion.button>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> {reportBadge}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasDetails && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Less' : 'Details'}
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground">View full</span>
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
          {report.tweaks && (
            <div>
              <span className="font-medium text-muted-foreground">Tweaks:</span> {report.tweaks}
              <button
                onClick={(e) => handleCopy(report.tweaks!, e)}
                className="ml-1 rounded p-0.5 text-muted-foreground transition hover:bg-accent/70 hover:text-foreground"
                title="Copy tweaks"
              >
                <Copy className="inline h-3 w-3" />
              </button>
            </div>
          )}
          {report.driverVersion && (
            <div>
              <span className="font-medium text-muted-foreground">Driver:</span> {report.driverVersion}
            </div>
          )}
          {report.kernel && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Kernel:</span> {report.kernel}
            </div>
          )}
          {report.distro && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Distro:</span> {report.distro}
            </div>
          )}
          {report.issues && (
            <div className="text-amber-400">
              <span className="font-medium">Issues:</span> {report.issues}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Small portrait box-art thumbnail shown beside the game name when `showGame` is set
// (e.g. the "Will It Run?" match feed). Falls back to a name chip if the cover fails to load.
function GameCoverThumb({ game }: { game: Game }) {
  const [imgError, setImgError] = useState(false);
  const coverSrc = upgradeCoverImageSrc(game.coverImage, game.steamAppId);

  if (imgError || !game.coverImage) {
    return (
      <div className="grid h-24 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted px-1 text-center text-[9px] font-mono font-medium uppercase leading-tight tracking-wide text-muted-foreground/70">
        {game.name}
      </div>
    );
  }

  return (
    <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
      <Image
        loader={gameMediaLoader}
        src={coverSrc}
        alt={game.name}
        fill
        sizes="64px"
        className="object-cover object-top"
        onError={() => setImgError(true)}
      />
    </div>
  );
}

function MatchChip({ label, level }: { label: string; level: 'exact' | 'close' | 'far' }) {
  const styles: Record<typeof level, string> = {
    exact: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
    close: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
    far: 'border-border bg-muted/40 text-muted-foreground',
  };
  const text = level === 'exact' ? 'exact' : level === 'close' ? 'close' : 'differs';

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', styles[level])}>
      {label} {text}
    </span>
  );
}
