<#
.SYNOPSIS
  Installs the Zen new tab favorites mod (and the fx-autoconfig loader) into a Zen profile.

.DESCRIPTION
  1. Copies fx-autoconfig's loader (config.js) into the Zen install folder, if it is missing.
     This step needs administrator rights, so a UAC prompt appears.
  2. Copies fx-autoconfig's profile part and the mod's JS/CSS into <profile>\chrome.
  3. Clears the profile's startup cache so Zen picks up the new scripts.

  Zen must be closed while installing.

.PARAMETER ProfilePath
  Profile folder. Defaults to the profile Zen starts with (from installs.ini / profiles.ini).

.PARAMETER ZenPath
  Zen install folder. Defaults to "C:\Program Files\Zen Browser".

.PARAMETER SkipLoader
  Do not touch the Zen install folder (use when config.js is already there).
#>
param(
  [string]$ProfilePath,
  [string]$ZenPath = "$env:ProgramFiles\Zen Browser",
  [switch]$SkipLoader
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Get-DefaultProfile {
  $zenData = Join-Path $env:APPDATA "zen"
  $installs = Join-Path $zenData "installs.ini"
  $profilesIni = Join-Path $zenData "profiles.ini"
  $rel = $null
  if (Test-Path $installs) {
    # Prefer the install section whose default profile is not a twilight one.
    $rel = (Select-String -Path $installs -Pattern "^Default=(.+)$" |
      ForEach-Object { $_.Matches[0].Groups[1].Value } |
      Where-Object { $_ -notmatch "twilight" } |
      Select-Object -First 1)
  }
  if (-not $rel -and (Test-Path $profilesIni)) {
    $rel = (Select-String -Path $profilesIni -Pattern "^Path=(.+)$" |
      ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
  }
  if (-not $rel) { throw "Could not find a Zen profile. Pass -ProfilePath explicitly." }
  return Join-Path $zenData ($rel -replace "/", "\")
}

if (-not $ProfilePath) { $ProfilePath = Get-DefaultProfile }
if (-not (Test-Path $ProfilePath)) { throw "Profile folder not found: $ProfilePath" }
$ProfilePath = (Resolve-Path $ProfilePath).Path

$lock = Join-Path $ProfilePath "parent.lock"
if (Test-Path $lock) {
  try { [IO.File]::Open($lock, "Open", "ReadWrite", "None").Close() }
  catch { throw "Zen is running with this profile. Close Zen and run the script again." }
}

# 1. Loader in the Zen install folder
if (-not $SkipLoader) {
  $cfg = Join-Path $ZenPath "config.js"
  $cfgPrefs = Join-Path $ZenPath "defaults\pref\config-prefs.js"
  if ((Test-Path $cfg) -and (Test-Path $cfgPrefs)) {
    Write-Host "fx-autoconfig loader already present in $ZenPath"
  } else {
    Write-Host "Installing fx-autoconfig loader into $ZenPath (administrator rights needed)..."
    $src = Join-Path $root "vendor\fx-autoconfig\program"
    $cmd = "Copy-Item -LiteralPath '$src\config.js' -Destination '$cfg' -Force; " +
           "Copy-Item -LiteralPath '$src\defaults\pref\config-prefs.js' -Destination '$cfgPrefs' -Force"
    $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList "-NoProfile", "-Command", $cmd
    if ($p.ExitCode -ne 0 -or -not (Test-Path $cfg)) { throw "Failed to copy config.js into $ZenPath" }
  }
}

# 2. Profile files
$chrome = Join-Path $ProfilePath "chrome"
foreach ($d in "utils", "JS", "CSS", "resources") {
  New-Item -ItemType Directory -Force (Join-Path $chrome $d) | Out-Null
}
Copy-Item (Join-Path $root "vendor\fx-autoconfig\utils\*") (Join-Path $chrome "utils") -Force
Copy-Item (Join-Path $root "src\JS\*") (Join-Path $chrome "JS") -Force
Copy-Item (Join-Path $root "src\CSS\*") (Join-Path $chrome "CSS") -Force
Copy-Item (Join-Path $root "src\resources\*") (Join-Path $chrome "resources") -Recurse -Force
Write-Host "Copied mod files into $chrome"

# 3. Startup cache: <profile>\startupCache for custom profiles, or the local profile dir for regular ones
$localProfile = $ProfilePath -replace [regex]::Escape($env:APPDATA), $env:LOCALAPPDATA
foreach ($c in (Join-Path $ProfilePath "startupCache"), (Join-Path $localProfile "startupCache")) {
  if (Test-Path $c) {
    Remove-Item -Recurse -Force $c
    Write-Host "Cleared $c"
  }
}

Write-Host "Done. Start Zen and press Ctrl+T."
