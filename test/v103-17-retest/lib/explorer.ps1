# Locate a file item inside an open Explorer window, in physical screen pixels, so a real
# OLE drag can start on it. ASCII only.
#
#   find -Folder "<dir>" -Item "<name>"   prints "hwnd|x,y,w,h" of the item's row

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Folder = '',
  [string]$Item = '',
  [int]$Seconds = 20
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class Dpi2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Make() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {} try { SetProcessDPIAware(); } catch {} }
}
'@
[Dpi2]::Make()

function Get-ExplorerWindow([string]$folder) {
  $leaf = Split-Path $folder -Leaf
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'CabinetWClass')
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $wins) {
      if ($w.Current.Name -like "*$leaf*") { return $w }
    }
    if ($wins.Count -gt 0) { return $wins[0] }
    Start-Sleep -Milliseconds 500
  }
  throw "no Explorer (CabinetWClass) window for '$folder' within $Seconds s"
}

switch ($Action.ToLower()) {
  'find' {
    $win = Get-ExplorerWindow $Folder
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::ListItem)
    $items = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    foreach ($it in $items) {
      if ($it.Current.Name -eq $Item -or $it.Current.Name -like "$Item*") {
        $r = $it.Current.BoundingRectangle
        "{0}|{1},{2},{3},{4}" -f $win.Current.NativeWindowHandle, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height
        exit 0
      }
    }
    $names = @(); foreach ($it in $items) { $names += $it.Current.Name }
    throw "item '$Item' not found in Explorer; saw: $($names -join ', ')"
  }
  'hwnd' {
    $win = Get-ExplorerWindow $Folder
    "{0}" -f $win.Current.NativeWindowHandle
  }
  default { throw "unknown action '$Action'" }
}
