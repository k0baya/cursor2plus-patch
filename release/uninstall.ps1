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
  Write-Host "$DisplayName uninstaller"
  Write-Host "Usage:"
  Write-Host "  `$env:CCURSOR_RELEASE_BASE_URL='https://github.com/<org>/<repo>/releases/latest/download'; powershell -ExecutionPolicy Bypass -File .\uninstall.ps1"
  Write-Host "  powershell -ExecutionPolicy Bypass -Command `"irm https://github.com/<org>/<repo>/releases/latest/download/uninstall.ps1 | iex`""
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = $DefaultBaseUrl }
$BaseUrl = $BaseUrl.TrimEnd("/")
if ($DefaultBaseUrl.StartsWith("__") -and $BaseUrl -eq $DefaultBaseUrl) {
  throw "Release base URL is not configured. Set CCURSOR_RELEASE_BASE_URL or publish this script through the GitHub Actions release workflow."
}

function Test-Command($Name) {
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Sha256($Path) {
  (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-Download($Url, $OutFile) {
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedUninstaller {
  $scriptUrl = "$BaseUrl/uninstall.ps1"
  $bootstrapPath = Join-Path ([IO.Path]::GetTempPath()) ("ccursor-k0baya-uninstall-elevated-" + [guid]::NewGuid().ToString("N") + ".ps1")
  $bootstrap = @"
`$ErrorActionPreference = "Stop"
`$env:CCURSOR_RELEASE_BASE_URL = @'
$BaseUrl
'@
Invoke-Expression (Invoke-RestMethod -Uri @'
$scriptUrl
'@)
"@
  Set-Content -LiteralPath $bootstrapPath -Value $bootstrap -Encoding UTF8
  try {
    Write-Warning "Administrator privileges are required to restore Cursor files under Program Files."
    Write-Warning "Opening an elevated PowerShell window. Approve the Windows UAC prompt to continue."
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $bootstrapPath) -Verb RunAs -Wait -PassThru
    if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) {
      throw "Elevated uninstaller failed with exit code $($p.ExitCode)."
    }
    Write-Host "Elevated uninstaller finished. Restart Cursor."
  } catch {
    throw "Administrator elevation was cancelled or failed. Re-run this command from an Administrator PowerShell. $($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $bootstrapPath -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "== $DisplayName uninstaller =="
Write-Host "Patched by: $PatchedBy"
Write-Host "Signature: $SignatureFingerprint"
Write-Host "Release: $BaseUrl"

if (-not (Test-Command "node")) { throw "Node.js is required. Install Node.js 18+ first." }
if (-not (Test-Command "npm")) { throw "npm is required. Install Node.js/npm first." }

if (Get-Process Cursor -ErrorAction SilentlyContinue) {
  throw "Cursor is running. Close Cursor and run this uninstaller again."
}

if (-not (Test-Admin)) {
  Start-ElevatedUninstaller
  exit 0
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("ccursor-k0baya-uninstall-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $latestPath = Join-Path $tmp "latest.json"
  Invoke-Download "$BaseUrl/latest.json" $latestPath
  $latest = Get-Content -Raw $latestPath | ConvertFrom-Json
  $tgzPath = Join-Path $tmp $latest.tarball.name
  Invoke-Download "$BaseUrl/$($latest.tarball.name)" $tgzPath
  $actualHash = Get-Sha256 $tgzPath
  if ($actualHash -ne $latest.tarball.sha256.ToLowerInvariant()) {
    throw "SHA256 mismatch for $($latest.tarball.name). Expected $($latest.tarball.sha256), got $actualHash"
  }

  Write-Host "Running ccursor uninstall from local tarball..."
  & npm exec --yes --package $tgzPath -- ccursor uninstall
  if ($LASTEXITCODE -ne 0) { throw "ccursor uninstall failed with exit code $LASTEXITCODE" }

  if (Test-Command "cursor") {
    & cursor --uninstall-extension company-internal.cursor2plus 2>$null | Out-Null
    $global:LASTEXITCODE = 0
    & cursor --uninstall-extension cometix-space.cursor2plus 2>$null | Out-Null
    $global:LASTEXITCODE = 0
  }

  Write-Host ""
  Write-Host "Uninstalled $DisplayName. Restart Cursor."
  $global:LASTEXITCODE = 0
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
