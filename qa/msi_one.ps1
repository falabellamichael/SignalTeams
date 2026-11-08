$msi = "D:\AgentHive\frontend\src-tauri\target\release\bundle\msi\SignalTeams_1.0.0_x64_en-US.msi"
$out = "D:\AgentHive\qa"
Add-Type -AssemblyName System.Drawing
$sig = @"
using System;
using System.Runtime.InteropServices;
public class W32 {
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
}
"@
Add-Type -TypeDefinition $sig
$proc = Start-Process msiexec -ArgumentList "/i `"$msi`"" -PassThru
Start-Sleep -Seconds 5
$p = Get-Process msiexec | Where-Object { $_.MainWindowTitle -like "*SignalTeams*" } | Select-Object -First 1
if (-not $p) { Write-Output "no wizard"; exit 1 }
$b = New-Object System.Drawing.Bitmap(980, 780)
$g = [System.Drawing.Graphics]::FromImage($b)
$hdc = $g.GetHdc()
[W32]::PrintWindow($p.MainWindowHandle, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc)
$b.Save("$out\msi_final_welcome.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose()
Get-Process msiexec -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "done"
