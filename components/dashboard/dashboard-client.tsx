'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  GitCommit, FileText, Map as MapIcon, LayoutDashboard, Search, ChevronRight,
  GitBranch, CircleDot, ExternalLink, Plus, Minus, FileCode2, Loader2, Layers,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  DashboardData, PlanDoc, CommitInfo, AppRoute, PlanCategory,
} from '@/lib/server/dashboard';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<PlanCategory, string> = {
  hardware: 'Hardware',
  phase7: 'Phase 7',
  presentation: 'Presentation',
  'color-visual': 'Color / Visual',
  superpowers: 'Superpowers',
  archive: 'Archive',
  root: 'Project',
  other: 'Other',
};

function typeClass(t: string) {
  return `dt-${['feat', 'fix', 'docs', 'chore', 'refactor', 'merge'].includes(t) ? t : 'other'}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function DashboardClient({ data, defaultTab = 'overview' }: { data: DashboardData; defaultTab?: string }) {
  const { plans, commits, routes, status } = data;

  return (
    <div className="dash">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        {/* Header */}
        <header className="dash-in flex flex-col gap-5 border-b border-[var(--hair)] pb-7">
          <div className="flex items-center gap-3">
            <span className="dash-rec" aria-hidden />
            <span className="dash-eyebrow">REC · Build Telemetry</span>
            <span className="dash-eyebrow text-[var(--ink-faint)]">/dashboard</span>
          </div>
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="dash-title text-4xl md:text-5xl">Build Dashboard</h1>
              <p className="mt-2 max-w-xl text-sm text-[var(--ink-dim)]">
                Every plan, commit, and surface of RunDB in one console — rendered, not read.
              </p>
            </div>
            <TelemetryStrip status={status} gitAvailable={data.gitAvailable} />
          </div>
        </header>

        <Tabs defaultValue={defaultTab} className="mt-8">
          <TabsList className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
            <TabsTrigger value="overview" className="dash-tab data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <LayoutDashboard className="mr-2 h-3.5 w-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="plans" className="dash-tab data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <FileText className="mr-2 h-3.5 w-3.5" /> Plans · {plans.length}
            </TabsTrigger>
            <TabsTrigger value="commits" className="dash-tab data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <GitCommit className="mr-2 h-3.5 w-3.5" /> Commits · {commits.length}
            </TabsTrigger>
            <TabsTrigger value="sitemap" className="dash-tab data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              <MapIcon className="mr-2 h-3.5 w-3.5" /> Site Map · {routes.filter((r) => r.kind === 'page').length}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6"><OverviewTab data={data} /></TabsContent>
          <TabsContent value="plans" className="mt-6"><PlansTab plans={plans} /></TabsContent>
          <TabsContent value="commits" className="mt-6"><CommitsTab commits={commits} /></TabsContent>
          <TabsContent value="sitemap" className="mt-6"><SiteMapTab routes={routes} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telemetry strip (header right)
// ---------------------------------------------------------------------------

function TelemetryStrip({ status, gitAvailable }: { status: DashboardData['status']; gitAvailable: boolean }) {
  return (
    <div className="dash-panel dash-panel-pad flex items-center gap-5 dash-mono text-xs">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-[var(--phosphor-dim)]" />
        <span className="text-[var(--ink)]">{status.branch}</span>
      </div>
      <div className="h-4 w-px bg-[var(--hair)]" />
      <div className="flex items-center gap-2" title={status.clean ? 'working tree clean' : `${status.dirtyCount} uncommitted change(s)`}>
        <CircleDot className={cn('h-3.5 w-3.5', status.clean ? 'text-emerald-400' : 'text-amber-400')} />
        <span className="text-[var(--ink-dim)]">{status.clean ? 'clean' : `${status.dirtyCount} dirty`}</span>
      </div>
      <div className="h-4 w-px bg-[var(--hair)]" />
      <span className="text-[var(--ink-dim)]">{gitAvailable ? `${status.totalCommits} commits` : 'git n/a'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, glow, delay }: { label: string; value: string | number; sub?: string; glow?: boolean; delay: number }) {
  return (
    <div className="dash-panel dash-panel-pad dash-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="dash-eyebrow text-[0.6rem] text-[var(--ink-faint)]">{label}</div>
      <div className={cn('dash-stat-value mt-2 text-3xl', glow && 'dash-glow')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--ink-dim)]">{sub}</div>}
    </div>
  );
}

function OverviewTab({ data }: { data: DashboardData }) {
  const { status, commits, plans } = data;
  const recent = commits.slice(0, 8);
  const catEntries = Object.entries(status.plansByCategory).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Commits" value={status.totalCommits} sub={status.lastCommitDate ? `last ${status.lastCommitDate}` : undefined} glow delay={0} />
        <StatCard label="Plans & Specs" value={status.counts.plans} sub={`${catEntries.length} categories`} delay={60} />
        <StatCard label="App Routes" value={status.counts.routes} sub={`${status.counts.pages} pages`} delay={120} />
        <StatCard label="Components" value={status.counts.components} sub={`${status.contributors} contributors`} delay={180} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Latest activity */}
        <section className="dash-panel dash-panel-pad dash-in lg:col-span-3" style={{ animationDelay: '220ms' }}>
          <h2 className="dash-eyebrow mb-4 text-[var(--phosphor-dim)]">Latest Activity</h2>
          <div className="dash-rail space-y-3 pl-6">
            {recent.map((c) => (
              <div key={c.hash} className="relative">
                <span className="dash-node" style={{ top: 5 }} />
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className={cn('dash-type mr-2', typeClass(c.type))}>{c.scope ? `${c.type}(${c.scope})` : c.type}</span>
                    <span className="text-sm text-[var(--ink)]">{c.subject.replace(/^\w+(\([^)]+\))?!?:\s*/, '')}</span>
                  </div>
                  <span className="dash-mono shrink-0 text-xs text-[var(--ink-faint)]">{c.relDate}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Plan categories + tech */}
        <div className="space-y-5 lg:col-span-2">
          <section className="dash-panel dash-panel-pad dash-in" style={{ animationDelay: '260ms' }}>
            <h2 className="dash-eyebrow mb-4 text-[var(--phosphor-dim)]">Plans by Category</h2>
            <div className="space-y-2.5">
              {catEntries.map(([cat, n]) => {
                const pct = Math.round((n / plans.length) * 100);
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--ink-dim)]">{CATEGORY_LABEL[cat as PlanCategory] ?? cat}</span>
                      <span className="dash-mono text-[var(--ink-faint)]">{n}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(148,163,184,0.1)]">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--phosphor-dim),var(--phosphor))]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="dash-panel dash-panel-pad dash-in" style={{ animationDelay: '300ms' }}>
            <h2 className="dash-eyebrow mb-3 text-[var(--phosphor-dim)]">Stack</h2>
            <div className="flex flex-wrap gap-2">
              {status.tech.map((t) => (
                <span key={t} className="dash-chip">{t}</span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function PlansTab({ plans }: { plans: PlanDoc[] }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<PlanCategory | 'all'>('all');
  const [activeId, setActiveId] = useState<string>(plans[0]?.id ?? '');

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    for (const p of plans) set.set(p.category, (set.get(p.category) ?? 0) + 1);
    return Array.from(set.entries()).sort((a, b) => b[1] - a[1]);
  }, [plans]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plans.filter(
      (p) =>
        (cat === 'all' || p.category === cat) &&
        (!q || p.title.toLowerCase().includes(q) || p.fileName.toLowerCase().includes(q))
    );
  }, [plans, query, cat]);

  const active = plans.find((p) => p.id === activeId) ?? filtered[0] ?? plans[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      {/* List column */}
      <div className="dash-in space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plans…"
            className="dash-mono w-full rounded-lg border border-[var(--hair)] bg-[var(--panel-2)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--phosphor-dim)]"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button className="dash-chip" data-active={cat === 'all'} onClick={() => setCat('all')}>all · {plans.length}</button>
          {categories.map(([c, n]) => (
            <button key={c} className="dash-chip" data-active={cat === c} onClick={() => setCat(c as PlanCategory)}>
              {CATEGORY_LABEL[c as PlanCategory] ?? c} · {n}
            </button>
          ))}
        </div>

        <div className="max-h-[68vh] space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={cn(
                'group flex w-full flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition',
                p.id === active?.id
                  ? 'border-[rgba(103,232,249,0.4)] bg-[rgba(103,232,249,0.06)]'
                  : 'border-[var(--hair)] bg-[var(--panel-2)] hover:border-[var(--hair-strong)]'
              )}
            >
              <span className="line-clamp-2 text-sm font-medium text-[var(--ink)]">{p.title}</span>
              <span className="dash-mono flex items-center gap-2 text-[0.68rem] text-[var(--ink-faint)]">
                <span className="text-[var(--phosphor-dim)]">{CATEGORY_LABEL[p.category] ?? p.category}</span>
                · {p.sizeKb}KB · {p.words.toLocaleString()}w
                {p.status && <span className="truncate text-emerald-400/80">· {p.status}</span>}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-[var(--ink-faint)]">No plans match.</p>
          )}
        </div>
      </div>

      {/* Reading pane */}
      <article className="dash-panel dash-in min-h-[60vh] overflow-hidden">
        {active ? (
          <>
            <div className="flex flex-col gap-2 border-b border-[var(--hair)] px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="dash-chip" data-active="true">{CATEGORY_LABEL[active.category] ?? active.category}</span>
                {active.status && <span className="dash-chip text-emerald-400">{active.status}</span>}
                <span className="dash-mono ml-auto text-xs text-[var(--ink-faint)]">{active.path}</span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">{active.title}</h2>
              <p className="dash-mono text-xs text-[var(--ink-faint)]">
                updated {fmtDate(active.mtime)} · {active.sizeKb}KB · {active.words.toLocaleString()} words
              </p>
            </div>
            <div className="md-prose max-h-[64vh] overflow-y-auto px-6 py-6" dangerouslySetInnerHTML={{ __html: active.html }} />
          </>
        ) : (
          <p className="p-12 text-center text-[var(--ink-faint)]">No plan documents found.</p>
        )}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

const COMMIT_TYPES = ['all', 'feat', 'fix', 'docs', 'chore', 'refactor', 'merge'] as const;

function CommitsTab({ commits }: { commits: CommitInfo[] }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commits.filter(
      (c) =>
        (type === 'all' || c.type === type) &&
        (!q || c.subject.toLowerCase().includes(q) || c.body.toLowerCase().includes(q) || c.shortHash.includes(q))
    );
  }, [commits, query, type]);

  // Group by date for the rail.
  const groups = useMemo(() => {
    const m = new Map<string, CommitInfo[]>();
    for (const c of filtered) {
      if (!m.has(c.date)) m.set(c.date, []);
      m.get(c.date)!.push(c);
    }
    return Array.from(m.entries());
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="dash-in flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commits…"
            className="dash-mono w-full rounded-lg border border-[var(--hair)] bg-[var(--panel-2)] py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)] focus:border-[var(--phosphor-dim)]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMMIT_TYPES.map((t) => (
            <button key={t} className="dash-chip" data-active={type === t} onClick={() => setType(t)}>{t}</button>
          ))}
        </div>
        <span className="dash-mono text-xs text-[var(--ink-faint)] md:ml-auto">{filtered.length} shown</span>
      </div>

      <div className="space-y-7">
        {groups.map(([date, list]) => (
          <div key={date} className="dash-in">
            <div className="mb-3 flex items-center gap-3">
              <span className="dash-mono text-xs uppercase tracking-wider text-[var(--phosphor-dim)]">{fmtDate(list[0].date)}</span>
              <div className="h-px flex-1 bg-[var(--hair)]" />
              <span className="dash-mono text-xs text-[var(--ink-faint)]">{list.length}</span>
            </div>
            <div className="dash-rail space-y-2.5 pl-6">
              {list.map((c) => <CommitRow key={c.hash} commit={c} />)}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--ink-faint)]">No commits match.</p>
        )}
      </div>
    </div>
  );
}

function CommitRow({ commit }: { commit: CommitInfo }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<{ diff: string; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !diff && !loading) {
      setLoading(true);
      setErr(false);
      try {
        const res = await fetch(`/dashboard/diff?hash=${commit.hash}`);
        if (!res.ok) throw new Error('bad');
        setDiff(await res.json());
      } catch {
        setErr(true);
      } finally {
        setLoading(false);
      }
    }
  }, [open, diff, loading, commit.hash]);

  const cleanSubject = commit.subject.replace(/^\w+(\([^)]+\))?!?:\s*/, '');

  return (
    <div className="relative">
      <span className="dash-node" style={{ top: 14 }} />
      <div className={cn('dash-panel overflow-hidden transition', open && 'border-[rgba(103,232,249,0.35)]')}>
        <button onClick={toggle} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[rgba(148,163,184,0.04)]">
          <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-faint)] transition-transform', open && 'rotate-90')} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('dash-type', typeClass(commit.type))}>{commit.scope ? `${commit.type}(${commit.scope})` : commit.type}</span>
              <span className="text-sm font-medium text-[var(--ink)]">{cleanSubject}</span>
            </div>
            <div className="dash-mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-[var(--ink-faint)]">
              <span className="text-[var(--phosphor-dim)]">{commit.shortHash}</span>
              <span>{commit.author}</span>
              <span>{commit.relDate}</span>
              {commit.files.length > 0 && (
                <span className="flex items-center gap-2">
                  <FileCode2 className="h-3 w-3" />{commit.files.length}
                  {commit.added > 0 && <span className="text-emerald-400">+{commit.added}</span>}
                  {commit.removed > 0 && <span className="text-red-400">−{commit.removed}</span>}
                </span>
              )}
            </div>
          </div>
        </button>

        {open && (
          <div className="border-t border-[var(--hair)] px-4 py-4">
            {commit.body && (
              <pre className="dash-mono mb-3 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-dim)]">{commit.body}</pre>
            )}
            {commit.files.length > 0 && (
              <div className="mb-3 space-y-1">
                {commit.files.map((f) => (
                  <div key={f.path} className="dash-mono flex items-center gap-2 text-xs">
                    <span className="flex w-16 shrink-0 items-center justify-end gap-1.5">
                      {f.added >= 0 && <span className="text-emerald-400"><Plus className="inline h-2.5 w-2.5" />{f.added}</span>}
                      {f.removed > 0 && <span className="text-red-400"><Minus className="inline h-2.5 w-2.5" />{f.removed}</span>}
                    </span>
                    <span className="truncate text-[var(--ink-dim)]">{f.path}</span>
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 py-3 text-xs text-[var(--ink-faint)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading diff…
              </div>
            )}
            {err && <p className="py-2 text-xs text-amber-400">Diff unavailable for this commit.</p>}
            {diff && <DiffView diff={diff.diff} truncated={diff.truncated} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffView({ diff, truncated }: { diff: string; truncated: boolean }) {
  const lines = diff.split('\n');
  return (
    <div className="dash-diff py-2">
      {lines.map((line, i) => {
        let cls = 'diff-line';
        if (line.startsWith('@@')) cls += ' diff-hunk';
        else if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls += ' diff-meta';
        return <span key={i} className={cls}>{line || ' '}</span>;
      })}
      {truncated && <span className="diff-line diff-meta">… diff truncated (open the commit in git for the full patch)</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site Map
// ---------------------------------------------------------------------------

function SiteMapTab({ routes }: { routes: AppRoute[] }) {
  const pages = routes.filter((r) => r.kind === 'page');
  const handlers = routes.filter((r) => r.kind === 'route');

  const groups = useMemo(() => {
    const m = new Map<string, AppRoute[]>();
    for (const r of pages) {
      const key = r.segment === '(root)' ? 'home' : r.segment;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pages]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map(([segment, rs], gi) => (
          <section key={segment} className="dash-panel dash-panel-pad dash-in" style={{ animationDelay: `${gi * 50}ms` }}>
            <h2 className="dash-eyebrow mb-3 flex items-center gap-2 text-[var(--phosphor-dim)]">
              <Layers className="h-3.5 w-3.5" /> {segment}
            </h2>
            <div className="space-y-1.5">
              {rs.map((r) =>
                // Dynamic routes (e.g. /games/[slug]) aren't directly navigable and
                // a literal bracket href is unsupported in the App Router — show as a
                // non-clickable pattern row. Static routes get a real <Link>.
                r.dynamic ? (
                  <div
                    key={r.file}
                    className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--hair)] bg-[var(--panel-2)] px-3 py-2"
                  >
                    <span className="dash-mono truncate text-sm text-[var(--ink-dim)]">{r.routePath}</span>
                    <span className="dash-type dt-docs shrink-0">dynamic</span>
                  </div>
                ) : (
                  <Link
                    key={r.file}
                    href={r.routePath}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-[var(--hair)] bg-[var(--panel-2)] px-3 py-2 transition hover:border-[var(--phosphor-dim)]"
                  >
                    <span className="dash-mono truncate text-sm text-[var(--ink)]">{r.routePath}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--ink-faint)] transition group-hover:text-[var(--phosphor)]" />
                  </Link>
                )
              )}
            </div>
          </section>
        ))}
      </div>

      {handlers.length > 0 && (
        <section className="dash-panel dash-panel-pad dash-in">
          <h2 className="dash-eyebrow mb-3 text-[var(--phosphor-dim)]">Route Handlers (API)</h2>
          <div className="flex flex-wrap gap-2">
            {handlers.map((r) => (
              <span key={r.file} className="dash-chip">{r.file.replace(/^app\//, '').replace(/\/route\.tsx?$/, '')}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
