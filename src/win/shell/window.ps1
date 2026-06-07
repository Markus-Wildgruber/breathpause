# shell/window — always-on-top translucent bubble + DWM acrylic blur. WPF. (SPEC §3,§4,§5)
# ⚠️ UNVERIFIED SCAFFOLDING — written without Windows. The WPF + DWM P/Invoke here is
#    plausible but UNTESTED. Known risk: acrylic may degrade to a flat tint on a large/
#    fullscreen window (SPEC §1) — validate on real Windows.

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms, System.Drawing

if (-not ('BPNative' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BPNative {
    [StructLayout(LayoutKind.Sequential)]
    struct AccentPolicy { public int AccentState; public int AccentFlags; public uint GradientColor; public int AnimationId; }
    [StructLayout(LayoutKind.Sequential)]
    struct WinCompAttrData { public int Attribute; public IntPtr Data; public int SizeOfData; }
    [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WinCompAttrData data);
    [DllImport("user32.dll", SetLastError=true)] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);

    const int WCA_ACCENT_POLICY = 19;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TRANSPARENT = 0x20;
    const int WS_EX_TOOLWINDOW = 0x80;
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;

    static void Apply(IntPtr hwnd, int state, uint gradient) {
        var accent = new AccentPolicy { AccentState = state, AccentFlags = 2, GradientColor = gradient };
        int size = Marshal.SizeOf(accent);
        IntPtr ptr = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(accent, ptr, false);
        var data = new WinCompAttrData { Attribute = WCA_ACCENT_POLICY, SizeOfData = size, Data = ptr };
        SetWindowCompositionAttribute(hwnd, ref data);
        Marshal.FreeHGlobal(ptr);
    }
    public static void EnableBlur(IntPtr hwnd, uint gradient) { Apply(hwnd, 4, gradient); } // ACRYLIC
    public static void DisableBlur(IntPtr hwnd) { Apply(hwnd, 0, 0); }                       // DISABLED
    public static void SetClickThrough(IntPtr hwnd, bool on) {
        int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        if (on) ex |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW;
        else ex = (ex & ~WS_EX_TRANSPARENT) | WS_EX_TOOLWINDOW;
        SetWindowLong(hwnd, GWL_EXSTYLE, ex);
    }
    // Re-place the window in the topmost band. WPF's Topmost property silently drops out of the
    // band when another app launches and grabs foreground; SWP_NOACTIVATE pops us back on top
    // without stealing focus. (SPEC §3 always-on-top.)
    public static void AssertTopmost(IntPtr hwnd) {
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    }
}
'@
}

# "#RRGGBB" / "#RRGGBBAA" -> SolidColorBrush.
function ConvertTo-Brush {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    $r = [Convert]::ToByte($h.Substring(0, 2), 16)
    $g = [Convert]::ToByte($h.Substring(2, 2), 16)
    $b = [Convert]::ToByte($h.Substring(4, 2), 16)
    $a = if ($h.Length -ge 8) { [Convert]::ToByte($h.Substring(6, 2), 16) } else { 255 }
    $col = [System.Windows.Media.Color]::FromArgb($a, $r, $g, $b)
    return (New-Object System.Windows.Media.SolidColorBrush($col))
}

# "#RRGGBB(AA)" -> System.Windows.Media.Color.
function Get-MediaColor {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    $r = [Convert]::ToByte($h.Substring(0, 2), 16)
    $g = [Convert]::ToByte($h.Substring(2, 2), 16)
    $b = [Convert]::ToByte($h.Substring(4, 2), 16)
    $a = if ($h.Length -ge 8) { [Convert]::ToByte($h.Substring(6, 2), 16) } else { 255 }
    return [System.Windows.Media.Color]::FromArgb($a, $r, $g, $b)
}

function Get-ByteClamped { param([double]$V) return [byte][math]::Max(0, [math]::Min(255, [math]::Round($V))) }

# Factor > 1 lightens toward white; < 1 darkens toward black.
function Get-ShiftedColor {
    param($C, [double]$Factor)
    if ($Factor -ge 1) {
        $t = $Factor - 1
        $r = $C.R + (255 - $C.R) * $t; $g = $C.G + (255 - $C.G) * $t; $b = $C.B + (255 - $C.B) * $t
    }
    else { $r = $C.R * $Factor; $g = $C.G * $Factor; $b = $C.B * $Factor }
    return [System.Windows.Media.Color]::FromArgb($C.A, (Get-ByteClamped $r), (Get-ByteClamped $g), (Get-ByteClamped $b))
}

# Frosted glassy sphere: radial gradient (highlight -> base -> rim) + a soft colored outer glow.
function Set-BubbleColor {
    param([string]$Hex)
    $base = Get-MediaColor $Hex
    $light = Get-ShiftedColor $base 1.5
    $dark = Get-ShiftedColor $base 0.68
    $rg = New-Object System.Windows.Media.RadialGradientBrush
    $rg.GradientOrigin = New-Object System.Windows.Point(0.35, 0.3)   # offset highlight = 3D look
    $rg.Center = New-Object System.Windows.Point(0.5, 0.5)
    $rg.RadiusX = 0.72; $rg.RadiusY = 0.72
    [void]$rg.GradientStops.Add((New-Object System.Windows.Media.GradientStop($light, 0.0)))
    [void]$rg.GradientStops.Add((New-Object System.Windows.Media.GradientStop($base, 0.62)))
    [void]$rg.GradientStops.Add((New-Object System.Windows.Media.GradientStop($dark, 1.0)))
    $script:Ellipse.Fill = $rg
    if ($script:Glow) { $script:Glow.Color = $base }
}

# Readable text color (dark on light fills, light on dark) for buttons tinted by a fill.
function Get-ContrastText {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16); $g = [Convert]::ToInt32($h.Substring(2, 2), 16); $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    $lum = (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255
    if ($lum -gt 0.6) { return '#10200F' } else { return '#F2F2F2' }
}

# Rounded implicit Button style for the bubble window (break/close + dialog buttons).
function Set-WindowButtonStyle {
    param($Win)
    $xaml = @'
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style TargetType="{x:Type Button}">
    <Setter Property="Foreground" Value="#F2F2F2"/>
    <Setter Property="Background" Value="#33FFFFFF"/>
    <Setter Property="BorderThickness" Value="0"/>
    <Setter Property="Padding" Value="16,7"/>
    <Setter Property="Cursor" Value="Hand"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="{x:Type Button}">
          <Border x:Name="bd" CornerRadius="9" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
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
</ResourceDictionary>
'@
    try { $Win.Resources = [System.Windows.Markup.XamlReader]::Parse($xaml) } catch { }
}

# "#RRGGBBAA" -> DWM gradient color 0xAABBGGRR.
function Get-AccentColor {
    param([string]$Hex)
    $h = $Hex.TrimStart('#')
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    $a = if ($h.Length -ge 8) { [Convert]::ToInt32($h.Substring(6, 2), 16) } else { 204 }
    # Build in [long] then cast: 0xAABBGGRR > Int32.Max, and Windows PowerShell 5.1 treats
    # large hex/int literals as signed Int32, so naive math overflows to a negative value
    # that cannot cast to [uint32].
    $val = ([long]$a -shl 24) -bor ([long]$b -shl 16) -bor ([long]$g -shl 8) -bor [long]$r
    return [uint32]$val
}

function New-BubbleWindow {
    param($Settings)
    $script:Appearance = $Settings.appearance
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $script:ScreenW = $b.Width
    $script:ScreenH = $b.Height

    $win = New-Object System.Windows.Window
    $win.WindowStyle = 'None'
    $win.AllowsTransparency = $true
    $win.Background = [System.Windows.Media.Brushes]::Transparent
    $win.Topmost = $true
    $win.ShowInTaskbar = $false
    $win.ResizeMode = 'NoResize'
    Set-WindowButtonStyle $win   # rounded break/close + dialog buttons

    $script:FontSize = [double]$script:Appearance.font.size
    $script:CountdownSize = [double]$script:Appearance.font.countdownSize
    $script:PomoSize = [double]$script:Appearance.font.pomodoroSize
    $ff = New-Object System.Windows.Media.FontFamily([string]$script:Appearance.font.family)
    $textBrush = ConvertTo-Brush $script:Appearance.colors.text
    $str = if ($script:Strings) { $script:Strings } else { Get-DefaultStrings }

    $canvas = New-Object System.Windows.Controls.Canvas

    # Break backdrop = a blurred snapshot of the real desktop (captured in Set-BreakMode) + a
    # dimming tint on top. Bottom-most layers; hidden in work mode. (DWM acrylic degrades to a
    # flat tint on fullscreen windows, so we blur a screen capture instead.)
    $blurImage = New-Object System.Windows.Controls.Image
    $blurImage.Stretch = 'Fill'; $blurImage.Visibility = 'Collapsed'
    $be = New-Object System.Windows.Media.Effects.BlurEffect; $be.Radius = 28; $blurImage.Effect = $be
    $tintRect = New-Object System.Windows.Shapes.Rectangle
    $tintRect.Visibility = 'Collapsed'
    [void]$canvas.Children.Add($blurImage)
    [void]$canvas.Children.Add($tintRect)

    # Frosted glassy orb: an ellipse filled by a radial gradient (set in Set-BubbleColor) with
    # a soft colored outer glow (DropShadowEffect, no offset). All built-in WPF.
    $ellipse = New-Object System.Windows.Shapes.Ellipse
    $ellipse.Opacity = [double]$script:Appearance.opacity
    $glow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $glow.ShadowDepth = 0; $glow.BlurRadius = 38; $glow.Opacity = 0.85
    $ellipse.Effect = $glow

    # Three centered text lines (top->bottom, decreasing size): label / phase-time / pomodoro.
    $label = New-Object System.Windows.Controls.TextBlock
    $label.TextAlignment = 'Center'; $label.FontFamily = $ff; $label.FontSize = $script:FontSize
    $label.FontWeight = 'SemiBold'; $label.Foreground = $textBrush
    $phase = New-Object System.Windows.Controls.TextBlock
    $phase.TextAlignment = 'Center'; $phase.FontFamily = $ff; $phase.FontSize = $script:CountdownSize
    $phase.Foreground = $textBrush
    $pomo = New-Object System.Windows.Controls.TextBlock
    $pomo.TextAlignment = 'Center'; $pomo.FontFamily = $ff; $pomo.FontSize = $script:PomoSize
    $pomo.Opacity = 0.85; $pomo.Foreground = $textBrush

    # Close button — only visible during a break (SPEC §5).
    $closeBtn = New-Object System.Windows.Controls.Button
    $closeBtn.Content = $str.break.endBreak
    $closeBtn.Width = 130; $closeBtn.Height = 30
    $closeBtn.Visibility = 'Collapsed'
    $closeBtn.add_Click({ Invoke-CloseBreakConfirm })

    # Gear - shown on hover, opens settings (SPEC §4). A TextBlock (not a Button) so there is
    # no hover-highlight box; hover feedback is opacity only. Glyph 0x2699 built at runtime.
    $gear = New-Object System.Windows.Controls.TextBlock
    $gear.Text = [char]0x2699
    $gear.FontSize = 16
    $gear.Foreground = ConvertTo-Brush '#CCCCCC'   # gear color
    $gear.Opacity = 0.55
    $gear.Cursor = [System.Windows.Input.Cursors]::Hand
    $gear.Background = [System.Windows.Media.Brushes]::Transparent  # make the whole box hit-testable
    $gear.Width = 26; $gear.Height = 26; $gear.TextAlignment = 'Center'; $gear.Padding = '0,2,0,0'
    $gear.Visibility = 'Collapsed'
    $gear.add_MouseLeftButtonUp({ if ($script:OnGear) { & $script:OnGear } })
    $gear.add_MouseEnter({ $args[0].Opacity = 1.0 })
    $gear.add_MouseLeave({ $args[0].Opacity = 0.55 })

    # Frosted "end the break?" card drawn on the break overlay (replaces the system MessageBox).
    $card = New-Object System.Windows.Controls.Border
    $card.Width = 360; $card.Height = 168; $card.CornerRadius = '12'
    $card.Background = (ConvertTo-Brush '#24242CF2'); $card.Visibility = 'Collapsed'
    $cardStack = New-Object System.Windows.Controls.StackPanel
    $cardStack.Margin = '24'; $card.Child = $cardStack
    $ctitle = New-Object System.Windows.Controls.TextBlock
    $ctitle.Text = $str.break.confirmTitle; $ctitle.Foreground = $textBrush; $ctitle.FontSize = 17; $ctitle.FontWeight = 'SemiBold'
    $cmsg = New-Object System.Windows.Controls.TextBlock
    $cmsg.Text = $str.break.confirmMessage; $cmsg.Foreground = $textBrush; $cmsg.Opacity = 0.8
    $cmsg.TextWrapping = 'Wrap'; $cmsg.Margin = '0,8,0,20'
    $crow = New-Object System.Windows.Controls.StackPanel
    $crow.Orientation = 'Horizontal'; $crow.HorizontalAlignment = 'Right'
    $cCancel = New-Object System.Windows.Controls.Button
    $cCancel.Content = $str.break.cancel; $cCancel.Width = 92; $cCancel.Height = 32
    $cCancel.add_Click({ Hide-CloseCard })
    $cEnd = New-Object System.Windows.Controls.Button
    $cEnd.Content = $str.break.endBreak; $cEnd.Width = 110; $cEnd.Height = 32; $cEnd.Margin = '10,0,0,0'
    $cEnd.Background = (ConvertTo-Brush '#81C784'); $cEnd.Foreground = (ConvertTo-Brush '#10200F'); $cEnd.FontWeight = 'SemiBold'; $cEnd.BorderThickness = '0'
    $cEnd.add_Click({ Hide-CloseCard; if ($script:OnCloseBreak) { & $script:OnCloseBreak } })
    $script:CardEndBtn = $cEnd   # recolored to the break-bubble color in Set-BreakMode
    [void]$crow.Children.Add($cCancel); [void]$crow.Children.Add($cEnd)
    [void]$cardStack.Children.Add($ctitle); [void]$cardStack.Children.Add($cmsg); [void]$cardStack.Children.Add($crow)

    [void]$canvas.Children.Add($ellipse)
    [void]$canvas.Children.Add($label)
    [void]$canvas.Children.Add($phase)
    [void]$canvas.Children.Add($pomo)
    [void]$canvas.Children.Add($closeBtn)
    [void]$canvas.Children.Add($gear)
    [void]$canvas.Children.Add($card)
    $win.Content = $canvas

    # (Esc-to-close is polled system-wide in the frame loop - see main.ps1 - because a
    #  borderless window rarely holds keyboard focus for PreviewKeyDown.)

    $win.Add_SourceInitialized({
            $script:Hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($script:Win)).Handle
            [BPNative]::SetClickThrough($script:Hwnd, $true)
        })

    $script:Win = $win
    $script:Canvas = $canvas
    $script:Ellipse = $ellipse
    $script:Glow = $glow
    # Transparent padding around the orb so the glow isn't clipped by the window edge.
    $script:GlowMargin = [double]$glow.BlurRadius + 12
    $script:Label = $label
    $script:Phase = $phase
    $script:Pomo = $pomo
    $script:CloseBtn = $closeBtn
    $script:ConfirmTitle = $ctitle
    $script:ConfirmMsg = $cmsg
    $script:ConfirmCancel = $cCancel
    $script:Gear = $gear
    $script:CloseCard = $card
    $script:CloseCardVisible = $false
    $script:BlurImage = $blurImage
    $script:TintRect = $tintRect
    $script:GearLeft = 0; $script:GearTop = 0; $script:GearSize = 30
    $script:BreakActive = $false
    $script:ClickThroughState = $true

    $win.Show()
    Set-WorkMode $Settings
}

# Toggle the frosted confirmation card (SPEC §5). Esc/close-button calls this: show if hidden,
# hide (= cancel) if already showing.
function Invoke-CloseBreakConfirm {
    if ($script:CloseCardVisible) { Hide-CloseCard } else { Show-CloseCard }
}
function Show-CloseCard {
    if (-not $script:CloseCard) { return }
    [System.Windows.Controls.Canvas]::SetLeft($script:CloseCard, ([double]$script:Win.Width - 360) / 2)
    [System.Windows.Controls.Canvas]::SetTop($script:CloseCard, ([double]$script:Win.Height - 168) / 2)
    $script:CloseCard.Visibility = 'Visible'; $script:CloseCardVisible = $true
}
function Hide-CloseCard {
    if ($script:CloseCard) { $script:CloseCard.Visibility = 'Collapsed' }
    $script:CloseCardVisible = $false
}

# Apply user-facing text (strings.json) to the break overlay + confirm card. CardEndBtn shares
# the "End break" string with the on-screen close button.
function Set-WindowStrings {
    param($Strings)
    if ($script:CloseBtn) { $script:CloseBtn.Content = $Strings.break.endBreak }
    if ($script:CardEndBtn) { $script:CardEndBtn.Content = $Strings.break.endBreak }
    if ($script:ConfirmTitle) { $script:ConfirmTitle.Text = $Strings.break.confirmTitle }
    if ($script:ConfirmMsg) { $script:ConfirmMsg.Text = $Strings.break.confirmMessage }
    if ($script:ConfirmCancel) { $script:ConfirmCancel.Content = $Strings.break.cancel }
}

function Set-CloseBreakHandler { param($Fn) $script:OnCloseBreak = $Fn }
function Set-GearHandler { param($Fn) $script:OnGear = $Fn }
function Set-GearVisible { param([bool]$V) if ($script:Gear) { $script:Gear.Visibility = if ($V) { 'Visible' } else { 'Collapsed' } } }

# Capture the primary screen into a frozen WPF image source (blurred at display time).
function Get-ScreenCapture {
    $bmp = New-Object System.Drawing.Bitmap([int]$script:ScreenW, [int]$script:ScreenH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size([int]$script:ScreenW, [int]$script:ScreenH)))
    $g.Dispose()
    $hbmp = $bmp.GetHbitmap()
    try {
        $src = [System.Windows.Interop.Imaging]::CreateBitmapSourceFromHBitmap(
            $hbmp, [IntPtr]::Zero, [System.Windows.Int32Rect]::Empty,
            [System.Windows.Media.Imaging.BitmapSizeOptions]::FromEmptyOptions())
    }
    finally { [void][BPNative]::DeleteObject($hbmp); $bmp.Dispose() }
    $src.Freeze()
    return $src
}

# Refresh the live appearance source (used by Update-Bubble) after a settings save / preview.
# Opacity, text colour and the bubble text font family + sizes all update immediately.
function Set-Appearance {
    param($Settings)
    $script:Appearance = $Settings.appearance
    $script:FontSize = [double]$Settings.appearance.font.size
    $script:CountdownSize = [double]$Settings.appearance.font.countdownSize
    $script:PomoSize = [double]$Settings.appearance.font.pomodoroSize
    if ($script:Ellipse) { $script:Ellipse.Opacity = [double]$Settings.appearance.opacity }
    $tb = ConvertTo-Brush $Settings.appearance.colors.text
    $ff = New-Object System.Windows.Media.FontFamily([string]$Settings.appearance.font.family)
    # Font family/sizes are live-settable — update the text blocks so they preview immediately.
    if ($script:Label) { $script:Label.Foreground = $tb; $script:Label.FontFamily = $ff; $script:Label.FontSize = $script:FontSize }
    if ($script:Phase) { $script:Phase.Foreground = $tb; $script:Phase.FontFamily = $ff; $script:Phase.FontSize = $script:CountdownSize }
    if ($script:Pomo) { $script:Pomo.Foreground = $tb; $script:Pomo.FontFamily = $ff; $script:Pomo.FontSize = $script:PomoSize }
}

function Set-WindowOrigin { param([double]$X, [double]$Y) $script:Win.Left = $X; $script:Win.Top = $Y }
function Get-WindowOrigin { return @{ x = $script:Win.Left; y = $script:Win.Top } }

# Device scale (1.0 = 100%, 1.25 = 125%, ...). WPF coords are DIPs; MousePosition is physical px.
function Get-DpiScale {
    try {
        $src = [System.Windows.PresentationSource]::FromVisual($script:Win)
        if ($src -and $src.CompositionTarget) { return [double]$src.CompositionTarget.TransformToDevice.M11 }
    }
    catch { }
    return 1.0
}

# Position so the ORB's top-right corner sits ($FromRight, $FromTop) px from the screen's top-right
# corner. The window is $GlowMargin larger than the orb on each side (transparent glow padding that
# spills off-screen), so anchoring the orb's top-right keeps that pixel fixed when the orb resizes.
function Set-OrbAnchor {
    param([double]$FromRight, [double]$FromTop)
    $left = $script:ScreenW - $FromRight + $script:GlowMargin - $script:Win.Width
    $top = $FromTop - $script:GlowMargin
    Set-WindowOrigin $left $top
}

# Inverse of Set-OrbAnchor: read the orb's current top-right offset from the live window geometry
# (used to persist a Ctrl+drag). Only valid in work mode — the break window is fullscreen.
function Get-OrbAnchor {
    return @{
        fromRight = $script:ScreenW - $script:Win.Left - $script:Win.Width + $script:GlowMargin
        fromTop   = $script:Win.Top + $script:GlowMargin
    }
}

function Set-WorkMode {
    param($Settings)
    $script:BreakActive = $false
    if ($script:CloseBtn) { $script:CloseBtn.Visibility = 'Collapsed' }
    if ($script:BlurImage) { $script:BlurImage.Visibility = 'Collapsed'; $script:BlurImage.Source = $null }
    if ($script:TintRect) { $script:TintRect.Visibility = 'Collapsed' }
    Hide-CloseCard
    Set-ClickThrough $true
    $script:ClickThroughState = $true
    if ($script:Hwnd) { [BPNative]::DisableBlur($script:Hwnd) }
    if ($script:Ellipse) { $script:Ellipse.Opacity = [double]$Settings.appearance.opacity }
    Set-BubbleColor $Settings.appearance.colors.workFill
    # Window is the max orb + glow margin on every side, so the fully-expanded orb's glow fits.
    $d = [double]$Settings.appearance.expandedDiameterPx + 2 * $script:GlowMargin
    $script:Win.Width = $d; $script:Win.Height = $d
    Set-OrbAnchor ([double]$Settings.position.fromRight) ([double]$Settings.position.fromTop)
}

function Set-BreakMode {
    param($Settings)
    $script:BreakActive = $true
    Set-BubbleColor $Settings.appearance.colors.breakFill
    # End-break buttons (break screen + confirm dialog) take the break-bubble color.
    $bf = ConvertTo-Brush $Settings.appearance.colors.breakFill
    $bft = ConvertTo-Brush (Get-ContrastText $Settings.appearance.colors.breakFill)
    if ($script:CloseBtn) { $script:CloseBtn.Background = $bf; $script:CloseBtn.Foreground = $bft }
    if ($script:CardEndBtn) { $script:CardEndBtn.Background = $bf; $script:CardEndBtn.Foreground = $bft }

    # Capture the desktop WITHOUT our window, then show a blurred copy as the backdrop so the
    # real current screen appears blurred (not a flat overlay).
    $script:Win.Hide()
    try { [System.Windows.Forms.Application]::DoEvents() } catch { }  # let the desktop repaint
    $src = $null
    try { $src = Get-ScreenCapture } catch { }
    if ($src) { $script:BlurImage.Source = $src; $script:BlurImage.Visibility = 'Visible' }
    $script:TintRect.Visibility = 'Collapsed'   # break is just blur — no color tint overlay

    Set-WindowOrigin 0 0
    $script:Win.Width = $script:ScreenW; $script:Win.Height = $script:ScreenH
    $script:BlurImage.Width = $script:ScreenW; $script:BlurImage.Height = $script:ScreenH
    [System.Windows.Controls.Canvas]::SetLeft($script:BlurImage, 0); [System.Windows.Controls.Canvas]::SetTop($script:BlurImage, 0)
    if ($script:Hwnd) { [BPNative]::DisableBlur($script:Hwnd) }   # captured-blur replaces DWM acrylic

    Set-ClickThrough $false        # capture input during the break (SPEC §5)
    $script:ClickThroughState = $false
    if ($script:Gear) { $script:Gear.Visibility = 'Collapsed' }
    $script:Win.Show()
    $script:Win.Activate() | Out-Null
    Set-Topmost   # force the overlay above any open (settings-owned) dialog so the break stays endable
    if ($script:CloseBtn) {
        [System.Windows.Controls.Canvas]::SetLeft($script:CloseBtn, $script:ScreenW - 150)
        [System.Windows.Controls.Canvas]::SetTop($script:CloseBtn, 20)
        $script:CloseBtn.Visibility = 'Visible'
    }
}

# Draw one frame. $Size 0..1. Three centered lines: $LabelText / $PhaseText / $PomoText,
# each shown per its appearance toggle (showLabel / showPhaseCountdown / showRemainingTimeUnderBubble).
function Update-Bubble {
    param([string]$Mode, [double]$Size, [string]$LabelText, [string]$PhaseText, [string]$PomoText)
    $collapsed = [double]$script:Appearance.collapsedDiameterPx
    $expanded = if ($Mode -eq 'break') { $script:ScreenH * ([double]$script:Appearance.breakSizePctScreenHeight / 100) }
    else { [double]$script:Appearance.expandedDiameterPx }
    $dia = $collapsed + $Size * ($expanded - $collapsed)
    $W = [double]$script:Win.Width; $H = [double]$script:Win.Height
    $cx = $W / 2; $cy = $H / 2

    $script:Ellipse.Width = $dia; $script:Ellipse.Height = $dia
    [System.Windows.Controls.Canvas]::SetLeft($script:Ellipse, $cx - $dia / 2)
    [System.Windows.Controls.Canvas]::SetTop($script:Ellipse, $cy - $dia / 2)

    # Stack the visible text lines vertically, centered on the orb. Each line advances by its OWN
    # font size plus a CONSTANT gap, so growing one line keeps a fixed space to the others — e.g.
    # enlarging the phase label no longer drags the pomodoro line around. (SPEC §4)
    $gap = 4.0
    $lines = New-Object System.Collections.ArrayList
    if ($script:Appearance.showLabel -and $LabelText) {
        [void]$lines.Add(@{ block = $script:Label; text = $LabelText; h = $script:FontSize * 1.35 })
    }
    if ($script:Appearance.showPhaseCountdown -and $PhaseText) {
        [void]$lines.Add(@{ block = $script:Phase; text = $PhaseText; h = $script:CountdownSize * 1.35 })
    }
    if ((($script:Appearance.showRemainingTimeUnderBubble) -or ($script:Appearance.showLongBreakCountdown)) -and $PomoText) {
        [void]$lines.Add(@{ block = $script:Pomo; text = $PomoText; h = $script:PomoSize * 1.35 })
    }
    foreach ($b in @($script:Label, $script:Phase, $script:Pomo)) { $b.Visibility = 'Collapsed' }
    $totalH = 0.0
    foreach ($ln in $lines) { $totalH += $ln.h }
    if ($lines.Count -gt 1) { $totalH += $gap * ($lines.Count - 1) }
    $y = $cy - $totalH / 2
    foreach ($ln in $lines) {
        $ln.block.Visibility = 'Visible'; $ln.block.Width = $W; $ln.block.Text = $ln.text
        [System.Windows.Controls.Canvas]::SetLeft($ln.block, 0)
        [System.Windows.Controls.Canvas]::SetTop($ln.block, $y)
        $y += $ln.h + $gap
    }

    # Pin the gear to the orb's MAX top-right corner (stable, doesn't move with breathing) and
    # record its hit-rect (window coords) so interaction can keep the rest of the bubble click-through.
    if ($script:Gear) {
        $gx = $cx + $expanded / 2 - 26
        $gy = $cy - $expanded / 2
        [System.Windows.Controls.Canvas]::SetLeft($script:Gear, $gx)
        [System.Windows.Controls.Canvas]::SetTop($script:Gear, $gy)
        $script:GearLeft = $gx; $script:GearTop = $gy; $script:GearSize = 30
    }
}

# Click-through toggling (off while Ctrl-dragging — see main.ps1).
function Set-ClickThrough { param([bool]$On) if ($script:Hwnd) { [BPNative]::SetClickThrough($script:Hwnd, $On) } }

# Re-assert always-on-top (the frame loop calls this periodically — see main.ps1).
function Set-Topmost { if ($script:Hwnd) { [BPNative]::AssertTopmost($script:Hwnd) } }
