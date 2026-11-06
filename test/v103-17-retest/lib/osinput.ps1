# OS-level input for the NextTypora packaged retest.
# ASCII only on purpose: PowerShell 5.1 reads a BOM-less .ps1 as the ANSI code page,
# and a non-ASCII comment then swallows the following line. This file is UTF-8 with BOM
# anyway, but keeping it ASCII removes the whole class of problem.
#
# Actions:
#   windows  -ProcessId <pid>                 list top-level windows of a process
#   front    -ProcessId <pid> [-Topmost]      bring the app's main window to the foreground
#   keys     -Keys "ctrl+v,enter,alt+f4"      hardware-like keystrokes (scan-code SendInput)
#   text     -Text "abc"                      per-character scan-code typing (ASCII letters/digits)
#   click    -X <n> -Y <n> [-Double]          real mouse click at screen pixels
#   move     -X <n> -Y <n>
#   drag     -FromX -FromY -ToX -ToY          slow OLE-friendly drag
#   ime      -Klid 00000804|00000409          ask the foreground window to switch input language
#   clipget                                   print the clipboard as text
#   clipset  -Text "..."                      set the clipboard

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$ProcessId = 0,
  [string]$Keys = '',
  [string]$Text = '',
  [int]$X = 0, [int]$Y = 0,
  [int]$FromX = 0, [int]$FromY = 0, [int]$ToX = 0, [int]$ToY = 0,
  [string]$Klid = '',
  [string]$Button = 'left',
  [int]$Seconds = 25,
  [switch]$Topmost,
  [switch]$Double
)

$ErrorActionPreference = 'Stop'
# Window titles are Chinese; emit UTF-8 so the caller's logs stay readable.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class OsIn {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }

  public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_SCANCODE = 0x0008, KEYEVENTF_EXTENDEDKEY = 0x0001;
  public const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000, MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;

  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadKeyboardLayoutW(string klid, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr PostMessageW(IntPtr h, uint msg, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint threadId);
  // Without this the process is DPI-virtualized: GetWindowRect and SetCursorPos speak
  // logical 96-DPI pixels while UI Automation reports physical ones, so at 125% every
  // click lands 25% off. Make the process per-monitor aware so all three agree.
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static string MakeDpiAware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor-v2"; } catch {}
    try { if (SetProcessDPIAware()) return "system"; } catch {}
    return "already-or-failed";
  }

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);

  public class Win { public IntPtr H; public string Title; public string Cls; public int W; public int Hh; public int L; public int T; }

  public static List<Win> WindowsOf(uint pid) {
    var found = new List<Win>();
    EnumWindows((h, p) => {
      uint wpid; GetWindowThreadProcessId(h, out wpid);
      if (wpid != pid || !IsWindowVisible(h)) return true;
      var t = new StringBuilder(512); GetWindowTextW(h, t, 512);
      var c = new StringBuilder(256); GetClassNameW(h, c, 256);
      RECT r; GetWindowRect(h, out r);
      found.Add(new Win { H = h, Title = t.ToString(), Cls = c.ToString(), L = r.Left, T = r.Top, W = r.Right - r.Left, Hh = r.Bottom - r.Top });
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static void Send(INPUT[] inputs) {
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) throw new Exception("SendInput sent " + sent + " of " + inputs.Length + ", err " + Marshal.GetLastWin32Error());
  }

  public static void Scan(ushort scan, bool up, bool extended) {
    uint flags = KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
    var i = new INPUT { type = INPUT_KEYBOARD };
    i.u.ki = new KEYBDINPUT { wVk = 0, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
    Send(new[] { i });
  }

  public static void MouseTo(int x, int y) {
    SetCursorPos(x, y);
    var i = new INPUT { type = INPUT_MOUSE };
    i.u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = 0, dwFlags = MOUSEEVENTF_MOVE, time = 0, dwExtraInfo = IntPtr.Zero };
    Send(new[] { i });
  }

  public static void MouseButton(bool down) { MouseButton(down, false); }

  public static void MouseButton(bool down, bool right) {
    uint flags = right ? (down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
                       : (down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP);
    var i = new INPUT { type = INPUT_MOUSE };
    i.u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = 0, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
    Send(new[] { i });
  }

  public static void Front(IntPtr h, bool topmost) {
    ShowWindow(h, 9); // SW_RESTORE
    SetForegroundWindow(h);
    if (topmost) SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002); // HWND_TOPMOST, NOSIZE|NOMOVE
  }

  public static void SwitchIme(IntPtr h, string klid) {
    IntPtr hkl = LoadKeyboardLayoutW(klid, 1 /* KLF_ACTIVATE */);
    PostMessageW(h, 0x0050 /* WM_INPUTLANGCHANGEREQUEST */, new IntPtr(1), hkl);
  }
}
'@

[void][OsIn]::MakeDpiAware()

# Set 1 scan codes. Extended keys (arrows, right alt/ctrl, numpad enter) need the extended flag.
$SCAN = @{
  'a'=0x1E;'b'=0x30;'c'=0x2E;'d'=0x20;'e'=0x12;'f'=0x21;'g'=0x22;'h'=0x23;'i'=0x17;'j'=0x24
  'k'=0x25;'l'=0x26;'m'=0x32;'n'=0x31;'o'=0x18;'p'=0x19;'q'=0x10;'r'=0x13;'s'=0x1F;'t'=0x14
  'u'=0x16;'v'=0x2F;'w'=0x11;'x'=0x2D;'y'=0x15;'z'=0x2C
  '1'=0x02;'2'=0x03;'3'=0x04;'4'=0x05;'5'=0x06;'6'=0x07;'7'=0x08;'8'=0x09;'9'=0x0A;'0'=0x0B
  'minus'=0x0C;'equal'=0x0D;'space'=0x39;'enter'=0x1C;'tab'=0x0F;'esc'=0x01;'backspace'=0x0E
  'comma'=0x33;'period'=0x34;'slash'=0x35;'semicolon'=0x27;'backtick'=0x29
  'ctrl'=0x1D;'shift'=0x2A;'alt'=0x38
  'f1'=0x3B;'f2'=0x3C;'f3'=0x3D;'f4'=0x3E;'f5'=0x3F;'f6'=0x40;'f7'=0x41;'f8'=0x42;'f9'=0x43;'f10'=0x44;'f11'=0x57;'f12'=0x58
  'left'=0x4B;'right'=0x4D;'up'=0x48;'down'=0x50;'home'=0x47;'end'=0x4F;'delete'=0x53
}
$EXTENDED = @('left','right','up','down','home','end','delete')

function Resolve-Main([int]$pid2) {
  $wins = [OsIn]::WindowsOf([uint32]$pid2)
  if (-not $wins -or $wins.Count -eq 0) { throw "no visible window for pid $pid2" }
  # MainWindowHandle can be a tooltip while one shows: prefer titled windows, then the biggest.
  $titled = $wins | Where-Object { $_.Title -ne '' -and $_.Cls -notmatch 'tooltip' }
  $pool = if ($titled) { $titled } else { $wins }
  return ($pool | Sort-Object { $_.W * $_.Hh } -Descending)[0]
}

function Send-Chord([string]$chord) {
  $parts = $chord.Split('+') | ForEach-Object { $_.Trim().ToLower() }
  $mods = @(); $main = $null
  foreach ($p in $parts) {
    if ($p -in @('ctrl','shift','alt')) { $mods += $p } else { $main = $p }
  }
  if (-not $main) { throw "chord '$chord' has no main key" }
  if (-not $SCAN.ContainsKey($main)) { throw "unknown key '$main'" }
  foreach ($m in $mods) { [OsIn]::Scan([uint16]$SCAN[$m], $false, $false); Start-Sleep -Milliseconds 15 }
  [OsIn]::Scan([uint16]$SCAN[$main], $false, ($EXTENDED -contains $main))
  Start-Sleep -Milliseconds 25
  [OsIn]::Scan([uint16]$SCAN[$main], $true, ($EXTENDED -contains $main))
  [array]::Reverse($mods)
  foreach ($m in $mods) { Start-Sleep -Milliseconds 15; [OsIn]::Scan([uint16]$SCAN[$m], $true, $false) }
}

switch ($Action.ToLower()) {
  'windows' {
    [OsIn]::WindowsOf([uint32]$ProcessId) | ForEach-Object {
      "{0} | {1}x{2} at {3},{4} | cls={5} | title={6}" -f $_.H, $_.W, $_.Hh, $_.L, $_.T, $_.Cls, $_.Title
    }
  }
  'front' {
    $w = Resolve-Main $ProcessId
    [OsIn]::Front($w.H, [bool]$Topmost)
    Start-Sleep -Milliseconds 250
    "front={0} title={1} rect={2},{3} {4}x{5}" -f $w.H, $w.Title, $w.L, $w.T, $w.W, $w.Hh
  }
  'keys' {
    # Never type blind. If a pid is given, the foreground window must belong to it, or we
    # would be sending Alt+F4 into whatever the user happens to have in front.
    if ($ProcessId -gt 0) {
      $fg = [OsIn]::GetForegroundWindow()
      $owner = ([OsIn]::WindowsOf([uint32]$ProcessId) | Where-Object { $_.H -eq $fg })
      if (-not $owner) {
        throw "refusing to send '$Keys': foreground window $fg does not belong to pid $ProcessId"
      }
    }
    foreach ($chord in $Keys.Split(',')) {
      if ($chord.Trim() -eq '') { continue }
      Send-Chord $chord.Trim()
      Start-Sleep -Milliseconds 60
    }
    'ok'
  }
  'text' {
    foreach ($ch in $Text.ToCharArray()) {
      $k = [string]$ch
      $shift = $false
      if ($k -cmatch '[A-Z]') { $shift = $true; $k = $k.ToLower() }
      if (-not $SCAN.ContainsKey($k)) { throw "no scan code for '$ch' - use clipset+ctrl+v for this text" }
      if ($shift) { Send-Chord "shift+$k" } else { Send-Chord $k }
      Start-Sleep -Milliseconds 30
    }
    'ok'
  }
  'click' {
    $right = ($Button.ToLower() -eq 'right')
    [OsIn]::MouseTo($X, $Y); Start-Sleep -Milliseconds 150
    [OsIn]::MouseButton($true, $right); Start-Sleep -Milliseconds 50; [OsIn]::MouseButton($false, $right)
    if ($Double) {
      Start-Sleep -Milliseconds 90
      [OsIn]::MouseButton($true, $right); Start-Sleep -Milliseconds 40; [OsIn]::MouseButton($false, $right)
    }
    'ok'
  }
  'move' { [OsIn]::MouseTo($X, $Y); 'ok' }
  'drag' {
    [OsIn]::MouseTo($FromX, $FromY); Start-Sleep -Milliseconds 200
    [OsIn]::MouseButton($true); Start-Sleep -Milliseconds 250
    $steps = 28
    for ($i = 1; $i -le $steps; $i++) {
      $cx = [int]($FromX + ($ToX - $FromX) * $i / $steps)
      $cy = [int]($FromY + ($ToY - $FromY) * $i / $steps)
      [OsIn]::MouseTo($cx, $cy)
      Start-Sleep -Milliseconds 45
    }
    Start-Sleep -Milliseconds 400
    [OsIn]::MouseButton($false)
    'ok'
  }
  'ime' {
    $h = [OsIn]::GetForegroundWindow()
    [OsIn]::SwitchIme($h, $Klid)
    Start-Sleep -Milliseconds 400
    'ok'
  }
  'place' {
    # Move/size a window in PHYSICAL pixels (this process is DPI aware), so an Explorer
    # window and the app window can be put side by side for a real drag-and-drop.
    $w = Resolve-Main $ProcessId
    [void][OsIn]::SetWindowPos($w.H, [IntPtr]::Zero, $X, $Y, $ToX, $ToY, 0x0004) # SWP_NOZORDER
    Start-Sleep -Milliseconds 400
    $w2 = Resolve-Main $ProcessId
    "placed {0} at {1},{2} {3}x{4}" -f $w2.H, $w2.L, $w2.T, $w2.W, $w2.Hh
  }
  'alive' {
    # A plain process-existence check. The 'windows' action prints nothing when a process has
    # no visible window and still exits 0, which made an earlier liveness check always say
    # "still running".
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($p) { 'yes' } else { 'no' }
  }
  'screen' {
    Add-Type -AssemblyName System.Windows.Forms
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    "{0}x{1}" -f $b.Width, $b.Height
  }
  'waitdialog' {
    # The common dialog is a #32770 window OWNED BY THE APP. Enumerating by class+pid is
    # reliable; keying off the focused element is not (focus may not have moved yet).
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      $dlg = [OsIn]::WindowsOf([uint32]$ProcessId) | Where-Object { $_.Cls -eq '#32770' }
      if ($dlg) {
        $d = $dlg[0]
        "{0}|{1}|{2},{3},{4},{5}" -f $d.H, $d.Title, $d.L, $d.T, $d.W, $d.Hh
        exit 0
      }
      Start-Sleep -Milliseconds 300
    }
    throw "no #32770 dialog owned by pid $ProcessId within $Seconds s"
  }
  'nodialog' {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      $dlg = [OsIn]::WindowsOf([uint32]$ProcessId) | Where-Object { $_.Cls -eq '#32770' }
      if (-not $dlg) { 'gone'; exit 0 }
      Start-Sleep -Milliseconds 300
    }
    throw "dialog still open on pid $ProcessId after $Seconds s"
  }
  'clipget' { Get-Clipboard -Raw }
  'clipset' { Set-Clipboard -Value $Text; 'ok' }
  default { throw "unknown action '$Action'" }
}
