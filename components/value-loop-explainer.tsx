'use client';

import { Cpu, BarChart3, Users, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ValueLoopExplainerProps {
  variant?: 'prominent' | 'compact';
}

export function ValueLoopExplainer({ variant = 'prominent' }: ValueLoopExplainerProps) {
  const steps = [
    {
      icon: Cpu,
      title: 'Save your rig once',
      desc: 'Enter (or auto-detect via browser/paste) your CPU, GPU, RAM, and resolution. Rich fields improve similarity.',
    },
    {
      icon: BarChart3,
      title: 'See real predictions & stats',
      desc: 'Browse games or use the compatibility checker. View tier distributions, avg FPS, and similar-hardware reports.',
    },
    {
      icon: Users,
      title: 'Read the community',
      desc: 'ReportCards show hardware + settings + FPS (avg + 1% low) + tier + tweaks + "similar to your rig" highlights.',
    },
    {
      icon: Plus,
      title: 'Contribute back',
      desc: 'Submit your results (<1 min form). Reports enter moderation, then improve public stats after approval.',
    },
  ];

  const isProminent = variant === 'prominent';

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card',
        isProminent ? 'p-6' : 'p-4'
      )}
    >
      {isProminent && (
        <div className="mb-4 text-sm font-medium text-muted-foreground">
          The closed loop that makes predictions better for everyone
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={index} className="relative flex gap-3">
              <div className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/5">
                <Icon className="h-4 w-4 text-primary" />
                <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-primary font-mono text-[9px] font-bold leading-none text-primary-foreground">
                  {index + 1}
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-semibold tracking-tight">{step.title}</div>
                <p className="text-xs leading-snug text-muted-foreground">{step.desc}</p>
              </div>
              {/* Connector arrow between steps on wide layout */}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="absolute -right-3 top-2 hidden text-muted-foreground/40 lg:block">
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isProminent && (
        <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground/80">
          More good reports = smarter compatibility for you and the community.
        </div>
      )}
    </div>
  );
}
