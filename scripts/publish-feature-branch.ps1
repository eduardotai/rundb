# Run from PowerShell: .\scripts\publish-feature-branch.ps1
# Publishes feat/supabase-real-data-and-ingest with atomic commits + PR.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$branch = "feat/supabase-real-data-and-ingest"
git checkout $branch

function Commit-IfChanges {
  param([string]$Message, [string[]]$Paths)
  git add @Paths
  $status = git diff --cached --quiet; $code = $LASTEXITCODE
  if ($code -ne 0) {
    git commit -m $Message
    Write-Host "Committed: $Message"
  } else {
    Write-Host "Skipped (no staged changes): $Message"
  }
}

Commit-IfChanges "chore(repo): add CI workflow, PR template, and gitignore improvements" @(".gitignore", ".github/")
Commit-IfChanges "feat(db): extend Supabase schema and incremental migrations" @("supabase/")
Commit-IfChanges "feat(backend): Supabase real-data layer, ingest pipeline, and scripts" @("lib/", "middleware.ts", "next.config.ts", "package.json", "scripts/")
Commit-IfChanges "feat(ui): real-data surfaces, admin layout, and component updates" @("app/", "components/")
Commit-IfChanges "docs: update README and Phase 0 progress notes" @("README.md", "plans/PHASE0_PROTONDB_PRECISION_PROGRESS.md")

git push -u origin $branch

gh pr create --base main --head $branch --title "feat: Supabase real-data pipeline and ingest" --body @"
## Summary
- Adds Supabase real-data reads/writes with mock fallback
- Game ingest pipeline, cover resolver, and admin scripts
- UI updates for games, submit flow, and home page
- CI workflow (lint + build) and PR template

## Test plan
- [ ] ``npm run lint``
- [ ] ``npm run build``
- [ ] Browse /games and /games/[slug]
- [ ] Submit report flow works in mock mode
"@

Write-Host "Done. PR created above."
