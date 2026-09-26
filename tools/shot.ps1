<#
.SYNOPSIS
  Screenshot of the dev Zen window (the one started by tools/dev.ps1), even if it is behind other windows.
#>
param([Parameter(Mandatory)][string]$Out)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$profileDir = Join-Path $root ".dev\profile"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShotNative {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static IntPtr FindLargestWindow(uint targetPid) {
    IntPtr best = IntPtr.Zero; long bestArea = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == targetPid && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        long area = (long)(r.R - r.L) * (r.B - r.T);
        if (area > bestArea) { bestArea = area; best = h; }
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
"@

# Zen on Windows starts through a launcher process, so check every matching process for a window.
$procs = Get-CimInstance Win32_Process -Filter "Name = 'zen.exe'" |
  Where-Object { $_.CommandLine -like "*$profileDir*" -and $_.CommandLine -notlike "*-contentproc*" }
if (-not $procs) { throw "Dev Zen is not running" }

$hwnd = [IntPtr]::Zero
foreach ($p in $procs) {
  $hwnd = [ShotNative]::FindLargestWindow([uint32]$p.ProcessId)
  if ($hwnd -ne [IntPtr]::Zero) { break }
}
if ($hwnd -eq [IntPtr]::Zero) { throw "Dev Zen window not found" }

$r = New-Object ShotNative+RECT
[void][ShotNative]::GetWindowRect($hwnd, [ref]$r)
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][ShotNative]::PrintWindow($hwnd, $hdc, 2)  # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "saved $Out"
