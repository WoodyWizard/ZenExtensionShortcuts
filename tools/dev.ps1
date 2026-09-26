<#
.SYNOPSIS
  Starts a separate Zen instance with a throwaway dev profile and Marionette enabled.
  Your normal Zen profile is not touched.

.PARAMETER Fresh
  Delete the dev profile first.
#>
param([switch]$Fresh)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$profileDir = Join-Path $root ".dev\profile"
$zen = "$env:ProgramFiles\Zen Browser\zen.exe"

# Stop a previous dev instance (only the one using the dev profile).
Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" |
  Where-Object { $_.CommandLine -like "*$profileDir*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

if ($Fresh -and (Test-Path $profileDir)) { Remove-Item -Recurse -Force $profileDir }
New-Item -ItemType Directory -Force $profileDir | Out-Null

@'
user_pref("zen.welcome-screen.seen", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("app.update.auto", false);
user_pref("browser.urlbar.closeOnWindowBlur", false);
'@ | Set-Content -Encoding utf8 (Join-Path $profileDir "user.js")

& (Join-Path $root "install.ps1") -ProfilePath $profileDir -SkipLoader

Start-Process $zen -ArgumentList "-no-remote", "-profile", "`"$profileDir`"", "--marionette", "-remote-allow-system-access"
Write-Host "Dev Zen started with profile $profileDir"
