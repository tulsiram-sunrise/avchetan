# Usage: powershell -ExecutionPolicy Bypass -File tooling/perf/measure-hotkey.ps1 [-Runs 10]
# Times the shortcut (Ctrl+Shift+Space) to the capture box being shown and in front, ready for
# typing, on the running demo app (with its main window closed). Part of the performance baseline
# (docs/product/finding-and-using-data.md#7-performance-baseline). Dev only, Windows only.
param([int]$Runs = 10)
$ErrorActionPreference = 'Stop'

$app = Get-Process avchetan-desktop | Select-Object -First 1
if (-not $app) { throw 'Avchetan is not running: start the demo app' }

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class HotkeyTimer {
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  const uint UP = 2;
  static void Chord(byte[] keys) {
    foreach (var k in keys) keybd_event(k, 0, 0, UIntPtr.Zero);
    Array.Reverse(keys);
    foreach (var k in keys) keybd_event(k, 0, UP, UIntPtr.Zero);
  }
  // The app's window in front and visible: the capture box (the main window stays closed).
  static bool AppInFront(uint appPid) {
    var front = GetForegroundWindow();
    uint pid;
    GetWindowThreadProcessId(front, out pid);
    return pid == appPid && IsWindowVisible(front);
  }
  public static double Once(uint appPid) {
    if (AppInFront(appPid)) { Chord(new byte[] { 0x1B }); Thread.Sleep(600); }
    var watch = Stopwatch.StartNew();
    Chord(new byte[] { 0x11, 0x10, 0x20 }); // Ctrl+Shift+Space
    while (!AppInFront(appPid)) {
      if (watch.ElapsedMilliseconds > 5000) throw new Exception("the capture box did not come up");
      Thread.SpinWait(200);
    }
    var ms = watch.Elapsed.TotalMilliseconds;
    Thread.Sleep(300);
    Chord(new byte[] { 0x1B }); // Esc hides it
    Thread.Sleep(600);
    return ms;
  }
}
"@

$samples = @()
for ($i = 0; $i -lt $Runs; $i++) { $samples += [HotkeyTimer]::Once([uint32]$app.Id) }
$sorted = $samples | Sort-Object
$median = $sorted[[math]::Floor($sorted.Count / 2)]
"shortcut -> capture box ready  {0,6:N0} ms  (min {1:N0}, max {2:N0}, {3} runs)" -f $median, $sorted[0], $sorted[-1], $Runs
