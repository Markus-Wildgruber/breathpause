# shell/settingswindow - frosted tabbed settings window with live preview. WPF + WinForms ColorDialog.
# UNVERIFIED SCAFFOLDING - parse-checked only; verify on Windows via -Debug ('Build settings window').
#
# New-SettingsWindow($Settings,$Strings,$OnPreview,$OnSaved,$OnCancel,$OnQuit) returns a built
# (not shown) Window. Callbacks receive BOTH the settings and the strings objects (<values> <strings>):
#  - any edit -> $OnPreview <values> <strings>  (apply live, do NOT persist)
#  - Save      -> $OnSaved   <values> <strings> (persist settings.json + strings.json) then close
#  - Cancel/X  -> $OnCancel                     (revert the live preview)
# Color editing: hex field + live swatch + a "Pick" button (built-in WinForms ColorDialog).
# Tabs: Timers / Appearance / Colors / Patterns / Behavior / Hotkeys / Text.
# Text-tab wording is saved to strings.json (separate file) so it can be translated independently.

function New-SwText { param([string]$Value, [double]$Width = 90)
    $t = New-Object System.Windows.Controls.TextBox
    $t.Text = [string]$Value; $t.Width = $Width; $t.HorizontalAlignment = 'Left'; $t.Padding = '4,3,4,3'
    return $t
}
function New-SwCheck { param([string]$Label, [bool]$Checked)
    $c = New-Object System.Windows.Controls.CheckBox
    $c.Content = $Label; $c.IsChecked = $Checked; $c.Foreground = $script:SWFore; $c.Margin = '0,6,0,6'
    return $c
}
# Format a slider value for its readout. $Format: 'pct' (value*100 + %), 'pct100' (value + %), else int.
function Format-SwSliderValue { param([double]$Value, [string]$Format)
    switch ($Format) {
        'pct' { '{0}%' -f [int][math]::Round($Value * 100) }
        'pct100' { '{0}%' -f [int][math]::Round($Value) }
        default { '{0}' -f [int][math]::Round($Value) }
    }
}
# Slider + a live numeric readout (formatted by Format-SwSliderValue).
# Returns @{ row = <slider + readout>; slider = <slider> } — caller adds .row, reads .slider.
function New-SwSlider { param([double]$Min, [double]$Max, [double]$Value, [string]$Format = 'int')
    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'
    $s = New-Object System.Windows.Controls.Slider
    $s.Minimum = $Min; $s.Maximum = $Max; $s.Value = $Value; $s.Width = 200; $s.VerticalAlignment = 'Center'
    $val = New-Object System.Windows.Controls.TextBlock
    $val.Width = 46; $val.Margin = '10,0,0,0'; $val.Foreground = $script:SWFore; $val.VerticalAlignment = 'Center'
    $s.Tag = @{ label = $val; fmt = $Format }
    $val.Text = (Format-SwSliderValue $Value $Format)
    $s.add_ValueChanged({ $t = $args[0].Tag; $t.label.Text = (Format-SwSliderValue $args[0].Value $t.fmt) })
    [void]$row.Children.Add($s); [void]$row.Children.Add($val)
    return @{ row = $row; slider = $s }
}

# Two-thumb range slider over a fixed-width track ($Min..$Max integers) + a live "lo-hi unit"
# readout. Current lo/hi live in the returned control's .Tag for read-back. Built-in WPF only.
# Returns @{ row = <track + readout>; control = <canvas> } — caller adds .row, reads .control.Tag.
function New-SwRangeSlider { param([double]$Min, [double]$Max, [double]$Lo, [double]$Hi, [string]$Unit = 'px')
    if ($Lo -gt $Hi) { $tmp = $Lo; $Lo = $Hi; $Hi = $tmp }   # tolerate a crossed lo/hi from a stale file
    $w = 190; $h = 28; $thumbW = 14
    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'
    $canvas = New-Object System.Windows.Controls.Canvas
    $canvas.Width = $w; $canvas.Height = $h; $canvas.Background = [System.Windows.Media.Brushes]::Transparent
    $track = New-Object System.Windows.Controls.Border
    $track.Height = 4; $track.CornerRadius = '2'; $track.Width = $w; $track.Background = (ConvertTo-Brush '#55FFFFFF')
    [System.Windows.Controls.Canvas]::SetTop($track, ($h / 2 - 2)); [System.Windows.Controls.Canvas]::SetLeft($track, 0)
    $active = New-Object System.Windows.Controls.Border
    $active.Height = 4; $active.CornerRadius = '2'; $active.Background = $script:SWAccent
    [System.Windows.Controls.Canvas]::SetTop($active, ($h / 2 - 2))
    $loThumb = New-Object System.Windows.Controls.Primitives.Thumb
    $loThumb.Width = $thumbW; $loThumb.Height = 18; $loThumb.Cursor = [System.Windows.Input.Cursors]::SizeWE
    $hiThumb = New-Object System.Windows.Controls.Primitives.Thumb
    $hiThumb.Width = $thumbW; $hiThumb.Height = 18; $hiThumb.Cursor = [System.Windows.Input.Cursors]::SizeWE
    [System.Windows.Controls.Canvas]::SetTop($loThumb, ($h / 2 - 9)); [System.Windows.Controls.Canvas]::SetTop($hiThumb, ($h / 2 - 9))
    $readout = New-Object System.Windows.Controls.TextBlock
    $readout.Margin = '10,0,0,0'; $readout.Foreground = $script:SWFore; $readout.VerticalAlignment = 'Center'; $readout.Width = 84
    $canvas.Tag = @{ min = $Min; max = $Max; w = $w; thumbW = $thumbW; active = $active; loThumb = $loThumb; hiThumb = $hiThumb; readout = $readout; unit = $Unit; lo = $Lo; hi = $Hi }
    $loThumb.Tag = @{ canvas = $canvas; which = 'lo' }
    $hiThumb.Tag = @{ canvas = $canvas; which = 'hi' }
    $drag = {
        $th = $args[0]; $e = $args[1]; $st = $th.Tag.canvas.Tag
        $maxX = $st.w - $st.thumbW
        $nx = [System.Windows.Controls.Canvas]::GetLeft($th) + $e.HorizontalChange
        if ($nx -lt 0) { $nx = 0 } elseif ($nx -gt $maxX) { $nx = $maxX }
        if ($th.Tag.which -eq 'lo') { $hiX = [System.Windows.Controls.Canvas]::GetLeft($st.hiThumb); if ($nx -gt $hiX) { $nx = $hiX } }
        else { $loX = [System.Windows.Controls.Canvas]::GetLeft($st.loThumb); if ($nx -lt $loX) { $nx = $loX } }
        [System.Windows.Controls.Canvas]::SetLeft($th, $nx)
        Update-SwRange $th.Tag.canvas $true
    }
    $loThumb.add_DragDelta($drag); $hiThumb.add_DragDelta($drag)
    [void]$canvas.Children.Add($track); [void]$canvas.Children.Add($active)
    [void]$canvas.Children.Add($loThumb); [void]$canvas.Children.Add($hiThumb)
    [void]$row.Children.Add($canvas); [void]$row.Children.Add($readout)
    Set-SwRangeThumbs $canvas $Lo $Hi   # initial placement; preview suppressed
    return @{ row = $row; control = $canvas }
}

# Place both thumbs from lo/hi values, then refresh the active bar + readout (no preview).
function Set-SwRangeThumbs { param($Canvas, [double]$Lo, [double]$Hi)
    $st = $Canvas.Tag
    $maxX = $st.w - $st.thumbW; $span = $st.max - $st.min
    $loX = if ($span -le 0) { 0 } else { ($Lo - $st.min) / $span * $maxX }
    $hiX = if ($span -le 0) { 0 } else { ($Hi - $st.min) / $span * $maxX }
    foreach ($r in @([ref]$loX, [ref]$hiX)) { if ($r.Value -lt 0) { $r.Value = 0 } elseif ($r.Value -gt $maxX) { $r.Value = $maxX } }
    [System.Windows.Controls.Canvas]::SetLeft($st.loThumb, $loX)
    [System.Windows.Controls.Canvas]::SetLeft($st.hiThumb, $hiX)
    Update-SwRange $Canvas $false
}

# Recompute lo/hi (integers) from the thumb positions; update the active bar, readout and Tag.
function Update-SwRange { param($Canvas, [bool]$Preview = $true)
    $st = $Canvas.Tag
    $maxX = $st.w - $st.thumbW; $span = $st.max - $st.min
    $loX = [System.Windows.Controls.Canvas]::GetLeft($st.loThumb)
    $hiX = [System.Windows.Controls.Canvas]::GetLeft($st.hiThumb)
    $st.lo = [int][math]::Round($st.min + ($loX / $maxX) * $span)
    $st.hi = [int][math]::Round($st.min + ($hiX / $maxX) * $span)
    [System.Windows.Controls.Canvas]::SetLeft($st.active, ($loX + $st.thumbW / 2))
    $aw = $hiX - $loX; if ($aw -lt 0) { $aw = 0 }
    $st.active.Width = $aw
    $st.readout.Text = '{0}-{1} {2}' -f $st.lo, $st.hi, $st.unit
    if ($Preview) { Invoke-SwPreview }
}
# Dropdown of available fonts (curated common families that are actually installed; the
# current value is always included). Returns the ComboBox.
function New-SwFontCombo {
    param([string]$Current)
    $combo = New-Object System.Windows.Controls.ComboBox
    $combo.Width = 220; $combo.HorizontalAlignment = 'Left'
    $installed = @{}
    try { foreach ($f in [System.Windows.Media.Fonts]::SystemFontFamilies) { $installed[$f.Source] = $true } } catch { }
    $curated = @('Segoe UI Variable', 'Segoe UI', 'Calibri', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Consolas', 'Trebuchet MS', 'Times New Roman', 'Comic Sans MS')
    $avail = @($curated | Where-Object { $installed.Count -eq 0 -or $installed.ContainsKey($_) })
    if ($Current -and ($avail -notcontains $Current)) { $avail = @($Current) + $avail }
    foreach ($name in $avail) { [void]$combo.Items.Add($name) }
    $combo.SelectedItem = $Current
    if ($null -eq $combo.SelectedItem -and $combo.Items.Count -gt 0) { $combo.SelectedIndex = 0 }
    return $combo
}

# A labeled row: label on the LEFT (fixed column), the control on the RIGHT.
function New-SwField { param([string]$Label, $Control)
    $g = New-Object System.Windows.Controls.Grid
    $g.Margin = '0,6,0,6'
    $c0 = New-Object System.Windows.Controls.ColumnDefinition
    $c0.Width = New-Object System.Windows.GridLength(190)
    $c1 = New-Object System.Windows.Controls.ColumnDefinition
    $c1.Width = New-Object System.Windows.GridLength(1, ([System.Windows.GridUnitType]::Star))
    [void]$g.ColumnDefinitions.Add($c0); [void]$g.ColumnDefinitions.Add($c1)
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $Label; $t.Foreground = $script:SWFore; $t.Opacity = 0.85; $t.FontSize = 12
    $t.VerticalAlignment = 'Center'; $t.TextWrapping = 'Wrap'; $t.Margin = '0,0,10,0'
    [System.Windows.Controls.Grid]::SetColumn($t, 0)
    [System.Windows.Controls.Grid]::SetColumn($Control, 1)
    [void]$g.Children.Add($t); [void]$g.Children.Add($Control)
    return $g
}
function New-SwHeader {
    param([string]$Text)
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $Text; $t.Foreground = $script:SWFore; $t.FontSize = 15; $t.FontWeight = 'SemiBold'; $t.Margin = '0,14,0,4'
    return $t
}
function New-SwTab { param([string]$Header)
    $tab = New-Object System.Windows.Controls.TabItem
    $tab.Header = $Header
    $sv = New-Object System.Windows.Controls.ScrollViewer
    $sv.VerticalScrollBarVisibility = 'Auto'; $sv.Padding = '4'
    $panel = New-Object System.Windows.Controls.StackPanel
    $panel.Margin = '6'
    $sv.Content = $panel; $tab.Content = $sv
    return @{ tab = $tab; panel = $panel }
}
# A parent (group) tab whose content is its own TabControl of child tabs. Returns
# @{ tab = <parent TabItem>; tabs = <inner TabControl> } — add child tabs to .tabs.
function New-SwParentTab { param([string]$Header)
    $tab = New-Object System.Windows.Controls.TabItem
    $tab.Header = $Header
    $inner = New-Object System.Windows.Controls.TabControl
    $inner.Background = [System.Windows.Media.Brushes]::Transparent; $inner.BorderThickness = '0'; $inner.Margin = '0,8,0,0'
    $tab.Content = $inner
    return @{ tab = $tab; tabs = $inner }
}

# Open the built-in Windows color picker; seed from the current hex, preserve alpha for tints.
# The dialog is shown owned by the settings window so its modal block is scoped to settings only —
# if a break fires while it's open, the break overlay (a separate top-level window) stays enabled and
# on top, so it can still be ended. (Without an owner the dialog floats and can trap the break.)
function Invoke-ColorPick { param($Box)
    $dlg = New-Object System.Windows.Forms.ColorDialog
    $dlg.FullOpen = $true
    try {
        $h = $Box.Text.TrimStart('#')
        $dlg.Color = [System.Drawing.Color]::FromArgb([Convert]::ToInt32($h.Substring(0, 2), 16), [Convert]::ToInt32($h.Substring(2, 2), 16), [Convert]::ToInt32($h.Substring(4, 2), 16))
    }
    catch { }
    $owner = $null
    try {
        $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($script:SWWin)).Handle
        if ($hwnd -ne [IntPtr]::Zero) { $owner = New-Object System.Windows.Forms.NativeWindow; $owner.AssignHandle($hwnd) }
    }
    catch { }
    try {
        $res = if ($owner) { $dlg.ShowDialog($owner) } else { $dlg.ShowDialog() }
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
            $c = $dlg.Color
            $hex = '#{0:X2}{1:X2}{2:X2}' -f $c.R, $c.G, $c.B
            $orig = $Box.Text.TrimStart('#')
            if ($orig.Length -ge 8) { $hex += $orig.Substring(6, 2) }  # keep alpha (break tint)
            $Box.Text = $hex
        }
    }
    finally { if ($owner) { $owner.ReleaseHandle() } }
}

# Clickable color swatch (opens the picker) + hex field with live preview. Returns the hex TextBox.
function New-SwColorRow { param($Panel, [string]$Label, [string]$Hex)
    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'
    $sw = New-Object System.Windows.Controls.Border
    $sw.Width = 28; $sw.Height = 28; $sw.CornerRadius = '6'; $sw.Margin = '0,0,8,0'
    $sw.BorderThickness = '1'; $sw.BorderBrush = (ConvertTo-Brush '#888888'); $sw.Cursor = [System.Windows.Input.Cursors]::Hand
    try { $sw.Background = ConvertTo-Brush $Hex } catch { }
    $tb = New-SwText $Hex 110
    $tb.Tag = $sw
    $tb.add_TextChanged({ if (Test-HexColor $args[0].Text) { try { $args[0].Tag.Background = ConvertTo-Brush $args[0].Text } catch { } }; Invoke-SwPreview })
    $sw.Tag = $tb
    $sw.add_MouseLeftButtonUp({ Invoke-ColorPick $args[0].Tag })   # click the color itself to pick
    [void]$row.Children.Add($sw); [void]$row.Children.Add($tb)
    [void]$Panel.Children.Add((New-SwField $Label $row))
    return $tb
}

# [System.Windows.Input.Key] -> hotkey token (A-Z, 0-9, F1-F12), or $null for unsupported/modifier keys.
function ConvertTo-HotkeyKeyName {
    param($Key)
    $s = $Key.ToString()
    if ($s -match '^[A-Z]$') { return $s }
    if ($s -match '^D([0-9])$') { return $Matches[1] }
    if ($s -match '^F([1-9]|1[0-2])$') { return $s }
    return $null
}

# Click-to-capture hotkey field: focus + press a combo (a modifier is required). Returns the box.
function New-SwHotkeyRow {
    param($Panel, [string]$Label, [string]$Current)
    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'
    $box = New-Object System.Windows.Controls.TextBox
    $box.Width = 180; $box.IsReadOnly = $true; $box.Text = $Current; $box.Padding = '4,3,4,3'
    $box.add_PreviewKeyDown({
            $e = $args[1]
            $k = if ($e.Key -eq [System.Windows.Input.Key]::System) { $e.SystemKey } else { $e.Key }
            $e.Handled = $true
            $name = ConvertTo-HotkeyKeyName $k
            if (-not $name) { return }
            $m = [System.Windows.Input.Keyboard]::Modifiers
            $parts = @()
            if ($m -band [System.Windows.Input.ModifierKeys]::Control) { $parts += 'Ctrl' }
            if ($m -band [System.Windows.Input.ModifierKeys]::Alt) { $parts += 'Alt' }
            if ($m -band [System.Windows.Input.ModifierKeys]::Shift) { $parts += 'Shift' }
            if ($m -band [System.Windows.Input.ModifierKeys]::Windows) { $parts += 'Win' }
            if ($parts.Count -eq 0) { return }   # require a modifier
            $parts += $name
            $args[0].Text = ($parts -join '+')
        })
    $clr = New-Object System.Windows.Controls.Button
    $clr.Content = 'Clear'; $clr.Width = 60; $clr.Height = 26; $clr.Margin = '8,0,0,0'; $clr.Tag = $box
    $clr.add_Click({ $args[0].Tag.Text = '' })
    [void]$row.Children.Add($box); [void]$row.Children.Add($clr)
    [void]$Panel.Children.Add((New-SwField $Label $row))
    return $box
}

# Column widths shared by the phase rows and their header strip (so they line up).
$script:SwPhaseColType = 84; $script:SwPhaseColSec = 52; $script:SwPhaseColLabel = 130

# One editable phase row: [type] [seconds] [label] [trash]. Its .Tag holds the controls for read-back.
function New-SwPhaseRow {
    param($Phase)
    $row = New-Object System.Windows.Controls.StackPanel
    $row.Orientation = 'Horizontal'; $row.Margin = '0,3,0,3'
    $combo = New-Object System.Windows.Controls.ComboBox
    $combo.Width = $script:SwPhaseColType; $combo.Height = 28; $combo.VerticalContentAlignment = 'Center'
    foreach ($t in @('Inhale', 'Exhale', 'Hold')) { [void]$combo.Items.Add($t) }
    $combo.SelectedItem = (Get-Culture).TextInfo.ToTitleCase(([string]$Phase.type))
    if ($null -eq $combo.SelectedItem) { $combo.SelectedIndex = 0 }
    $sec = New-Object System.Windows.Controls.TextBox
    $sec.Width = $script:SwPhaseColSec; $sec.Text = [string]$Phase.seconds; $sec.Margin = '8,0,0,0'; $sec.VerticalContentAlignment = 'Center'
    $lbl = New-Object System.Windows.Controls.TextBox
    $lbl.Width = $script:SwPhaseColLabel; $lbl.Text = [string]$Phase.label; $lbl.Margin = '8,0,0,0'; $lbl.VerticalContentAlignment = 'Center'
    $rm = New-Object System.Windows.Controls.Button
    $rm.Content = [char]0xE74D   # Segoe MDL2 "Delete" (trash can) glyph
    $rm.FontFamily = New-Object System.Windows.Media.FontFamily('Segoe MDL2 Assets'); $rm.FontSize = 13
    $rm.Width = 30; $rm.Height = 28; $rm.Margin = '8,0,0,0'; $rm.Tag = $row; $rm.ToolTip = 'Delete phase'
    $rm.add_Click({ $r = $args[0].Tag; if ($r.Parent) { $r.Parent.Children.Remove($r) } })
    $row.Tag = @{ combo = $combo; sec = $sec; lbl = $lbl }
    [void]$row.Children.Add($combo); [void]$row.Children.Add($sec); [void]$row.Children.Add($lbl); [void]$row.Children.Add($rm)
    return $row
}

# A single dim column-header label for the phase editor, sized to match its column.
function New-SwPhaseHeaderCell { param([string]$Text, [double]$Width, [string]$Margin = '0')
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $Text; $t.Width = $Width; $t.Margin = $Margin
    $t.Foreground = $script:SWFore; $t.Opacity = 0.55; $t.FontSize = 11
    return $t
}

# Header + a column-label strip + phase rows (from $Pattern) + an "Add phase" button. Returns the rows container.
function New-SwPhaseEditor {
    param($Panel, [string]$Title, $Pattern)
    [void]$Panel.Children.Add((New-SwHeader $Title))
    $cols = New-Object System.Windows.Controls.StackPanel
    $cols.Orientation = 'Horizontal'; $cols.Margin = '0,0,0,2'
    [void]$cols.Children.Add((New-SwPhaseHeaderCell 'Type' $script:SwPhaseColType))
    [void]$cols.Children.Add((New-SwPhaseHeaderCell 'Sec' $script:SwPhaseColSec '8,0,0,0'))
    [void]$cols.Children.Add((New-SwPhaseHeaderCell 'Label' $script:SwPhaseColLabel '8,0,0,0'))
    [void]$Panel.Children.Add($cols)
    $container = New-Object System.Windows.Controls.StackPanel
    foreach ($ph in @($Pattern.phases)) { [void]$container.Children.Add((New-SwPhaseRow $ph)) }
    [void]$Panel.Children.Add($container)
    $add = New-Object System.Windows.Controls.Button
    $add.Content = '+ Add phase'; $add.Width = 110; $add.Height = 28; $add.HorizontalAlignment = 'Left'; $add.Margin = '0,6,0,0'; $add.Tag = $container
    $add.add_Click({ [void]$args[0].Tag.Children.Add((New-SwPhaseRow @{ type = 'inhale'; seconds = 4.0; label = 'In' })) })
    [void]$Panel.Children.Add($add)
    return $container
}

# Read phase rows back into a phases array (seconds parsed locale-tolerantly + clamped to 0.1-60).
function Read-SwPhases {
    param($Container)
    $list = New-Object System.Collections.ArrayList
    foreach ($row in $Container.Children) {
        $t = $row.Tag
        if (-not $t) { continue }
        $type = ([string]$t.combo.SelectedItem).ToLower()
        $secv = 0.0
        [void][double]::TryParse(($t.sec.Text -replace ',', '.'), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$secv)
        if ($secv -lt 0.1) { $secv = 0.1 } elseif ($secv -gt 60) { $secv = 60 }
        [void]$list.Add(@{ type = $type; seconds = $secv; label = $t.lbl.Text })
    }
    return @($list.ToArray())
}

# Read all controls -> a normalized settings hashtable (used by preview AND save).
function Get-SwValues {
    $new = Get-NormalizedSettings $script:SWSettings
    $new.timers.work = $script:SWWork.Text
    $new.timers.break = $script:SWBreak.Text
    $new.timers.longBreak = $script:SWLong.Text
    $ev = 0; [void][int]::TryParse($script:SWEvery.Text, [ref]$ev); $new.cycle.longBreakEvery = $ev
    $new.appearance.opacity = [double]$script:SWOpacity.Value
    $new.appearance.collapsedDiameterPx = [int]$script:SWDiameter.Tag.lo
    $new.appearance.expandedDiameterPx = [int]$script:SWDiameter.Tag.hi
    $new.appearance.breakSizePctScreenHeight = [double]$script:SWBreakPct.Value
    $pr = 0.0; if ([double]::TryParse($script:SWPosRight.Text, [ref]$pr)) { $new.position.fromRight = $pr }
    $pt = 0.0; if ([double]::TryParse($script:SWPosTop.Text, [ref]$pt)) { $new.position.fromTop = $pt }
    if ($script:SWFontFamily.SelectedItem) { $new.appearance.font.family = [string]$script:SWFontFamily.SelectedItem }
    $new.appearance.font.size = [double]$script:SWFontSize.Value
    $new.appearance.font.countdownSize = [double]$script:SWCountdownSize.Value
    $new.appearance.font.pomodoroSize = [double]$script:SWPomoSize.Value
    $new.appearance.showLabel = [bool]$script:SWShowLabel.IsChecked
    $new.appearance.showPhaseCountdown = [bool]$script:SWShowPhase.IsChecked
    $new.appearance.showRemainingTimeUnderBubble = [bool]$script:SWShowPomo.IsChecked
    $new.appearance.showLongBreakCountdown = [bool]$script:SWShowLong.IsChecked
    $new.appearance.colors.workFill = $script:SWWorkFill.Text
    $new.appearance.colors.breakFill = $script:SWBreakFill.Text
    $new.appearance.colors.text = $script:SWTextColor.Text
    $new.behavior.autoStartTimerOnLaunch = [bool]$script:SWAuto.IsChecked
    $new.cycle.autoContinue = [bool]$script:SWAutoCont.IsChecked
    $new.behavior.startOnBoot = [bool]$script:SWBoot.IsChecked
    $new.behavior.singleInstance = [bool]$script:SWSingle.IsChecked
    $new.sound.enabled = [bool]$script:SWSound.IsChecked
    $new.hotkeys.startStop = $script:SWHkStartStop.Text
    $new.hotkeys.pauseResume = $script:SWHkPause.Text
    $new.hotkeys.skip = $script:SWHkSkip.Text
    $new.hotkeys.settings = $script:SWHkSettings.Text
    # Patterns: rebuild the library as role-based work/break patterns (long break reuses break).
    $wp = Read-SwPhases $script:SWWorkPhases
    $bp = Read-SwPhases $script:SWBreakPhases
    if ($wp.Count -gt 0 -and $bp.Count -gt 0) {
        $new.patterns = @(
            @{ id = 'work-pattern'; name = 'Work'; phases = $wp },
            @{ id = 'break-pattern'; name = 'Break'; phases = $bp }
        )
        $new.workPatternId = 'work-pattern'
        $new.breakPatternId = 'break-pattern'
        $new.longBreakPatternId = 'break-pattern'
    }
    return (Get-NormalizedSettings $new)
}

# Read the Text-tab boxes back into a normalized strings object (kept separate from settings).
function Get-SwStrings {
    $raw = @{ tray = @{}; break = @{} }
    foreach ($key in $script:SWStrBoxes.Keys) {
        $parts = $key.Split('.')
        $raw[$parts[0]][$parts[1]] = $script:SWStrBoxes[$key].Text
    }
    return (Get-NormalizedStrings $raw)
}

function Invoke-SwPreview { if ($script:SWOnPreview) { & $script:SWOnPreview (Get-SwValues) (Get-SwStrings) } }

# Modern implicit styles (rounded buttons w/ hover+press, dark rounded textboxes, flat tabs).
# Built-in WPF only. Applied as the window's implicit resources; degrades gracefully if the
# XAML ever fails to parse (settings window still opens with default controls).
function Set-SwModernStyles {
    param($Win)
    $xaml = @'
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style TargetType="{x:Type Button}">
    <Setter Property="Foreground" Value="#F2F2F2"/>
    <Setter Property="Background" Value="#2EFFFFFF"/>
    <Setter Property="BorderThickness" Value="0"/>
    <Setter Property="Padding" Value="14,6"/>
    <Setter Property="Cursor" Value="Hand"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type Button}">
          <Border x:Name="bd" CornerRadius="8" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Opacity" Value="0.85"/></Trigger>
            <Trigger Property="IsPressed" Value="True"><Setter TargetName="bd" Property="Opacity" Value="0.7"/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style TargetType="{x:Type TextBox}">
    <Setter Property="Foreground" Value="#F2F2F2"/>
    <Setter Property="CaretBrush" Value="#F2F2F2"/>
    <Setter Property="Background" Value="#22FFFFFF"/>
    <Setter Property="BorderBrush" Value="#55FFFFFF"/>
    <Setter Property="BorderThickness" Value="1"/>
    <Setter Property="Padding" Value="6,4"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type TextBox}">
          <Border CornerRadius="6" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}">
            <ScrollViewer x:Name="PART_ContentHost" Margin="{TemplateBinding Padding}"/>
          </Border>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style TargetType="{x:Type TabControl}">
    <Setter Property="Background" Value="Transparent"/>
    <Setter Property="BorderThickness" Value="0"/>
  </Style>
  <!-- Windows-style caption buttons: flat, square, subtle hover. Close goes red on hover. -->
  <Style x:Key="CaptionButton" TargetType="{x:Type Button}">
    <Setter Property="Foreground" Value="#F2F2F2"/>
    <Setter Property="Background" Value="Transparent"/>
    <Setter Property="BorderThickness" Value="0"/>
    <Setter Property="FontSize" Value="13"/>
    <Setter Property="Cursor" Value="Arrow"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type Button}">
          <Border x:Name="bd" Background="{TemplateBinding Background}">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#33FFFFFF"/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style x:Key="CloseButton" TargetType="{x:Type Button}" BasedOn="{StaticResource CaptionButton}">
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type Button}">
          <Border x:Name="bd" CornerRadius="0,12,0,0" Background="{TemplateBinding Background}">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="bd" Property="Background" Value="#E81123"/>
              <Setter Property="Foreground" Value="#FFFFFF"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <!-- Modern thin scrollbar: transparent track, rounded translucent thumb, no arrow buttons. -->
  <Style x:Key="SwScrollThumb" TargetType="{x:Type Thumb}">
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type Thumb}">
          <Border x:Name="th" CornerRadius="4" Background="#40FFFFFF" Margin="2"/>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="th" Property="Background" Value="#80FFFFFF"/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
  <Style TargetType="{x:Type ScrollBar}">
    <Setter Property="Background" Value="Transparent"/>
    <Setter Property="Width" Value="10"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type ScrollBar}">
          <Grid Background="Transparent">
            <Track x:Name="PART_Track" IsDirectionReversed="true">
              <Track.Thumb>
                <Thumb Style="{StaticResource SwScrollThumb}"/>
              </Track.Thumb>
              <Track.IncreaseRepeatButton>
                <RepeatButton Command="{x:Static ScrollBar.PageDownCommand}" Opacity="0" Focusable="False" IsTabStop="False"/>
              </Track.IncreaseRepeatButton>
              <Track.DecreaseRepeatButton>
                <RepeatButton Command="{x:Static ScrollBar.PageUpCommand}" Opacity="0" Focusable="False" IsTabStop="False"/>
              </Track.DecreaseRepeatButton>
            </Track>
          </Grid>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
    <Style.Triggers>
      <Trigger Property="Orientation" Value="Horizontal">
        <Setter Property="Width" Value="Auto"/>
        <Setter Property="Height" Value="10"/>
      </Trigger>
    </Style.Triggers>
  </Style>
  <Style TargetType="{x:Type TabItem}">
    <Setter Property="Foreground" Value="#CFCFCF"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type TabItem}">
          <Border x:Name="bd" Background="Transparent" CornerRadius="6" Padding="12,6" Margin="0,0,4,0">
            <ContentPresenter ContentSource="Header" HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsSelected" Value="True">
              <Setter TargetName="bd" Property="Background" Value="#33FFFFFF"/>
              <Setter Property="Foreground" Value="#FFFFFF"/>
            </Trigger>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="bd" Property="Background" Value="#22FFFFFF"/></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
</ResourceDictionary>
'@
    try { $Win.Resources = [System.Windows.Markup.XamlReader]::Parse($xaml) } catch { }
}

# Decode the app orb logo (embedded in tray.ps1 as $script:AppIconPngB64) into a WPF ImageSource,
# shared by the window's taskbar icon, the settings header and the Info tab. Frozen so it's reusable.
function New-AppIconImage {
    $ms = New-Object System.IO.MemoryStream(, [Convert]::FromBase64String($script:AppIconPngB64))
    $bi = New-Object System.Windows.Media.Imaging.BitmapImage
    $bi.BeginInit(); $bi.CacheOption = 'OnLoad'; $bi.StreamSource = $ms; $bi.EndInit(); $bi.Freeze()
    return $bi
}

# Read-only foreground-styled text line for the Info tab (New-SwText makes an editable TextBox).
function New-SwInfoText { param([string]$Text)
    $t = New-Object System.Windows.Controls.TextBlock
    $t.Text = $Text; $t.Foreground = $script:SWFore; $t.VerticalAlignment = 'Center'; $t.TextWrapping = 'Wrap'
    return $t
}

function New-SettingsWindow {
    param($Settings, $Strings, [scriptblock]$OnPreview, [scriptblock]$OnSaved, [scriptblock]$OnCancel, [scriptblock]$OnQuit)
    $script:SWFore = ConvertTo-Brush '#F2F2F2'
    $script:SWAccent = ConvertTo-Brush '#4FC3F7'
    $script:SWSettings = $Settings
    $script:SWStrings = if ($Strings) { Get-NormalizedStrings $Strings } else { Get-DefaultStrings }
    $script:SWOnPreview = $OnPreview
    $script:SWOnSaved = $OnSaved
    $script:SWOnCancel = $OnCancel
    $script:SWOnQuit = $OnQuit
    $script:SWSaved = $false

    $win = New-Object System.Windows.Window
    $win.Title = 'breathpause settings'; $win.WindowStyle = 'None'; $win.AllowsTransparency = $true
    $win.Background = [System.Windows.Media.Brushes]::Transparent
    $win.Width = 540; $win.Height = 560; $win.WindowStartupLocation = 'CenterScreen'; $win.Topmost = $true
    # Give the borderless settings window its own taskbar button (the orb overlay stays hidden from
    # the taskbar). The favicon makes it identifiable rather than a generic PowerShell-host entry.
    $win.ShowInTaskbar = $true
    try { $win.Icon = New-AppIconImage } catch { }
    Set-SwModernStyles $win

    $card = New-Object System.Windows.Controls.Border
    # Near-opaque rounded panel. We deliberately do NOT enable the rectangular DWM acrylic on this
    # window (it would paint a square frosted region behind these rounded corners); the card alone
    # gives perfectly smooth WPF-rendered rounded corners.
    $card.CornerRadius = '12'; $card.Background = (ConvertTo-Brush '#1C1C1EF7')
    $win.Content = $card
    $root = New-Object System.Windows.Controls.DockPanel
    $card.Child = $root

    # Title bar — a colored header strip (rounded to match the card top) with the app icon + title on
    # the left and Windows-style minimize/close caption buttons on the right. Drag to move.
    $barHost = New-Object System.Windows.Controls.Border
    $barHost.CornerRadius = '12,12,0,0'; $barHost.Background = (ConvertTo-Brush '#2D2D3C')
    [System.Windows.Controls.DockPanel]::SetDock($barHost, 'Top')
    $bar = New-Object System.Windows.Controls.Grid
    $bar.Height = 42; $barHost.Child = $bar
    $headerIcon = New-Object System.Windows.Controls.Image
    $headerIcon.Width = 20; $headerIcon.Height = 20; $headerIcon.Margin = '16,0,0,0'
    $headerIcon.HorizontalAlignment = 'Left'; $headerIcon.VerticalAlignment = 'Center'
    try { $headerIcon.Source = New-AppIconImage } catch { }
    $title = New-Object System.Windows.Controls.TextBlock
    $title.Text = 'breathpause'; $title.Foreground = $script:SWFore; $title.FontWeight = 'SemiBold'
    $title.FontSize = 14; $title.VerticalAlignment = 'Center'; $title.Margin = '44,0,0,0'
    # Caption buttons, right-aligned. Minimize sends the window to the taskbar; close shuts it.
    $caption = New-Object System.Windows.Controls.StackPanel
    $caption.Orientation = 'Horizontal'; $caption.HorizontalAlignment = 'Right'; $caption.VerticalAlignment = 'Top'
    $min = New-Object System.Windows.Controls.Button
    $min.Content = [char]0x2014; $min.Width = 46; $min.Height = 42
    try { $min.Style = $win.FindResource('CaptionButton') } catch { }
    $min.add_Click({ $script:SWWin.WindowState = [System.Windows.WindowState]::Minimized })
    $x = New-Object System.Windows.Controls.Button
    $x.Content = [char]0x2715; $x.Width = 46; $x.Height = 42
    try { $x.Style = $win.FindResource('CloseButton') } catch { }
    $x.add_Click({ $script:SWWin.Close() })
    [void]$caption.Children.Add($min); [void]$caption.Children.Add($x)
    [void]$bar.Children.Add($headerIcon); [void]$bar.Children.Add($title); [void]$bar.Children.Add($caption)
    $bar.add_MouseLeftButtonDown({ $script:SWWin.DragMove() })
    [void]$root.Children.Add($barHost)

    # Bottom bar: Exit on the left (quits the app, same as the tray Exit), Cancel/Save on the right.
    $bottom = New-Object System.Windows.Controls.DockPanel
    $bottom.Margin = '18'; $bottom.LastChildFill = $false
    [System.Windows.Controls.DockPanel]::SetDock($bottom, 'Bottom')
    $exit = New-Object System.Windows.Controls.Button
    $exit.Content = 'Exit'; $exit.Width = 92; $exit.Height = 32
    $exit.add_Click({ $script:SWWin.Close(); if ($script:SWOnQuit) { & $script:SWOnQuit } })
    [System.Windows.Controls.DockPanel]::SetDock($exit, 'Left')
    [void]$bottom.Children.Add($exit)
    $reset = New-Object System.Windows.Controls.Button
    $reset.Content = 'Reset'; $reset.Width = 92; $reset.Height = 32; $reset.Margin = '10,0,0,0'
    $reset.add_Click({ Reset-SettingsWindow })
    [System.Windows.Controls.DockPanel]::SetDock($reset, 'Left')
    [void]$bottom.Children.Add($reset)
    $btns = New-Object System.Windows.Controls.StackPanel
    $btns.Orientation = 'Horizontal'
    [System.Windows.Controls.DockPanel]::SetDock($btns, 'Right')
    $cancel = New-Object System.Windows.Controls.Button
    $cancel.Content = 'Cancel'; $cancel.Width = 92; $cancel.Height = 32; $cancel.IsCancel = $true
    $cancel.add_Click({ $script:SWWin.Close() })
    $save = New-Object System.Windows.Controls.Button
    $save.Content = 'Save'; $save.Width = 92; $save.Height = 32; $save.Margin = '10,0,0,0'; $save.IsDefault = $true
    $save.Background = $script:SWAccent; $save.Foreground = (ConvertTo-Brush '#10222A'); $save.FontWeight = 'SemiBold'; $save.BorderThickness = '0'
    $save.add_Click({ Save-SettingsWindow })
    [void]$btns.Children.Add($cancel); [void]$btns.Children.Add($save)
    [void]$bottom.Children.Add($btns)
    [void]$root.Children.Add($bottom)

    # Tabs — four top-level groups, each holding child tabs (nested TabControls). Children are added
    # to the right group below; the groups themselves are added to $tabs after they're populated.
    $tabs = New-Object System.Windows.Controls.TabControl
    $tabs.Margin = '14,4,14,4'; $tabs.Background = [System.Windows.Media.Brushes]::Transparent; $tabs.BorderThickness = '0'
    [void]$root.Children.Add($tabs)
    $gTiming = New-SwParentTab 'Timing'        # Timers, Patterns
    $gAppear = New-SwParentTab 'Appearance'    # Appearance, Colors, Text
    $gBehavior = New-SwParentTab 'Behavior'    # Behavior, Hotkeys
    # About is a single page, so it's a plain top-level tab (no child strip) — built as $tAbout below.

    $a = $Settings.appearance

    $tT = New-SwTab 'Timers'
    $script:SWWork = New-SwText $Settings.timers.work;       [void]$tT.panel.Children.Add((New-SwField 'Work (hh:mm)' $script:SWWork))
    $script:SWBreak = New-SwText $Settings.timers.break;     [void]$tT.panel.Children.Add((New-SwField 'Break (mm:ss)' $script:SWBreak))
    $script:SWLong = New-SwText $Settings.timers.longBreak;  [void]$tT.panel.Children.Add((New-SwField 'Long break (mm:ss)' $script:SWLong))
    $script:SWEvery = New-SwText ([string]$Settings.cycle.longBreakEvery) 60; [void]$tT.panel.Children.Add((New-SwField 'Long break every N (0 = off)' $script:SWEvery))
    [void]$gTiming.tabs.Items.Add($tT.tab)

    $tA = New-SwTab 'Appearance'
    $so = New-SwSlider 0.1 1 ([double]$a.opacity) 'pct'; $script:SWOpacity = $so.slider; [void]$tA.panel.Children.Add((New-SwField 'Opacity' $so.row))
    # Slider bounds widen to fit out-of-range stored values so opening + saving never silently
    # shrinks a hand-edited orb (core allows up to 2000/4000; the UI default range is 20-600).
    $dMin = [math]::Min(20, [math]::Min([double]$a.collapsedDiameterPx, [double]$a.expandedDiameterPx))
    $dMax = [math]::Max(600, [double]$a.expandedDiameterPx)
    $sd = New-SwRangeSlider $dMin $dMax ([double]$a.collapsedDiameterPx) ([double]$a.expandedDiameterPx) 'px'; $script:SWDiameter = $sd.control; [void]$tA.panel.Children.Add((New-SwField 'Orb diameter (collapsed-expanded)' $sd.row))
    $sb2 = New-SwSlider 5 100 ([double]$a.breakSizePctScreenHeight) 'pct100'; $script:SWBreakPct = $sb2.slider; [void]$tA.panel.Children.Add((New-SwField 'Break size (% screen height)' $sb2.row))
    # Orb position = its top-right corner, px from the screen's top-right (resizing keeps it fixed). Applies on Save.
    $script:SWPosRight = New-SwText ([string]$Settings.position.fromRight) 60; [void]$tA.panel.Children.Add((New-SwField 'Distance from right (px)' $script:SWPosRight))
    $script:SWPosTop = New-SwText ([string]$Settings.position.fromTop) 60; [void]$tA.panel.Children.Add((New-SwField 'Distance from top (px)' $script:SWPosTop))
    $script:SWShowLabel = New-SwCheck 'Show phase label' ([bool]$a.showLabel); [void]$tA.panel.Children.Add($script:SWShowLabel)
    $script:SWShowPhase = New-SwCheck 'Show phase countdown' ([bool]$a.showPhaseCountdown); [void]$tA.panel.Children.Add($script:SWShowPhase)
    $script:SWShowPomo = New-SwCheck 'Show pomodoro time' ([bool]$a.showRemainingTimeUnderBubble); [void]$tA.panel.Children.Add($script:SWShowPomo)
    $script:SWShowLong = New-SwCheck 'Show sessions until long break' ([bool]$a.showLongBreakCountdown); [void]$tA.panel.Children.Add($script:SWShowLong)
    [void]$gAppear.tabs.Items.Add($tA.tab)

    $tF = New-SwTab 'Font'
    $script:SWFontFamily = New-SwFontCombo $a.font.family; [void]$tF.panel.Children.Add((New-SwField 'Font family' $script:SWFontFamily))
    $sf = New-SwSlider 8 72 ([double]$a.font.size) 'int'; $script:SWFontSize = $sf.slider; [void]$tF.panel.Children.Add((New-SwField 'Phase label size' $sf.row))
    $sc = New-SwSlider 8 72 ([double]$a.font.countdownSize) 'int'; $script:SWCountdownSize = $sc.slider; [void]$tF.panel.Children.Add((New-SwField 'Phase countdown size' $sc.row))
    $sp = New-SwSlider 8 72 ([double]$a.font.pomodoroSize) 'int'; $script:SWPomoSize = $sp.slider; [void]$tF.panel.Children.Add((New-SwField 'Pomodoro time size' $sp.row))
    [void]$gAppear.tabs.Items.Add($tF.tab)

    $tC = New-SwTab 'Colors'
    $script:SWWorkFill = New-SwColorRow $tC.panel 'Work fill' $a.colors.workFill
    $script:SWBreakFill = New-SwColorRow $tC.panel 'Break fill' $a.colors.breakFill
    $script:SWTextColor = New-SwColorRow $tC.panel 'Text' $a.colors.text
    [void]$gAppear.tabs.Items.Add($tC.tab)

    $tP = New-SwTab 'Patterns'
    $script:SWWorkPhases = New-SwPhaseEditor $tP.panel 'Work pattern' (Get-WorkPattern $Settings)
    $script:SWBreakPhases = New-SwPhaseEditor $tP.panel 'Break pattern' (Get-BreakPattern $Settings)
    [void]$gTiming.tabs.Items.Add($tP.tab)

    $tB = New-SwTab 'Behavior'
    $script:SWAuto = New-SwCheck 'Auto-start timer on launch' ([bool]$Settings.behavior.autoStartTimerOnLaunch); [void]$tB.panel.Children.Add($script:SWAuto)
    $script:SWAutoCont = New-SwCheck 'Auto-continue to next segment (off = wait for Resume)' ([bool]$Settings.cycle.autoContinue); [void]$tB.panel.Children.Add($script:SWAutoCont)
    $script:SWBoot = New-SwCheck 'Start on boot' ([bool]$Settings.behavior.startOnBoot); [void]$tB.panel.Children.Add($script:SWBoot)
    $script:SWSingle = New-SwCheck 'Single instance' ([bool]$Settings.behavior.singleInstance); [void]$tB.panel.Children.Add($script:SWSingle)
    $script:SWSound = New-SwCheck 'Chime on transitions' ([bool]$Settings.sound.enabled); [void]$tB.panel.Children.Add($script:SWSound)
    [void]$gBehavior.tabs.Items.Add($tB.tab)

    $tH = New-SwTab 'Hotkeys'
    $script:SWHkStartStop = New-SwHotkeyRow $tH.panel 'Start / Stop timer' $Settings.hotkeys.startStop
    $script:SWHkPause = New-SwHotkeyRow $tH.panel 'Pause / Resume' $Settings.hotkeys.pauseResume
    $script:SWHkSkip = New-SwHotkeyRow $tH.panel 'Skip' $Settings.hotkeys.skip
    $script:SWHkSettings = New-SwHotkeyRow $tH.panel 'Open settings' $Settings.hotkeys.settings
    [void]$gBehavior.tabs.Items.Add($tH.tab)

    # Text tab — every user-facing label, saved to strings.json (separate from settings.json) so
    # the wording can be translated independently. Previews live.
    $tTx = New-SwTab 'Text'
    $script:SWStrBoxes = @{}
    $strDefs = @(
        @{ g = 'tray'; k = 'startTimer'; label = 'Tray: Start timer' }
        @{ g = 'tray'; k = 'stopTimer'; label = 'Tray: Stop timer' }
        @{ g = 'tray'; k = 'pause'; label = 'Tray: Pause' }
        @{ g = 'tray'; k = 'resume'; label = 'Tray: Resume' }
        @{ g = 'tray'; k = 'skip'; label = 'Tray: Skip' }
        @{ g = 'tray'; k = 'settings'; label = 'Tray: Settings' }
        @{ g = 'tray'; k = 'exit'; label = 'Tray: Exit' }
        @{ g = 'break'; k = 'endBreak'; label = 'Break: End-break button' }
        @{ g = 'break'; k = 'confirmTitle'; label = 'Break: Confirm title' }
        @{ g = 'break'; k = 'confirmMessage'; label = 'Break: Confirm message' }
        @{ g = 'break'; k = 'cancel'; label = 'Break: Cancel button' }
    )
    foreach ($def in $strDefs) {
        $box = New-SwText ([string]$script:SWStrings[$def.g][$def.k]) 200
        $box.add_TextChanged({ Invoke-SwPreview })
        $script:SWStrBoxes["$($def.g).$($def.k)"] = $box
        [void]$tTx.panel.Children.Add((New-SwField $def.label $box))
    }
    [void]$gAppear.tabs.Items.Add($tTx.tab)

    # About — app icon, version, license and the GitHub source. Plain top-level tab; static, no preview.
    $tAbout = New-SwTab 'About'
    $infoIcon = New-Object System.Windows.Controls.Image
    $infoIcon.Width = 72; $infoIcon.Height = 72; $infoIcon.HorizontalAlignment = 'Center'; $infoIcon.Margin = '0,10,0,10'
    try { $infoIcon.Source = New-AppIconImage } catch { }
    [void]$tAbout.panel.Children.Add($infoIcon)
    $infoName = New-SwInfoText 'breathpause'
    $infoName.FontSize = 20; $infoName.FontWeight = 'SemiBold'; $infoName.HorizontalAlignment = 'Center'; $infoName.TextAlignment = 'Center'
    [void]$tAbout.panel.Children.Add($infoName)
    $infoVer = New-SwInfoText ('Version ' + (Get-AppVersion))
    $infoVer.Opacity = 0.6; $infoVer.FontSize = 12; $infoVer.HorizontalAlignment = 'Center'; $infoVer.TextAlignment = 'Center'; $infoVer.Margin = '0,2,0,16'
    [void]$tAbout.panel.Children.Add($infoVer)
    $infoTag = New-SwInfoText 'An always-on-top breathing bubble that paces your focus sessions — native, zero dependencies, no Electron.'
    $infoTag.TextAlignment = 'Center'; $infoTag.Opacity = 0.8; $infoTag.FontSize = 12; $infoTag.Margin = '0,0,0,14'
    [void]$tAbout.panel.Children.Add($infoTag)
    [void]$tAbout.panel.Children.Add((New-SwField 'Made by' (New-SwInfoText 'Markus Wildgruber')))
    [void]$tAbout.panel.Children.Add((New-SwField 'License' (New-SwInfoText 'MIT License — © 2026 Markus Wildgruber')))
    # Clickable GitHub source (opens in the default browser).
    $linkBlock = New-Object System.Windows.Controls.TextBlock
    $linkBlock.VerticalAlignment = 'Center'
    $link = New-Object System.Windows.Documents.Hyperlink
    $link.NavigateUri = [uri]'https://github.com/Markus-Wildgruber/breathpause'
    $link.Foreground = $script:SWAccent
    $link.add_RequestNavigate({ try { Start-Process $args[1].Uri.AbsoluteUri } catch { }; $args[1].Handled = $true })
    [void]$link.Inlines.Add('github.com/Markus-Wildgruber/breathpause')
    [void]$linkBlock.Inlines.Add($link)
    [void]$tAbout.panel.Children.Add((New-SwField 'Source' $linkBlock))

    # Add the populated groups + the About page to the top-level tab strip, in order.
    [void]$tabs.Items.Add($gTiming.tab); [void]$tabs.Items.Add($gAppear.tab)
    [void]$tabs.Items.Add($gBehavior.tab); [void]$tabs.Items.Add($tAbout.tab)

    # Wire live preview on every input change.
    $script:SWWork.add_TextChanged({ Invoke-SwPreview }); $script:SWBreak.add_TextChanged({ Invoke-SwPreview })
    $script:SWLong.add_TextChanged({ Invoke-SwPreview }); $script:SWEvery.add_TextChanged({ Invoke-SwPreview })
    $script:SWOpacity.add_ValueChanged({ Invoke-SwPreview }); $script:SWBreakPct.add_ValueChanged({ Invoke-SwPreview })
    $script:SWPosRight.add_TextChanged({ Invoke-SwPreview }); $script:SWPosTop.add_TextChanged({ Invoke-SwPreview })   # position previews live
    $script:SWFontSize.add_ValueChanged({ Invoke-SwPreview })
    $script:SWCountdownSize.add_ValueChanged({ Invoke-SwPreview }); $script:SWPomoSize.add_ValueChanged({ Invoke-SwPreview })
    $script:SWFontFamily.add_SelectionChanged({ Invoke-SwPreview })   # font family previews live too
    # Orb-diameter range slider previews live via its own thumb-drag handler.
    foreach ($cb in @($script:SWShowLabel, $script:SWShowPhase, $script:SWShowPomo, $script:SWShowLong, $script:SWAuto, $script:SWAutoCont, $script:SWBoot, $script:SWSingle, $script:SWSound)) {
        $cb.add_Click({ Invoke-SwPreview })
    }

    # No DWM acrylic here on purpose — see the $card comment above (keeps the corners truly round).
    # Revert the live preview if closed without saving.
    $win.add_Closing({ if (-not $script:SWSaved -and $script:SWOnCancel) { & $script:SWOnCancel } })

    $script:SWWin = $win
    return $win
}

function Show-SettingsWindow {
    param($Settings, $Strings, [scriptblock]$OnPreview, [scriptblock]$OnSaved, [scriptblock]$OnCancel, [scriptblock]$OnQuit)
    $w = New-SettingsWindow $Settings $Strings $OnPreview $OnSaved $OnCancel $OnQuit
    [void]$w.ShowDialog()
}

function Save-SettingsWindow {
    $script:SWSaved = $true
    if ($script:SWOnSaved) { & $script:SWOnSaved (Get-SwValues) (Get-SwStrings) }
    $script:SWWin.Close()
}

# Restore factory-default settings (settings.json only; custom Text/strings are kept). Destructive
# and immediate, so confirm first; reuses the Save path so it persists and applies live.
function Reset-SettingsWindow {
    $r = [System.Windows.MessageBox]::Show('Reset all settings to defaults? Your custom text is kept.', 'breathpause', 'YesNo', 'Warning')
    if ($r -ne [System.Windows.MessageBoxResult]::Yes) { return }
    $script:SWSaved = $true
    if ($script:SWOnSaved) { & $script:SWOnSaved (Get-DefaultSettings) $null }
    $script:SWWin.Close()
}
