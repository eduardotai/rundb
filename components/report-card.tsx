'use client';

import { useState } from 'react';
import { Report, UserPC } from '@/lib/types';
import { PerformanceBadge } from './performance-badge';
import { formatRelativeTime, calculateHardwareAwareSimilarity as calculateSimilarity } from '@/lib/data';
import { cn } from '@/lib/utils';
import { Cpu, Monitor, Zap, Heart, ChevronDown, ChevronUp, Copy } from 'lucide-react';

interface ReportCardProps {
  report: Report;
  userRig?: UserPC | null;
  onHelpful?: (id: string) => void | Promise<void>;
  onViewFull?: (report: Report) => void;
  compact?: boolean;
}

export function ReportCard({ report, userRig, onHelpful, onViewFull, compact = false }: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [voted, setVoted] = useState(false);
  const [voting, setVoting] = useState(false); // Phase 2: supports async real upvote (rate limit / dup friendly)

  const similarity = userRig ? calculateSimilarity(report, userRig) : 0;
  const isSimilar = similarity > 65;

  const handleHelpful = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (voted || voting) return;
    setVoting(true);
    try {
      const maybePromise = onHelpful?.(report.id);
      if (maybePromise instanceof Promise) {
        await maybePromise;
      }
      setVoted(true);
    } catch (err: any) {
      // Real mode errors (already voted, auth, rate etc) — keep UI clean
      console.warn('[ReportCard] upvote failed (may be duplicate or auth):', err?.message || err);
      // Do not set voted on error
    } finally {
      setVoting(false);
    }
  };

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
  };

  const hasDetails = !!(report.tweaks || report.issues || report.driverVersion || report.notes || (report as any).kernel || (report as any).distro);

  return (
    <div
      className={cn(
        'report-card group cursor-pointer rounded-2xl border border-border bg-card p-4 md:p-5',
        'hover:border-slate-600/70',
        compact && 'p-3 md:p-4'
      )}
      onClick={() => onViewFull?.(report)}
    >
      {/* Header row — hardware + tier */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Zap className="h-3.5 w-3.5 text-cyan-400" />
              <span className="truncate">{report.gpu}</span>
            </div>
            <span className="hidden text-muted-foreground/40 md:inline">•</span>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              <span className="truncate">{report.cpu}</span>
            </div>
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
              {report.ram} GB
            </span>
          </div>

          {/* Resolution + preset */}
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

        <PerformanceBadge tier={report.performanceTier} size={compact ? 'sm' : 'md'} />
      </div>

      {/* Hero FPS numbers */}
      <div className="mt-3 flex items-baseline gap-3">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-semibold tabular-nums tracking-tighter text-foreground md:text-4xl">
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

      {/* Notes / tweaks snippet */}
      {(report.notes || report.tweaks) && (
        <div className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground">
          {report.tweaks || report.notes}
        </div>
      )}

      {/* Similarity indicator (when My Rig is saved) */}
      {isSimilar && (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
          <Zap className="h-3 w-3" /> {similarity}% match to your rig
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{formatRelativeTime(report.createdAt)}</span>

          <button
            onClick={handleHelpful}
            disabled={voted || voting}
            className={cn(
              'flex items-center gap-1 transition hover:text-foreground disabled:opacity-60',
              voted && 'text-rose-400'
            )}
            title={voting ? 'Recording upvote...' : voted ? 'Thanks for the upvote!' : 'Upvote this report (real mode uses report_votes table)'}
          >
            <Heart className={cn('h-3.5 w-3.5', (voted || voting) && 'fill-current')} />
            <span>{report.helpfulVotes + (voted ? 1 : 0)}{voting ? '…' : ''}</span>
          </button>
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
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground">View full →</span>
        </div>
      </div>

      {/* Expanded details (lightweight) */}
      {expanded && hasDetails && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-muted/40 p-3 text-sm">
          {report.tweaks && (
            <div>
              <span className="font-medium text-muted-foreground">Tweaks:</span>{' '}
              {report.tweaks}
              <button 
                onClick={(e) => handleCopy(report.tweaks!, e)} 
                className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent/70 hover:text-foreground transition"
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
          {(report as any).kernel && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Kernel:</span> {(report as any).kernel}
            </div>
          )}
          {(report as any).distro && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Distro:</span> {(report as any).distro}
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
