'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Game, Report, UserPC } from '@/lib/types';
import type { MatchBreakdown, HardwareTransfer } from '@/lib/similarity';
import { shouldDisplayTransfer } from '@/lib/similarity';
import { PerformanceBadge } from './performance-badge';
import { formatRelativeTime, calculateHardwareAwareSimilarity as calculateSimilarity } from '@/lib/data';
import { normalizeHardwareSync } from '@/lib/normalize-hardware';
import { GameCoverFrame } from '@/components/game-cover-frame';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowBigDown,
  ArrowBigUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Monitor,
  ShieldCheck,
  User,
  Zap,
} from 'lucide-react';
import { showUserError } from '@/lib/toast';

/** Public display name for a report author. Always returns a non-empty label. */
export function reporterNickname(report: Report): string {
  const name = report.reporter?.username?.trim();
  if (name) return name;
  return 'Anonymous';
}

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
  transfer?: HardwareTransfer | null;
  /** When true, show unknown-transfer chip (“Can’t compare…”) */
  looserMode?: boolean;
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
  transfer,
  looserMode = false,
}: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
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
  const nickname = reporterNickname(report);
  const reporterBadge = report.reporter?.credibilityBadge;

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

  const openFull = () => {
    if (onViewFull) {
      onViewFull(report);
      return;
    }
    setFullOpen(true);
  };

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
      showUserError(err instanceof Error && err.message ? err.message : 'Could not register your vote. Please try again.');
    } finally {
      setVoting(false);
    }
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
  };

  return (
    <>
    <div
      className={cn(
        'report-card theme-card group cursor-pointer p-4 md:p-5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'active:scale-[0.995] motion-reduce:active:scale-100',
        'tier-accent',
        `tier-accent-${report.performanceTier.toLowerCase()}`,
        compact && 'p-3 md:p-4'
      )}
      onClick={openFull}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFull();
        }
      }}
    >
      <div className="flex gap-4 sm:gap-5">
        {/* Numbers first: average FPS + 1% low */}
        <div className={cn('flex shrink-0 flex-col', compact ? 'w-[4.5rem]' : 'w-[4.75rem] sm:w-24')}>
          <span
            className={cn(
              'font-mono font-semibold leading-none tabular-nums tracking-tight text-foreground',
              compact ? 'text-3xl' : 'text-4xl'
            )}
          >
            {report.avgFps}
          </span>
          <span className="mt-1.5 text-xs font-medium text-muted-foreground">avg FPS</span>
          {report.fps1PercentLow ? (
            <span className="mt-2 text-xs text-muted-foreground">
              <span className="font-mono font-medium tabular-nums text-foreground">{report.fps1PercentLow}</span> 1% low
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 border-l border-border pl-4 sm:pl-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {showGame && report.game?.coverImage && <GameCoverThumb game={report.game} />}
              <div className="min-w-0">
                {showGame && (report.gameName || report.game?.name) && (
                  <div className="mb-0.5 truncate text-sm font-semibold text-foreground">
                    {report.gameName || report.game?.name}
                  </div>
                )}
                <div className="flex items-start gap-1.5 font-medium leading-snug text-foreground">
                  <Zap className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="break-words">{gpuName}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-start gap-x-1.5 text-sm text-muted-foreground">
                  <Cpu className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="break-words">{cpuName}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{report.ram} GB</span>
                </div>
              </div>
            </div>
            <PerformanceBadge tier={report.performanceTier} size="sm" className="shrink-0" />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium text-foreground/80">
              <Monitor className="h-3 w-3" aria-hidden />
              {report.resolution}
              {report.refreshRate && ` @ ${report.refreshRate}Hz`}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground/80">
              {report.settingsPreset}
              {report.customSettingsNotes && <span className="ml-1 text-muted-foreground">(custom)</span>}
            </span>
            {/* Reporter nickname is always visible — required attribution on every report card. */}
            <span className="inline-flex items-center gap-1 px-1 text-muted-foreground">
              <User className="h-3 w-3" aria-hidden />
              <span className="font-medium text-foreground/80">{nickname}</span>
              {reporterBadge && reporterBadge !== 'New' && (
                <span className="rounded-full border border-border px-1.5 text-[10px] font-semibold">{reporterBadge}</span>
              )}
            </span>
          </div>

          {(report.notes || report.tweaks) && (
            <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {report.tweaks || report.notes}
            </p>
          )}
        </div>
      </div>

      {(breakdown || isSimilar) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
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

      {transfer && (
        <TransferRow transfer={transfer} looserMode={looserMode} />
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>{formatRelativeTime(report.createdAt)}</span>
          <div className="inline-flex items-center overflow-hidden rounded-full border border-border bg-card">
            <motion.button
              onClick={(e) => handleVote(1, e)}
              disabled={voting}
              aria-disabled={!canVote}
              whileTap={{ scale: 0.82 }}
              className={cn(
                'relative grid h-6 w-7 place-items-center transition hover:bg-muted hover:text-foreground disabled:opacity-60',
                !canVote && 'opacity-50 hover:bg-transparent hover:text-muted-foreground',
                userVote === 1 && 'text-success'
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
                    className="pointer-events-none absolute inset-0 rounded-full bg-success/40"
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
                    userVote === 1 && 'text-success',
                    userVote === -1 && 'text-destructive'
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
                userVote === -1 && 'text-destructive'
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
                    className="pointer-events-none absolute inset-0 rounded-full bg-destructive/40"
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
              type="button"
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFull();
            }}
            className="text-[10px] font-medium text-muted-foreground/70 transition group-hover:text-foreground hover:text-foreground hover:underline"
          >
            View full
          </button>
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-muted/60 p-3 text-sm">
          {report.tweaks && (
            <div>
              <span className="font-medium text-muted-foreground">Tweaks:</span> {report.tweaks}
              <button
                type="button"
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
            <div className="text-warning">
              <span className="font-medium">Issues:</span> {report.issues}
            </div>
          )}
        </div>
      )}
    </div>

    <FullReportDialog
      report={report}
      open={fullOpen}
      onOpenChange={setFullOpen}
      gpuName={gpuName}
      cpuName={cpuName}
      nickname={nickname}
      reportBadge={reportBadge}
    />
    </>
  );
}

function FullReportDialog({
  report,
  open,
  onOpenChange,
  gpuName,
  cpuName,
  nickname,
  reportBadge,
}: {
  report: Report;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gpuName: string;
  cpuName: string;
  nickname: string;
  reportBadge: string;
}) {
  const rows: { label: string; value: string }[] = [
    { label: 'Reported by', value: nickname },
    { label: 'GPU', value: gpuName },
    { label: 'CPU', value: cpuName },
    { label: 'RAM', value: `${report.ram} GB${report.ramSpeed ? ` · ${report.ramSpeed}` : ''}` },
    {
      label: 'Display',
      value: `${report.resolution}${report.refreshRate ? ` @ ${report.refreshRate}Hz` : ''}`,
    },
    {
      label: 'Settings',
      value: `${report.settingsPreset}${report.customSettingsNotes ? ` — ${report.customSettingsNotes}` : ''}`,
    },
    {
      label: 'FPS',
      value: `${report.avgFps} avg${report.fps1PercentLow != null ? ` · ${report.fps1PercentLow} 1% low` : ''}`,
    },
    { label: 'Tier', value: report.performanceTier },
    ...(report.driverVersion ? [{ label: 'Driver', value: report.driverVersion }] : []),
    ...(report.kernel ? [{ label: 'Kernel', value: report.kernel }] : []),
    ...(report.distro ? [{ label: 'Distro', value: report.distro }] : []),
    ...(report.tweaks ? [{ label: 'Tweaks', value: report.tweaks }] : []),
    ...(report.issues ? [{ label: 'Issues', value: report.issues }] : []),
    ...(report.notes ? [{ label: 'Notes', value: report.notes }] : []),
    { label: 'Submitted', value: formatRelativeTime(report.createdAt) },
    {
      label: 'Score',
      value: `${report.voteScore ?? report.helpfulVotes ?? 0} · ${reportBadge}`,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {report.gameName || report.game?.name || 'Performance report'}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <User className="h-3.5 w-3.5 text-primary" />
              by {nickname}
            </span>
            {report.reporter?.credibilityBadge && report.reporter.credibilityBadge !== 'New' && (
              <span className="text-xs text-muted-foreground">· {report.reporter.credibilityBadge}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <PerformanceBadge tier={report.performanceTier} size="md" />
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-3xl font-semibold tabular-nums">{report.avgFps}</span>
            <span className="text-sm text-muted-foreground">FPS</span>
          </div>
        </div>

        <dl className="space-y-2.5 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[7rem_1fr] gap-2 sm:grid-cols-[8.5rem_1fr]">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
              <dd className="break-words text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

// Small portrait box-art thumbnail shown beside the game name when `showGame` is set
// (e.g. the "Will It Run?" match feed). Falls back to a name chip if the cover fails to load.
function GameCoverThumb({ game }: { game: Game }) {
  const [imgError, setImgError] = useState(false);

  if (imgError || !game.coverImage) {
    return (
      <div className="grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted px-1 text-center text-[8px] font-mono font-medium uppercase leading-tight tracking-wide text-muted-foreground/70">
        {game.name}
      </div>
    );
  }

  return (
    <GameCoverFrame
      src={game.coverImage}
      alt={game.name}
      steamAppId={game.steamAppId}
      className="h-14 w-10 shrink-0 rounded-md border border-border"
      sizes="64px"
      blurBackdrop={false}
      onError={() => setImgError(true)}
    />
  );
}

function MatchChip({ label, level }: { label: string; level: 'exact' | 'close' | 'far' }) {
  const styles: Record<typeof level, string> = {
    exact: 'border-success/20 bg-success/10 text-success',
    close: 'border-warning/20 bg-warning/10 text-warning',
    far: 'border-border bg-muted/40 text-muted-foreground',
  };
  const text = level === 'exact' ? 'exact' : level === 'close' ? 'close' : 'differs';

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', styles[level])}>
      {label} {text}
    </span>
  );
}

function transferDirectionLabel(t: HardwareTransfer): string {
  switch (t.direction) {
    case 'higher':
      if (t.magnitude === 'slight') return 'Slightly higher expected';
      if (t.magnitude === 'large') return 'Much higher class of hardware';
      return 'Likely higher for your rig';
    case 'lower':
      if (t.magnitude === 'slight') return 'Slightly lower expected';
      if (t.magnitude === 'large') return 'Much lower class of hardware';
      return 'Likely lower for your rig';
    case 'similar':
      return 'About the same';
    case 'unknown':
    default:
      return 'Can’t compare hardware power';
  }
}

function TransferRow({
  transfer,
  looserMode,
}: {
  transfer: HardwareTransfer;
  looserMode: boolean;
}) {
  if (!shouldDisplayTransfer(transfer, { looserMode })) return null;

  const gap =
    transfer.gpuRelPercent != null
      ? `GPU ${transfer.gpuRelPercent > 0 ? '+' : ''}${transfer.gpuRelPercent}% vs reporter`
      : null;

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      title="Based on catalog GPU performance indexes. Games vary; this is not a measured result for your PC."
    >
      <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        For your rig: {transferDirectionLabel(transfer)}
      </span>
      {gap && (
        <span className="rounded-full border border-border/80 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground/90">
          {gap}
        </span>
      )}
      {!transfer.settingsComparable && transfer.direction !== 'unknown' && (
        <span className="rounded-full border border-warning/20 bg-warning/5 px-2 py-0.5 text-[10px] text-warning/80">
          Different resolution — not same-settings
        </span>
      )}
    </div>
  );
}
