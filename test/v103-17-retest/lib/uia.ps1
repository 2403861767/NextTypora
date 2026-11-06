# UI Automation helper for the Windows common dialogs the app opens (folder picker, save-as).
# ASCII only: button captions are localized, so everything here is addressed by AutomationId
# or ControlType instead of by Chinese text.
#
#   dump    -ProcessId <pid>                    print the dialog's control tree
#   wait    -TitleLike <re> [-Seconds n]        wait for a dialog window to appear, print its handle
#   click   -AutomationId 1                     click a control (1 = OK / Save / Select Folder, 2 = Cancel)
#   setedit -Value "C:\path\file.html"          put text into the dialog's edit/combo box
#   state                                       print the foreground window's class and title

param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$ProcessId = 0,
  [string]$AutomationId = '',
  [string]$Value = '',
  [string]$TitleLike = '',
  [long]$Hwnd = 0,
  [int]$Seconds = 15
)

$ErrorActionPreference = 'Stop'
# Dialog captions are Chinese; without this the caller decodes GBK bytes as UTF-8 and the
# logs turn into mojibake exactly where the diagnosis lives.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

# UIA BoundingRectangle is in physical pixels. A DPI-virtualized process would then click
# 25% off at 125% scaling, so become DPI aware before reading any rectangle.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class Dpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Make() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {}
    try { SetProcessDPIAware(); } catch {}
  }
}
'@
[Dpi]::Make()

# Prefer an explicit window handle (from osinput.ps1 -Action waitdialog): rooting the search
# at the dialog itself avoids depending on where keyboard focus happens to be.
function Get-DialogRoot {
  if ($Hwnd -ne 0) {
    return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
  }
  $fg = [System.Windows.Automation.AutomationElement]::FocusedElement
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $fg
  $last = $fg
  while ($node -ne $null -and $node -ne [System.Windows.Automation.AutomationElement]::RootElement) {
    $last = $node
    $node = $walker.GetParent($node)
  }
  return $last
}

# A common dialog can contain SEVERAL controls with AutomationId '1' (a toolbar item as well
# as the OK button), and FindFirst returns whichever comes first in the tree - which clicked
# the wrong thing once. Collect every match and prefer the dialog's real push button: class
# Button, enabled, and the one nearest the bottom of the dialog.
function Find-ById([string]$id) {
  $root = Get-DialogRoot
  if ($null -eq $root) { throw 'no dialog root from focused element' }
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($all.Count -eq 0) { throw "no control with AutomationId '$id' in '$($root.Current.Name)'" }
  $cands = @()
  foreach ($e in $all) { $cands += $e }
  $buttons = $cands | Where-Object { $_.Current.ClassName -eq 'Button' -and $_.Current.IsEnabled }
  if ($buttons) {
    return ($buttons | Sort-Object { $_.Current.BoundingRectangle.Y } -Descending)[0]
  }
  return $cands[0]
}

switch ($Action.ToLower()) {
  'state' {
    $root = Get-DialogRoot
    if ($null -eq $root) { 'none' } else {
      "class={0} name={1} rect={2}" -f $root.Current.ClassName, $root.Current.Name, $root.Current.BoundingRectangle
    }
  }
  'wait' {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      $root = Get-DialogRoot
      if ($null -ne $root) {
        $name = $root.Current.Name
        $cls = $root.Current.ClassName
        if ($cls -eq '#32770' -and ($TitleLike -eq '' -or $name -match $TitleLike)) {
          "dialog class=$cls name=$name"
          exit 0
        }
      }
      Start-Sleep -Milliseconds 400
    }
    throw "no #32770 dialog matching '$TitleLike' within $Seconds s"
  }
  'dump' {
    $root = Get-DialogRoot
    if ($null -eq $root) { throw 'no dialog root' }
    "ROOT class=$($root.Current.ClassName) name=$($root.Current.Name)"
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($e in $all) {
      $c = $e.Current
      "  id='{0}' type={1} cls={2} name='{3}' enabled={4} rect={5}" -f `
        $c.AutomationId, $c.ControlType.ProgrammaticName, $c.ClassName, $c.Name, $c.IsEnabled, $c.BoundingRectangle
    }
  }
  'click' {
    $el = Find-ById $AutomationId
    try {
      $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $p.Invoke()
      "invoked id=$AutomationId name='$($el.Current.Name)'"
    } catch {
      # Not invokable (the folder picker's Select Folder is a Pane with class Button): click it.
      $r = $el.Current.BoundingRectangle
      $cx = [int]($r.X + $r.Width / 2); $cy = [int]($r.Y + $r.Height / 2)
      & "$PSScriptRoot\osinput.ps1" -Action click -X $cx -Y $cy | Out-Null
      "clicked id=$AutomationId name='$($el.Current.Name)' at $cx,$cy"
    }
  }
  'setedit' {
    # The save dialog's file-name box is AutomationId 1001 and is reported as a *Pane* whose
    # ClassName is Edit - searching by ControlType.Edit finds the file list's column cells
    # instead and silently sets nothing, which once let a Save run with the default name.
    $root = Get-DialogRoot
    if ($null -eq $root) { throw 'no dialog root' }
    $byId = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
    $target = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byId)
    if ($null -eq $target) {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit')
      $target = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    }
    if ($null -eq $target) { throw 'no file-name box (AutomationId 1001 / class Edit) in dialog' }

    $set = 'value-pattern'
    try {
      $vp = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $vp.SetValue($Value)
    } catch {
      # Not settable: click the box for real, select all, and paste.
      $set = 'click+paste'
      $r = $target.Current.BoundingRectangle
      $cx = [int]($r.X + $r.Width / 2); $cy = [int]($r.Y + $r.Height / 2)
      & "$PSScriptRoot\osinput.ps1" -Action click -X $cx -Y $cy | Out-Null
      Start-Sleep -Milliseconds 300
      & "$PSScriptRoot\osinput.ps1" -Action clipset -Text $Value | Out-Null
      & "$PSScriptRoot\osinput.ps1" -Action keys -Keys 'ctrl+a,ctrl+v' | Out-Null
      Start-Sleep -Milliseconds 300
    }
    # Read it back: a silent no-op here is exactly the failure we are guarding against.
    $now = ''
    try { $now = $target.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { $now = $target.Current.Name }
    "set file-name via $set; box now reads '$now'"
  }
  default { throw "unknown action '$Action'" }
}
