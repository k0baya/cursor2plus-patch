param(
  [string]$BaseUrl = $env:CCURSOR_RELEASE_BASE_URL,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$PatchedBy = "k0baya"
$DisplayName = "Cursor++ k0baya Local"
$SignatureFingerprint = "kbya-20260624-local"
$DefaultBaseUrl = "__CCURSOR_RELEASE_BASE_URL__"

if ($Help) {
  Write-Host "$DisplayName installer"
  Write-Host "Usage:"
  Write-Host "  `$env:CCURSOR_RELEASE_BASE_URL='https://github.com/<org>/<repo>/releases/latest/download'; powershell -ExecutionPolicy Bypass -File .\install.ps1"
  Write-Host "  powershell -ExecutionPolicy Bypass -Command `"irm https://github.com/<org>/<repo>/releases/latest/download/install.ps1 | iex`""
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = $DefaultBaseUrl }
$BaseUrl = $BaseUrl.TrimEnd("/")
if ($BaseUrl -eq "__CCURSOR_RELEASE_BASE_URL__") {
  throw "Release base URL is not configured. Set CCURSOR_RELEASE_BASE_URL or publish this script through the GitHub Actions release workflow."
}

function Test-Command($Name) {
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Sha256($Path) {
  (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Download($Url, $OutFile) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

Write-Host "== $DisplayName installer =="
Write-Host "Patched by: $PatchedBy"
Write-Host "Signature: $SignatureFingerprint"
Write-Host "Release: $BaseUrl"

if (-not (Test-Command "node")) { throw "Node.js is required. Install Node.js 18+ first." }
if (-not (Test-Command "npm")) { throw "npm is required. Install Node.js/npm first." }

$nodeMajorText = (& node -p "process.versions.node.split('.')[0]").Trim()
$nodeMajor = [int]$nodeMajorText
if ($nodeMajor -lt 18) { throw "Node.js 18+ is required. Current major version: $nodeMajor" }

if (Get-Process Cursor -ErrorAction SilentlyContinue) {
  throw "Cursor is running. Close Cursor and run this installer again."
}

if (-not (Test-Admin)) {
  Write-Warning "Administrator privileges may be required because Cursor is usually installed under Program Files."
  Write-Warning "If installation fails with EACCES/EPERM, rerun this command from an Administrator PowerShell."
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ccursor-k0baya-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $latestPath = Join-Path $tmp "latest.json"
  Invoke-Download "$BaseUrl/latest.json" $latestPath
  $latest = Get-Content -Raw $latestPath | ConvertFrom-Json
  if ($latest.patchedBy -ne $PatchedBy) {
    Write-Warning "latest.json patchedBy is '$($latest.patchedBy)', expected '$PatchedBy'. Continuing."
  }
  if ($latest.signature.fingerprint -ne $SignatureFingerprint) {
    throw "latest.json signature fingerprint is '$($latest.signature.fingerprint)', expected '$SignatureFingerprint'."
  }

  $tgzPath = Join-Path $tmp $latest.tarball.name
  Invoke-Download "$BaseUrl/$($latest.tarball.name)" $tgzPath
  $actualHash = Get-Sha256 $tgzPath
  if ($actualHash -ne $latest.tarball.sha256.ToLowerInvariant()) {
    throw "SHA256 mismatch for $($latest.tarball.name). Expected $($latest.tarball.sha256), got $actualHash"
  }
  Write-Host "SHA256 verified: $actualHash"

  if (Test-Command "cursor") {
    & cursor --uninstall-extension company-internal.cursor2plus 2>$null | Out-Null
    & cursor --uninstall-extension cometix-space.cursor2plus 2>$null | Out-Null
  }

  Write-Host "Running ccursor install from local tarball..."
  & npm exec --yes --package $tgzPath -- ccursor install
  if ($LASTEXITCODE -ne 0) { throw "ccursor install failed with exit code $LASTEXITCODE" }

  Write-Host "Verifying installation status..."
  & npm exec --yes --package $tgzPath -- ccursor status
  if ($LASTEXITCODE -ne 0) { throw "ccursor status failed with exit code $LASTEXITCODE" }

  Write-Host ""
  Write-Host "Installed $DisplayName. Restart Cursor."
  Write-Host "Required after restart: set Cursor network mode to HTTP/1.1 and make sure Cursor++ BYOK is ON."
  Write-Host "Recommended: set Cursor orientation to vertical to find the Cursor++ configuration panel more easily."
  Write-Host "Update procedure: close Cursor, uninstall this patch, then install again."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
