<#
.SYNOPSIS
  Pull Hermes Desktop upstream changes into this AgentHub fork without losing
  our own work.

.DESCRIPTION
  AgentHub lives in two places at once: brand-new files under src/main/agenthub,
  src/renderer/src/screens/Workers, src/shared/agenthub.ts, plus a small set of
  edits inside upstream-owned files (IPC registration, preload, Layout, theme,
  i18n). Those second group is where a merge can conflict, so this script names
  them before touching anything.

  Safety rules this script never breaks:
    * refuses to run with a dirty working tree
    * only ever merges (no rebase, no reset, no force-push)
    * never writes to origin/main or the legacy/* branches
    * aborts the merge and reports when conflicts appear, unless -KeepConflicts

.PARAMETER Task
  report  Offline status only: what we changed, no network.
  check   Fetch upstream and show what would land, including the conflict
          hotspots. Makes no changes. (default)
  merge   check + merge upstream into the current branch.
  verify  Run the checks a merge must survive: types, lint, AgentHub tests.
  sync    check + merge + verify, the normal one-shot update.

.EXAMPLE
  npm run sync:upstream
  powershell -NoProfile -File scripts/hermes-upstream-sync.ps1 sync
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
# that upstream also rewrote deserves a look before merging.
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

function Run-Git {
  param([string[]]$GitArguments, [switch]$AllowFailure)
  & git @GitArguments
  $code = $LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) {
    throw "git $($GitArguments -join ' ') failed with exit code $code"
  }
  return $code
}

function Capture-Git {
  param([string[]]$GitArguments)
  $output = & git @GitArguments 2>$null
  if ($LASTEXITCODE -ne 0) { return @() }
  return @($output | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
}

function Section($Title) {
  Write-Output ""
  Write-Output "=== $Title ==="
}

function Assert-CleanTree {
  $dirty = Capture-Git @("status", "--porcelain")
  if ($dirty.Count -gt 0) {
    Write-Output "Working tree is not clean ($($dirty.Count) change set(s)):"
    $dirty | Select-Object -First 12 | ForEach-Object { Write-Output "  $_" }
    throw "Commit or stash these first - never sync on top of uncommitted work."
  }
}

function Ensure-UpstreamRemote {
  $url = Capture-Git @("remote", "get-url", $Upstream)
  if ($url.Count -eq 0) {
    Write-Output "No '$Upstream' remote configured; adding $UpstreamRepo"
    Run-Git @("remote", "add", $Upstream, $UpstreamRepo)
  }
}

function Get-OursChanged {
  # Files we changed relative to the point where our branch joined upstream.
  $base = Capture-Git @("merge-base", "HEAD", "$Upstream/$UpstreamBranch")
  if ($base.Count -eq 0) { return @() }
  return Capture-Git @("diff", "--name-only", "--diff-filter=M", "$($base[0])", "HEAD")
}

function Get-ConflictHotspots {
  param([string[]]$IncomingFiles)
  $ours = Get-OursChanged
  $hits = @()
  foreach ($file in $IncomingFiles) {
    if ($ours -contains $file) { $hits += $file; continue }
    foreach ($hint in $HotspotHints) {
      if ($file -like "*$hint*") { $hits += $file; break }
    }
  }
  return @($hits | Select-Object -Unique)
}

function Show-Plan {
  param([string]$Ref)
  $incomingCount = (Capture-Git @("rev-list", "--count", "HEAD..$Ref"))[0]
  $outgoingCount = (Capture-Git @("rev-list", "--count", "$Ref..HEAD"))[0]
  Write-Output "branch          : $(Run-Git @('rev-parse','--abbrev-ref','HEAD') | Select-Object -Last 1)"
  Write-Output "upstream commits we do not have : $incomingCount"
  Write-Output "our commits upstream does not have: $outgoingCount"
  if ([int]$incomingCount -eq 0) {
    Write-Output "Already up to date with $Ref - nothing to merge."
    return $true
  }

  Section "Incoming commits"
  Run-Git @("log", "--oneline", "--no-decorate", "HEAD..$Ref") |
    Select-Object -Last 15

  $incomingFiles = Capture-Git @("diff", "--name-only", "HEAD...$Ref")
  $hotspots = Get-ConflictHotspots -IncomingFiles $incomingFiles
  Section "Files upstream touched ($($incomingFiles.Count))"
  $incomingFiles | Select-Object -First 25 | ForEach-Object { Write-Output "  $_" }
  if ($incomingFiles.Count -gt 25) {
    Write-Output "  ... and $($incomingFiles.Count - 25) more"
  }

  Section "Conflict hotspots - files AgentHub also edits"
  if ($hotspots.Count -eq 0) {
    Write-Output "  none: this merge should be clean"
  } else {
    $hotspots | ForEach-Object { Write-Output "  !! $_" }
    Write-Output "  Read both sides before resolving; keep our AgentHub wiring and"
    Write-Output "  upstream's new behavior, never one at the expense of the other."
  }
  return $false
}

function Invoke-Merge {
  param([string]$Ref)
  Assert-CleanTree
  $code = Run-Git @("merge", "--no-edit", $Ref) -AllowFailure
  if ($code -eq 0) {
    Section "Merged"
    Run-Git @("log", "--oneline", "-1", "--no-decorate") | Select-Object -Last 1
    return $true
  }

  Section "Merge stopped: conflicts"
  $conflicted = Capture-Git @("diff", "--name-only", "--diff-filter=U")
  if ($conflicted.Count -eq 0) {
    Write-Output "  merge failed without a conflict marker (exit $code)"
  } else {
    $conflicted | ForEach-Object { Write-Output "  !! $_" }
  }
  Write-Output ""
  Write-Output "Resolve by hand, then:  git add <files> && git commit"
  Write-Output "Give up cleanly with:   git merge --abort"
  if (-not $KeepConflicts) {
    Write-Output ""
    Write-Output "Auto-aborting so the tree stays usable (re-run with -KeepConflicts to resolve now)."
    Run-Git @("merge", "--abort") -AllowFailure | Out-Null
  }
  return $false
}

function Invoke-Verify {
  $failures = @()

  Section "Typecheck (node)"
  if ((Run-Git @('rev-parse', '--git-dir') | Select-Object -First 1)) {
    & npm run typecheck:node
    if ($LASTEXITCODE -ne 0) { $failures += "typecheck:node" }
  }

  Section "Typecheck (web)"
  & npm run typecheck:web
  if ($LASTEXITCODE -ne 0) { $failures += "typecheck:web" }

  Section "AgentHub + IPC + preload tests"
  & npx vitest run --maxWorkers=4 `
    tests/agenthub-orchestrator.test.ts `
    tests/ipc-handlers.test.ts `
    tests/preload-api-surface.test.ts
  if ($LASTEXITCODE -ne 0) { $failures += "agenthub tests" }

  Section "Lint (AgentHub scope)"
  & npx eslint --max-warnings=0 src/main/agenthub src/renderer/src/screens/Workers
  if ($LASTEXITCODE -ne 0) { $failures += "eslint" }

  if (Get-Command lat -ErrorAction SilentlyContinue) {
    Section "lat check"
    & lat check
    if ($LASTEXITCODE -ne 0) { $failures += "lat check" }
  } else {
    Section "lat check"
    Write-Output "  skipped: the lat CLI is not installed on this machine"
  }

  Section "Verify result"
  if ($failures.Count -eq 0) {
    Write-Output "  all checks passed"
    return $true
  }
  $failures | ForEach-Object { Write-Output "  FAILED: $_" }
  return $false
}

# ---- entry point ----------------------------------------------------------

if ($Task -eq "verify") {
  if (-not (Invoke-Verify)) { exit 1 }
  exit 0
}

if ($Task -eq "report") {
  Section "Our changes inside upstream-owned files"
  $ours = Get-OursChanged
  if ($ours.Count -eq 0) {
    Write-Output "  none recorded yet (no upstream remote fetched?)"
  } else {
    $ours | ForEach-Object { Write-Output "  $_" }
  }
  Section "AgentHub-owned files (never conflict with upstream)"
  Capture-Git @("ls-files", "src/main/agenthub", "src/renderer/src/screens/Workers", "src/shared/agenthub.ts", "resources/agenthub") |
    ForEach-Object { Write-Output "  $_" }
  exit 0
}

Assert-CleanTree
Ensure-UpstreamRemote
Section "Fetching $Upstream/$UpstreamBranch"
Run-Git @("fetch", $Upstream, $UpstreamBranch) | Out-Null
$Ref = "$Upstream/$UpstreamBranch"

$upToDate = Show-Plan -Ref $Ref
if ($upToDate) {
  if ($Task -eq "verify" -or $Task -eq "sync") {
    if (-not (Invoke-Verify)) { exit 1 }
  }
  exit 0
}

if ($Task -eq "check") {
  Write-Output ""
  Write-Output "Dry run only. To merge and verify:  npm run sync:upstream:all"
  exit 0
}

$merged = Invoke-Merge -Ref $Ref
if (-not $merged) { exit 1 }

if ($Task -eq "sync") {
  if (-not (Invoke-Verify)) {
    Write-Output ""
    Write-Output "Merge landed but verification failed. Fix before pushing; to back out:"
    Write-Output "  git reset --hard ORIG_HEAD"
    exit 1
  }
  Write-Output ""
  Write-Output "Sync complete and verified. Nothing was pushed - review then:"
  Write-Output "  git push origin $(Run-Git @('rev-parse','--abbrev-ref','HEAD') | Select-Object -Last 1)"
}
