$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
Set-Location -LiteralPath $repoRoot

$requiredFiles = @(
    "calendar-data.json",
    "index.html",
    "app.js",
    "styles.css",
    ".nojekyll"
)

foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required publish file is missing: $file"
    }
}

$calendarData = Get-Content -Raw -Encoding UTF8 -LiteralPath "calendar-data.json" | ConvertFrom-Json
if ($null -eq $calendarData.calendar -or
    $null -eq $calendarData.topicAliases -or
    $null -eq $calendarData.titleMappings -or
    $null -eq $calendarData.events) {
    throw "calendar-data.json is missing required fields"
}

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
    throw "Unable to determine the current git branch"
}

& git add -- calendar-data.json index.html app.js styles.css .nojekyll scripts/publish-github-pages.ps1
if ($LASTEXITCODE -ne 0) {
    throw "git add failed"
}

& git diff --cached --quiet
$diffExitCode = $LASTEXITCODE
if ($diffExitCode -eq 1) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
    & git commit -m "Update calendar snapshot $stamp"
    if ($LASTEXITCODE -ne 0) {
        throw "git commit failed"
    }
} elseif ($diffExitCode -ne 0) {
    throw "git diff failed"
}

& git pull --rebase origin $branch
if ($LASTEXITCODE -ne 0) {
    throw "git pull --rebase failed"
}

& git push origin $branch
if ($LASTEXITCODE -ne 0) {
    throw "git push failed"
}

Write-Output "Published https://wendy-move.github.io/topic-hours-dashboard/"
