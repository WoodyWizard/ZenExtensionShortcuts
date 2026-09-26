<#
.SYNOPSIS
  Runs a smoke-test scenario from tools/tests against the dev Zen (start it with tools/dev.ps1).

.EXAMPLE
  .\tools\test.ps1 seed     # reset the dev favorites to a known list
  .\tools\test.ps1 edit     # edit mode: add, validate, rename, Escape
  .\tools\test.ps1 drag     # icons and drag to reorder
  .\tools\test.ps1 open     # Alt+N, click, middle click, closing on outside click
  .\tools\test.ps1 misc     # Ctrl+L without panel, light theme

  Add -Shot to save a screenshot of the dev window afterwards.
#>
param(
  [Parameter(Mandatory)][string]$Name,
  [switch]$Shot
)

$ErrorActionPreference = "Stop"
$tools = $PSScriptRoot
$tmp = Join-Path $env:TEMP "zfav-test.js"

$body = if ($Name -eq "seed") {
  Get-Content (Join-Path $tools "tests\seed.js") -Raw
} else {
  (Get-Content (Join-Path $tools "test-helpers.js") -Raw) + "`n" + (Get-Content (Join-Path $tools "tests\$Name.js") -Raw)
}
Set-Content -Encoding utf8 $tmp $body
node (Join-Path $tools "marionette.mjs") evalfile $tmp

if ($Shot) {
  & (Join-Path $tools "shot.ps1") -Out (Join-Path (Split-Path $tools -Parent) ".dev\$Name.png")
}
