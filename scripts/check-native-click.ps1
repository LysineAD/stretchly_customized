param([int]$X, [int]$Y)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DisplayClickProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static void MoveMouse(int x, int y) {
    int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
    int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    uint normalizedX = (uint)Math.Round((x - left) * 65535.0 / (width - 1));
    uint normalizedY = (uint)Math.Round((y - top) * 65535.0 / (height - 1));
    mouse_event(0xC001, normalizedX, normalizedY, 0, UIntPtr.Zero);
  }
}
'@
[DisplayClickProbe]::SetProcessDPIAware() | Out-Null
$originalTask = New-Object DisplayClickProbe+Point
[DisplayClickProbe]::GetCursorPos([ref]$originalTask) | Out-Null
try {
  [DisplayClickProbe]::MoveMouse($X, $Y)
  Start-Sleep -Milliseconds 200
  [DisplayClickProbe]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [DisplayClickProbe]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 150
} finally {
  [DisplayClickProbe]::MoveMouse($originalTask.X, $originalTask.Y)
}
