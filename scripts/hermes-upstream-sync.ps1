<#
.SYNOPSIS
  Pull Hermes Desktop upstream changes into this AgentHub fork without losing
  our own work.

.DESCRIPTION
  AgentHub lives in two places at once: brand-new files under src/main/agenthub,
  src/renderer/src/screens/Workers, src/shared/agenthub.ts, plus a small set of
  edits inside upstream-owned files (IPC registration, preload, Layout, theme,
  i18n). That second group is where a merge can conflict, so this script names
  the hotspots before touching anything.

  Safety rules this script never breaks:
    * refuses to run with a dirty working tree
    * only ever merges (no rebase, no reset, no force-push)
    * never writes to origin/main or the legacy/* branches
    * aborts the merge and reports when conflicts appear, unless -KeepConflicts
    * never pushes on its own

  Written for Windows PowerShell 5.1 and PowerShell 7 alike: informational text
  goes to the host stream (never captured by the caller), and every function
  returns exactly one value.

.PARAMETER Task
  report  Offline status only: what we changed, no network.
  check   Fetch upstream and show what would land, including conflict hotspots.
          Makes no changes. (default)
  merge   check + merge upstream into the current branch.
  verify  Run the checks a merge must survive: types, tests, lint.
  sync    check + merge + verify, the normal one-shot update.

.EXAMPLE
  npm run sync:upstream
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/hermes-upstream-sync.ps1 sync
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("report", "check", "merge", "verify", "sync")]
  [string]$Task = "check",

  [string]$Upstream = "upstream",

  [string]$UpstreamRepo = "https://github.com/fathah/hermes-desktop.git",

  [string]$UpstreamBranch = "main",

  # Keep a conflicted merge in progress so it can be resolved by hand.
  [switch]$KeepConflicts
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

# Files AgentHub edits inside upstream's own tree. Anything outside this list
# that upstream also rewrote still gets flagged by the ours-vs-theirs check
# below; this list only adds extra attention for known touchpoints.
$HotspotHints = @(
  "src/main/ipc/register.ts",
  "src/preload/index.ts",
  "src/preload/index.d.ts",
  "src/main/hermes.ts",
  "src/main/app/start.ts",
  "src/renderer/src/screens/Layout/Layout.tsx",
  "src/renderer/src/assets/main.css",
  "src/renderer/src/screens/Chat/slash/desktopCommands.ts",
  "src/shared/i18n/locales/",
  ".gitignore",
  "lat.md/lat.md"
)

# Informational text must go to the host stream: Write-Output would be captured
# by any caller that assigns a function's result, which is exactly the bug this
# script's first revision had.
function Info([string]$Text) {
  Write-Host $Text
}

function Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ==="
}

<#
  Run git and stream its output straight through; throw when it fails.
  stderr passes to the console untouched. EAP is relaxed for the duration
  because Windows PowerShell 5.1 turns native stderr into a terminating error
  when $ErrorActionPreference is Stop.
#>
function Invoke-Git {
  param([string[]]$GitArguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git @GitArguments
  } finally {
    $ErrorActionPreference = $previous
  }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw "git $($GitArguments -join ' ') failed with exit code $code"
  }
}

<#
  Run git and return only its stdout lines as a string array. Empty array on a
  non-zero exit, which callers treat as "no result" (unknown rev, no merge
  base, nothing found).
#>
function Get-GitLines {
  param([string[]]$GitArguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = & git @GitArguments 2>$null
  } catch {
    $raw = $null
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($raw | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

function Assert-CleanTree {
  $dirty = @(Get-GitLines @("status", "--porcelain"))
  if ($dirty.Count -gt 0) {
    Info "Working tree is not clean ($($dirty.Count) change set(s)):"
    $dirty | Select-Object -First 12 | ForEach-Object { Info "  $_" }
    throw "Commit or stash these first - never sync on top of uncommitted work."
  }
}

function Ensure-UpstreamRemote {
  $url = @(Get-GitLines @("remote", "get-url", $Upstream))
  if ($url.Count -eq 0) {
    Info "No '$Upstream' remote configured; adding $UpstreamRepo"
    Invoke-Git @("remote", "add", $Upstream, $UpstreamRepo)
  }
}

function Get-MergeBase {
  return @(Get-GitLines @("merge-base", "HEAD", "$Upstream/$UpstreamBranch"))
}

function Get-OursChanged {
  $base = @(Get-GitLines @("merge-base", "HEAD", "$Upstream/$UpstreamBranch"))
  if ($base.Count -eq 0) { return @() }
  return @(Get-GitLines @(
    "diff", "--name-only", "--diff-filter=M", $base[0], "HEAD"
  ))
}

function Get-ConflictHotspots {
  param([string[]]$IncomingFiles)
  $ours = @(Get-OursChanged)
  $hits = @()
  foreach ($file in $IncomingFiles) {
    if ($ours -contains $file) { $hits += $file; continue }
    foreach ($hint in $HotspotHints) {
      if ($file -like "*$hint*") { $hits += $file; break }
    }
  }
  return @($hits | Select-Object -Unique)
}

<#
  Print what a merge would do. Returns $true only when there is nothing to
  merge; all text goes to the host stream so the boolean stays clean.
#>
function Show-Plan {
  param([string]$Ref)
  $incoming = @(Get-GitLines @("rev-list", "--count", "HEAD..$Ref"))
  $outgoing = @(Get-GitLines @("rev-list", "--count", "$Ref..HEAD"))
  $branch = @(Get-GitLines @("rev-parse", "--abbrev-ref", "HEAD"))

  Info "branch                            : $($branch[0])"
  Info "upstream commits we do not have   : $($incoming[0])"
  Info "our commits upstream does not have: $($outgoing[0])"

  if ([int]::Parse($incoming[0]) -eq 0) {
    Info "Already up to date with $Ref - nothing to merge."
    return $true
  }

  Section "Incoming commits"
  @(Invoke-Git @("log", "--oneline", "--no-decorate", "HEAD..$Ref")) |
    Select-Object -Last 15 | ForEach-Object { Info "  $_" }

  $incomingFiles = @(Get-GitLines @("diff", "--name-only", "HEAD...$Ref"))
  $hotspots = @(Get-ConflictHotspots -IncomingFiles $incomingFiles)

  Section "Files upstream touched ($($incomingFiles.Count))"
  $incomingFiles | Select-Object -First 25 | ForEach-Object { Info "  $_" }
  if ($incomingFiles.Count -gt 25) {
    Info "  ... and $($incomingFiles.Count - 25) more"
  }

  Section "Conflict hotspots - files AgentHub also edits"
  if ($hotspots.Count -eq 0) {
    Info "  none: this merge should be clean"
  } else {
    $hotspots | ForEach-Object { Info "  !! $_" }
    Info "  Read both sides before resolving; keep our AgentHub wiring and"
    Info "  upstream's new behavior, never one at the expense of the other."
  }
  return $false
}

function Invoke-Merge {
  param([string]$Ref)
  Assert-CleanTree

  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git merge --no-edit $Ref
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -eq 0) {
    Section "Merged"
    Invoke-Git @("log", "--oneline", "-1", "--no-decorate")
    return $true
  }

  Section "Merge stopped: conflicts"
  $conflicted = @(Get-GitLines @("diff", "--name-only", "--diff-filter=U"))
  if ($conflicted.Count -eq 0) {
    Info "  merge failed without conflict markers (exit $LASTEXITCODE)"
  } else {
    $conflicted | ForEach-Object { Info "  !! $_" }
  }
  Info ""
  Info "Resolve by hand, then:  git add <files> && git commit"
  Info "Give up cleanly with:   git merge --abort"
  if (-not $KeepConflicts) {
    Info ""
    Info "Auto-aborting so the tree stays usable (re-run with -KeepConflicts to resolve now)."
    $null = & git merge --abort 2>$null
  }
  return $false
}

function Invoke-Verify {
  $failures = @()

  Section "Typecheck (node)"
  & npm run typecheck:node
  if ($LASTEXITCODE -ne 0) { $failures += "typecheck:node" }

  Section "Typecheck (web)"
  & npm run typecheck:web
  if ($LASTEXITCODE -ne 0) { $failures += "typecheck:web" }

  Section "AgentHub + IPC + preload tests"
  & npx vitest run --maxWorkers=4 tests/agenthub-orchestrator.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
  if ($LASTEXITCODE -ne 0) { $failures += "agenthub tests" }

  Section "Lint (AgentHub scope)"
  & npx eslint --max-warnings=0 src/main/agenthub src/renderer/src/screens/Workers
  if ($LASTEXITCODE -ne 0) { $failures += "eslint" }

  Section "lat check"
  if (Get-Command lat -ErrorAction SilentlyContinue) {
    & lat check
    if ($LASTEXITCODE -ne 0) { $failures += "lat check" }
  } else {
    Info "  skipped: the lat CLI is not installed on this machine"
  }

  Section "Verify result"
  if ($failures.Count -eq 0) {
    Info "  all checks passed"
    return $true
  }
  $failures | ForEach-Object { Info "  FAILED: $_" }
  return $false
}

# ---- entry point ----------------------------------------------------------

if ($Task -eq "verify") {
  if (-not (Invoke-Verify)) { exit 1 }
  exit 0
}

if ($Task -eq "report") {
  Section "Our changes inside upstream-owned files"
  $ours = @(Get-OursChanged)
  if ($ours.Count -eq 0) {
    Info "  none recorded yet (fetch upstream first?)"
  } else {
    $ours | ForEach-Object { Info "  $_" }
  }
  Section "AgentHub-owned files (never conflict with upstream)"
  @(Get-GitLines @(
    "ls-files",
    "src/main/agenthub",
    "src/renderer/src/screens/Workers",
    "src/shared/agenthub.ts",
    "resources/agenthub"
  )) | ForEach-Object { Info "  $_" }
  exit 0
}

Assert-CleanTree
Ensure-UpstreamRemote
Section "Fetching $Upstream/$UpstreamBranch"
Invoke-Git @("fetch", $Upstream, $UpstreamBranch)
$Ref = "$Upstream/$UpstreamBranch"

$upToDate = Show-Plan -Ref $Ref
if ($upToDate) {
  if ($Task -eq "sync") {
    if (-not (Invoke-Verify)) { exit 1 }
  }
  exit 0
}

if ($Task -eq "check") {
  Info ""
  Info "Dry run only. To merge and verify:  npm run sync:upstream:all"
  exit 0
}

$merged = Invoke-Merge -Ref $Ref
if (-not $merged) { exit 1 }

if ($Task -eq "sync") {
  if (-not (Invoke-Verify)) {
    Info ""
    Info "Merge landed but verification failed. Fix before pushing; to back out:"
    Info "  git reset --hard ORIG_HEAD"
    exit 1
  }
  $branch = @(Get-GitLines @("rev-parse", "--abbrev-ref", "HEAD"))
  Info ""
  Info "Sync complete and verified. Nothing was pushed - review then:"
  Info "  git push origin $($branch[0])"
}
