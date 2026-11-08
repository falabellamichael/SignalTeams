$msi = "D:\AgentHive\frontend\src-tauri\target\release\bundle\msi\SignalTeams_1.0.0_x64_en-US.msi"
$out = "D:\AgentHive\qa"
Add-Type -AssemblyName System.Drawing

$sig = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W32 {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
    public static List<IntPtr> Kids(IntPtr p) {
        var kids = new List<IntPtr>();
        EnumChildWindows(p, (h, l) => { kids.Add(h); return true; }, IntPtr.Zero);
        return kids;
    }
    public static string Text(IntPtr h) {
        var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString();
    }
}
"@
Add-Type -TypeDefinition $sig

$script:hwnd = [IntPtr]::Zero
function FindWizard {
    $p = Get-Process msiexec -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*SignalTeams*" } | Select-Object -First 1
    if ($p) { $script:hwnd = $p.MainWindowHandle; return $true }
    return $false
}
function ClickButton($pattern) {
    foreach ($k in [W32]::Kids($script:hwnd)) {
        $t = [W32]::Text($k)
        if ($t -match $pattern) {
            [W32]::SendMessage($k, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null  # BM_CLICK
            Start-Sleep -Milliseconds 1100
            return $true
        }
    }
    Write-Output "no button matching $pattern"
    return $false
}
function Shot($name) {
    # HWND_TOP raises the wizard above everything (no foreground steal needed),
    # then CopyFromScreen grabs the physical region it occupies (30,30 logical => 53,53 phys)
    [W32]::SetWindowPos($script:hwnd, [IntPtr](-1), 0, 0, 0, 0, 0x0033) | Out-Null
    Start-Sleep -Milliseconds 700
    $b = New-Object System.Drawing.Bitmap(960, 770)
    $g = [System.Drawing.Graphics]::FromImage($b)
    $g.CopyFromScreen(45, 45, 0, 0, $b.Size)
    $b.Save("$out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $b.Dispose()
    Write-Output "shot $name"
}

$proc = Start-Process msiexec -ArgumentList "/i `"$msi`"" -PassThru
Start-Sleep -Seconds 5
if (-not (FindWizard)) { Write-Output "wizard not found"; exit 1 }
[W32]::SetWindowPos($script:hwnd, [IntPtr]::Zero, 30, 30, 0, 0, 1) | Out-Null
Start-Sleep -Milliseconds 600
Shot "msi_1_welcome"

ClickButton "Next" | Out-Null
Shot "msi_2_license"

ClickButton "accept" | Out-Null
ClickButton "Next" | Out-Null
Shot "msi_3_dir"

ClickButton "Cancel" | Out-Null
Start-Sleep -Milliseconds 800
Shot "msi_4_confirm"
Get-Process msiexec -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "done"
