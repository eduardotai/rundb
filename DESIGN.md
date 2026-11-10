# RunDB design system — "Paper & Graphite"

Status: adopted. Rolled out in small PRs: tokens, theme and UI primitives first, then the app
shell, then one page at a time. Keep this file in sync when tokens or page patterns change.

## Concept
RunDB answers one question — *"will this game run well on my PC?"* — so the UI should get out of the
way of the numbers. The new look is a calm, editorial "paper & graphite" system: warm off-white
paper, graphite ink, hairline borders, soft shadows, and **one** restrained indigo accent used only
for focus, links, active navigation and the primary data highlight. Performance tiers keep their
own colour scale (green → red), tuned per theme for WCAG AA, so colour always *means* something.
A matching graphite dark mode follows the OS by default and can be toggled from the header.

## Principles
1. **Numbers first.** FPS, tier and report count are the largest things on every data surface; chrome is quiet.
2. **One accent.** Indigo = "interactive / you". Tier colours = "performance". Nothing else is coloured.
3. **Search is everywhere.** A global ⌘K / `/` game search in the header; big search on the home hero.
4. **Obvious next step.** Each page has a single primary action (filled graphite button); others are outline/ghost.
5. **Calm motion.** 150–250 ms ease-out transitions on hover/focus, skeleton shimmers, no motion with `prefers-reduced-motion`.
6. **Accessible by default.** Text ≥ 4.5:1, visible 2px focus rings, 40px+ touch targets, semantic landmarks, skip link.

## Tokens (centralised in `app/globals.css`)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F7F6F3` | `#0E0F11` | page |
| `--card` | `#FFFFFF` | `#16171A` | surfaces |
| `--muted` | `#EFEDE8` | `#1E2024` | wells, chips, skeletons |
| `--foreground` | `#1A1917` | `#EDEDEE` | ink |
| `--muted-foreground` | `#63605A` | `#A3A3AB` | secondary text (AA on bg + card) |
| `--border` | `#E3E0DA` | `#2A2C31` | hairlines |
| `--primary` | graphite `#1A1917` | `#EDEDEE` | primary buttons |
| `--brand` | indigo `#4A50C8` | `#9AA0FF` | focus ring, links, active nav, highlights |
| `--success / --warning / --info / --destructive` | AA text shades | lighter shades | status text, soft backgrounds via `/10` |
| `--tier-*` / `--tier-*-fill` / `--tier-*-bg` | text / chart fill / badge tint | per theme | performance scale |
| Radius | `--radius: 0.75rem` (sm 8 / md 10 / lg 12 / xl 16 / 2xl 20) | | |
| Shadows | `--shadow-xs/sm/md/lg` (warm, low-opacity) | deeper in dark | elevation |
| Type | Geist; display `clamp(2.25rem,5vw,3.75rem)`, h1 `1.875rem`, h2 `1.25rem`, body 15px, mono tabular for numbers | | |
| Spacing | Tailwind 4px scale; sections 64–96px, cards 16–24px | | |
| Motion | `--motion-fast 150ms`, `--motion-med 250ms`, `--ease-out-smooth` | | |

Legacy Tailwind colour literals (`text-emerald-400`, `bg-amber-500/10`, `bg-white text-black`…) were
replaced with semantic tokens (`text-success`, `bg-warning/10`, `bg-foreground text-background`) so
both themes stay correct.

## Global chrome
- **Header:** logo mark + wordmark, nav with active pill, global game search (⌘K / `/`), theme toggle,
  sign in, filled "Submit report". Mobile: search icon + menu sheet with all links and actions.
- **Footer:** three short columns (product links, community, about) instead of a single tiny line.
- **Theme:** `next-themes` (already a dependency) with `system` default; no hard-coded `dark` class.

## Page-by-page
- **Home:** hero with a large instant game search and quick picks, live KPIs as a quiet stat strip,
  trending grid with tier + avg FPS on each card, 3-step "how it works", final CTA band.
- **Games:** sticky toolbar (search, sort, result count), genre + tier filter chips with tier colour
  dots, clear-all, polished empty state, cards show tier and report count.
- **Game detail:** hero band (cover, title, meta, report badge, primary CTA) + KPI row (avg FPS,
  dominant tier, reports, common preset); main column = report list with filter bar; sidebar =
  community stats (tier bar + FPS by resolution), official requirements, spec check. Removed the
  duplicated "Quick check" card.
- **Reports:** "by game" view became compact, scannable rows (thumbnail, name, reports, avg FPS,
  tier) instead of 240px-tall cover rows; filter bar unified.
- **Report card:** clearer hierarchy (GPU → CPU → resolution/preset), large tabular FPS with 1% low,
  tier badge, calmer metadata chips, accessible vote control.
- **Will it run? / Submit / Auth / Profile / My reports / Admin:** inherit the new surfaces, form
  controls, buttons and status tokens; auth pages get a centred card on a soft background with
  provider buttons in neutral outline style.

## Non-goals
The redesign itself changes no data, schema, API or auth logic and adds no dependencies. Data
honesty rules (real counts, honest "Most active" vs "Trending this week", error states instead of
fake zeros) live in `lib/data*.ts` and apply to every page.
