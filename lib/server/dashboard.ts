/**
 * Build Dashboard — server-only data gatherer.
 *
 * Reads the repo's plan docs, git history metadata, and app route map on each
 * request so /dashboard always reflects reality. Every git/fs call is wrapped so
 * a missing binary or file can never crash the page (matches the repo's
 * "the app never breaks" ethos). Per-commit diffs are loaded lazily by the
 * route handler at app/dashboard/diff/route.ts — not here — to keep this fast.
 *
 * `node:` imports guarantee this module never reaches the client bundle.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { marked } from 'marked';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

marked.setOptions({ gfm: true, breaks: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanCategory =
  | 'hardware'
  | 'phase7'
  | 'presentation'
  | 'color-visual'
  | 'superpowers'
  | 'archive'
  | 'root'
  | 'other';

export interface PlanDoc {
  id: string;
  path: string; // repo-relative
  fileName: string;
  title: string;
  category: PlanCategory;
  status: string | null;
  mtime: string; // ISO
  sizeKb: number;
  words: number;
  html: string; // pre-rendered markdown
}

export interface CommitFile {
  path: string;
  added: number; // -1 = binary
  removed: number;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string; // YYYY-MM-DD
  relDate: string;
  subject: string;
  body: string;
  type: string; // feat | fix | docs | chore | refactor | merge | other
  scope: string | null;
  isMerge: boolean;
  files: CommitFile[];
  added: number;
  removed: number;
}

export interface AppRoute {
  routePath: string; // URL, e.g. /games/[slug]
  kind: 'page' | 'route' | 'layout';
  file: string; // repo-relative
  segment: string; // top-level group
  dynamic: boolean;
}

export interface DashboardStatus {
  branch: string;
  totalCommits: number;
  clean: boolean;
  dirtyCount: number;
  lastCommitDate: string | null;
  contributors: number;
  counts: {
    plans: number;
    routes: number;
    pages: number;
    components: number;
  };
  plansByCategory: Record<string, number>;
  commitsByType: Record<string, number>;
  tech: string[];
  generatedAt: string;
}

export interface DashboardData {
  plans: PlanDoc[];
  commits: CommitInfo[];
  routes: AppRoute[];
  status: DashboardStatus;
  gitAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function walk(dir: string, filter: (f: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      out.push(...(await walk(full, filter)));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

function rel(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function categorize(relPath: string, fileName: string): PlanCategory {
  const p = relPath.toLowerCase();
  const f = fileName.toLowerCase();
  if (p.includes('docs/superpowers')) return 'superpowers';
  if (p.includes('docs/archive')) return 'archive';
  if (!p.includes('/')) return 'root';
  if (f.includes('phase7') || f.includes('similarity')) return 'phase7';
  if (f.includes('hardware') || f.includes('catalog') || f.includes('validation') || f.includes('master-hardware'))
    return 'hardware';
  if (f.includes('color') || f.includes('tier') || f.includes('visual') || f.includes('surface') || f.includes('guardian'))
    return 'color-visual';
  if (f.includes('presentation') || f.includes('pr-services')) return 'presentation';
  if (f.includes('phase')) return 'phase7';
  return 'other';
}

function firstHeading(md: string, fallback: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].replace(/[*_`]/g, '').trim() : fallback;
}

function parseStatus(md: string): string | null {
  const m = md.match(/^\s*\*{0,2}(Status|Decision|Result)\*{0,2}\s*[:：]\s*\*{0,2}(.+)$/im);
  if (!m) return null;
  return m[2].replace(/[*_`#]/g, '').trim().slice(0, 80);
}

function classifyCommit(subject: string, isMerge: boolean): { type: string; scope: string | null } {
  if (isMerge) return { type: 'merge', scope: null };
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:/);
  if (m) return { type: m[1].toLowerCase(), scope: m[2] ?? null };
  return { type: 'other', scope: null };
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

async function collectPlans(): Promise<PlanDoc[]> {
  const roots = [
    path.join(ROOT, 'plans'),
    path.join(ROOT, 'docs'),
  ];
  const files: string[] = [];
  for (const r of roots) {
    files.push(...(await walk(r, (f) => f.toLowerCase().endsWith('.md'))));
  }
  // Hand-picked root docs that read like plans / project state.
  for (const name of ['CONTEXT.md', 'README.md']) {
    const p = path.join(ROOT, name);
    try {
      await fs.access(p);
      files.push(p);
    } catch {
      /* skip */
    }
  }

  const plans = await Promise.all(
    files.map(async (abs): Promise<PlanDoc | null> => {
      try {
        const [raw, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
        const relPath = rel(abs);
        const fileName = path.basename(abs);
        return {
          id: relPath,
          path: relPath,
          fileName,
          title: firstHeading(raw, fileName.replace(/\.md$/i, '')),
          category: categorize(relPath, fileName),
          status: parseStatus(raw),
          mtime: stat.mtime.toISOString(),
          sizeKb: Math.max(1, Math.round(stat.size / 1024)),
          words: raw.split(/\s+/).filter(Boolean).length,
          html: await marked.parse(raw),
        };
      } catch {
        return null;
      }
    })
  );

  return plans
    .filter((p): p is PlanDoc => p !== null)
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

async function collectCommits(): Promise<CommitInfo[]> {
  // One log call for metadata (record sep = \x1e, field sep = \x1f).
  const RS = '\x1e';
  const FS = '\x1f';
  let metaOut: string;
  try {
    metaOut = await git([
      'log',
      '--date=short',
      `--pretty=format:%H${FS}%h${FS}%an${FS}%ad${FS}%ar${FS}%P${FS}%s${FS}%b${RS}`,
    ]);
  } catch {
    return [];
  }

  // One log call for per-commit numstat.
  let statOut = '';
  try {
    statOut = await git(['log', '--numstat', `--pretty=format:${RS}%H`]);
  } catch {
    /* stats optional */
  }

  // Parse numstat into a map keyed by hash.
  const statMap = new Map<string, CommitFile[]>();
  for (const block of statOut.split(RS)) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const hash = lines[0].trim();
    const files: CommitFile[] = [];
    for (const line of lines.slice(1)) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parts[0] === '-' ? -1 : parseInt(parts[0], 10) || 0;
      const removed = parts[1] === '-' ? -1 : parseInt(parts[1], 10) || 0;
      files.push({ path: parts.slice(2).join('\t'), added, removed });
    }
    if (hash) statMap.set(hash, files);
  }

  const commits: CommitInfo[] = [];
  for (const rec of metaOut.split(RS)) {
    const trimmed = rec.replace(/^\n+/, '');
    if (!trimmed.trim()) continue;
    const [hash, shortHash, author, date, relDate, parents, subject, ...bodyParts] = trimmed.split(FS);
    if (!hash) continue;
    const body = bodyParts.join(FS).trim();
    const isMerge = (parents?.trim().split(/\s+/).filter(Boolean).length ?? 0) > 1;
    const { type, scope } = classifyCommit(subject ?? '', isMerge);
    const files = statMap.get(hash) ?? [];
    const added = files.reduce((s, f) => s + Math.max(0, f.added), 0);
    const removed = files.reduce((s, f) => s + Math.max(0, f.removed), 0);
    commits.push({
      hash,
      shortHash,
      author,
      date,
      relDate,
      subject: subject ?? '',
      body,
      type,
      scope,
      isMerge,
      files,
      added,
      removed,
    });
  }
  return commits;
}

async function collectRoutes(): Promise<AppRoute[]> {
  const appDir = path.join(ROOT, 'app');
  const files = await walk(appDir, (f) => /[/\\](page|route|layout)\.tsx?$/.test(f));
  return files
    .map((abs): AppRoute => {
      const relPath = rel(abs);
      const base = path.basename(abs).replace(/\.tsx?$/, '') as 'page' | 'route' | 'layout';
      // Build URL from folders between app/ and the file.
      const dirRel = path.relative(appDir, path.dirname(abs)).split(path.sep).filter(Boolean);
      // Skip route groups like (marketing)
      const segs = dirRel.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
      const routePath = '/' + segs.join('/');
      return {
        routePath: routePath === '/' ? '/' : routePath.replace(/\/$/, ''),
        kind: base,
        file: relPath,
        segment: segs[0] ?? '(root)',
        dynamic: relPath.includes('['),
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
}

async function collectStatus(
  plans: PlanDoc[],
  commits: CommitInfo[],
  routes: AppRoute[]
): Promise<DashboardStatus> {
  let branch = 'unknown';
  let clean = true;
  let dirtyCount = 0;
  let contributors = 0;

  try {
    branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    /* noop */
  }
  try {
    const porcelain = (await git(['status', '--porcelain'])).split('\n').filter((l) => l.trim());
    dirtyCount = porcelain.length;
    clean = dirtyCount === 0;
  } catch {
    /* noop */
  }
  try {
    contributors = new Set(
      (await git(['log', '--pretty=format:%an'])).split('\n').map((s) => s.trim()).filter(Boolean)
    ).size;
  } catch {
    contributors = new Set(commits.map((c) => c.author)).size;
  }

  let componentCount = 0;
  try {
    const comps = await walk(path.join(ROOT, 'components'), (f) => f.endsWith('.tsx'));
    componentCount = comps.length;
  } catch {
    /* noop */
  }

  let tech: string[] = [];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies ?? {});
    const pick = ['next', 'react', 'typescript', 'tailwindcss', '@supabase/supabase-js', '@tanstack/react-query', 'framer-motion', 'zod'];
    tech = pick
      .map((name) => {
        const v = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
        return v ? `${name.replace('@supabase/supabase-js', 'supabase').replace('@tanstack/react-query', 'react-query')} ${String(v).replace(/^[\^~]/, '')}` : null;
      })
      .filter((x): x is string => Boolean(x));
    if (!tech.length) tech = deps.slice(0, 8);
  } catch {
    /* noop */
  }

  const plansByCategory: Record<string, number> = {};
  for (const p of plans) plansByCategory[p.category] = (plansByCategory[p.category] ?? 0) + 1;
  const commitsByType: Record<string, number> = {};
  for (const c of commits) commitsByType[c.type] = (commitsByType[c.type] ?? 0) + 1;

  return {
    branch,
    totalCommits: commits.length,
    clean,
    dirtyCount,
    lastCommitDate: commits[0]?.date ?? null,
    contributors,
    counts: {
      plans: plans.length,
      routes: routes.length,
      pages: routes.filter((r) => r.kind === 'page').length,
      components: componentCount,
    },
    plansByCategory,
    commitsByType,
    tech,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDashboardData(): Promise<DashboardData> {
  const [plans, commits, routes] = await Promise.all([
    collectPlans(),
    collectCommits(),
    collectRoutes(),
  ]);
  const status = await collectStatus(plans, commits, routes);
  return { plans, commits, routes, status, gitAvailable: commits.length > 0 };
}

/** Lazy single-commit diff (called by the diff route handler). Capped for weight. */
const MAX_DIFF_LINES = 1200;

export async function getCommitDiff(
  hash: string
): Promise<{ diff: string; truncated: boolean } | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) return null;
  try {
    // -m --first-parent so merge commits show their net diff (plain `show` is empty for merges).
    const raw = await git(['show', hash, '--no-color', '--format=', '-p', '-m', '--first-parent']);
    const lines = raw.split('\n');
    if (lines.length > MAX_DIFF_LINES) {
      return { diff: lines.slice(0, MAX_DIFF_LINES).join('\n'), truncated: true };
    }
    return { diff: raw, truncated: false };
  } catch {
    return null;
  }
}
