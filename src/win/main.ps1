# main — Windows entry point. Wires core + shell, owns the clock/loop. WPF.
# ⚠️ UNVERIFIED SCAFFOLDING — written without Windows.
#   Run (after build): powershell -ExecutionPolicy Bypass -File dist\breathpause.ps1
# Dev-time dot-sources (stripped by build-win.ps1; in the bundle the funcs are already present):
. $PSScriptRoot/core/timefmt.ps1
. $PSScriptRoot/core/breathing.ps1
. $PSScriptRoot/core/pomodoro.ps1
. $PSScriptRoot/core/eventlog.ps1
. $PSScriptRoot/core/settings.ps1
. $PSScriptRoot/core/strings.ps1
. $PSScriptRoot/core/hotkeys.ps1
. $PSScriptRoot/shell/storage.ps1
. $PSScriptRoot/shell/sound.ps1
. $PSScriptRoot/shell/window.ps1
. $PSScriptRoot/shell/tray.ps1
. $PSScriptRoot/shell/settingswindow.ps1
. $PSScriptRoot/shell/diagnostics.ps1

# ---- debug mode: run the doctor self-check and exit, without launching the GUI loop ------
$script:Settings = Read-AppSettings
$script:Strings = Read-AppStrings
if ($Debug) { Invoke-Doctor $script:Settings; return }

# ---- single-instance guard (SPEC §9) -----------------------------------------------------
if ($script:Settings.behavior.singleInstance) {
    $script:Mutex = New-Object System.Threading.Mutex($false, 'Global\breathpause-singleton')
    if (-not $script:Mutex.WaitOne(0)) { Write-Host 'breathpause is already running.'; exit }
}

# ---- app state ---------------------------------------------------------------------------
$script:WorkPattern = Get-WorkPattern $script:Settings
$script:BreakPattern = Get-BreakPattern $script:Settings
$script:LongBreakPattern = Find-Pattern $script:Settings $script:Settings.longBreakPatternId
if ($null -eq $script:LongBreakPattern) { $script:LongBreakPattern = $script:BreakPattern }
$script:State = New-PomodoroState (Get-WorkSeconds $script:Settings.timers.work) (Get-BreakSeconds $script:Settings.timers.break) (Get-BreakSeconds $script:Settings.timers.longBreak) ([int]$script:Settings.cycle.longBreakEvery) ([bool]$script:Settings.cycle.autoContinue)
if (-not $script:Settings.behavior.autoStartTimerOnLaunch) { $script:State = Reset-PomodoroState $script:State }
$script:BreathingT = 0.0
$script:Watch = [System.Diagnostics.Stopwatch]::StartNew()
$script:LastClock = $script:Watch.Elapsed.TotalSeconds
# Cap the per-frame advance. After hibernate/sleep the Stopwatch is far ahead, and feeding that
# raw gap to the pomodoro tick fast-forwards through many work/break boundaries at once (a 15-min
# long break "from nowhere"). Capping makes sleep effectively pause the timer. Real frames are
# ~33 ms, so this never affects normal ticking; it only absorbs sleep gaps / long modal stalls.
$script:MaxFrameDt = 2.0
$script:LastTopmostT = 0.0   # throttles the periodic always-on-top re-assertion (see Invoke-Frame)
$script:Dragging = $false
$script:LastMouse = $null

function Get-ActivePattern {
    if ($script:State.mode -ne 'break') { return $script:WorkPattern }
    if ($script:State.breakKind -eq 'long') { return $script:LongBreakPattern } else { return $script:BreakPattern }
}

function Invoke-Events { param($Events) foreach ($e in $Events) { Add-AppEvent $e @{ mode = $script:State.mode; cycle = $script:State.cyclesCompleted } } }

function Update-ModeChange {
    param([string]$PrevMode)
    if ($script:State.mode -eq $PrevMode) { return }
    if ($script:State.mode -eq 'break') { Set-BreakMode $script:Settings } else { Set-WorkMode $script:Settings }
    Play-Chime ([bool]$script:Settings.sound.enabled)
    $script:BreathingT = 0.0
}

# Work-mode interaction (SPEC §4): show the gear on hover, allow Ctrl+drag to move, and keep
# the window click-through except while hovering/dragging (so the gear is clickable).
function Update-Interaction {
    $ctrl = ([BPNative]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0
    $lbtn = ([BPNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
    $pos = [System.Windows.Forms.Control]::MousePosition
    # MousePosition is physical px; window/gear coords are DIPs. Convert mouse -> DIP.
    $scale = Get-DpiScale; if ($scale -le 0) { $scale = 1.0 }
    $mx = $pos.X / $scale; $my = $pos.Y / $scale
    $o = Get-WindowOrigin
    # Hovering anywhere over the window reveals the gear (visual only)...
    $inWindow = ($mx -ge $o.x -and $mx -le ($o.x + $script:Win.Width) -and
        $my -ge $o.y -and $my -le ($o.y + $script:Win.Height))
    # ...but only the small gear rect (or a drag) captures clicks; the rest stays click-through.
    $gx = $o.x + $script:GearLeft; $gy = $o.y + $script:GearTop; $gs = $script:GearSize
    $inGear = ($mx -ge $gx -and $mx -le ($gx + $gs) -and $my -ge $gy -and $my -le ($gy + $gs))
    $dragging = $ctrl -and $lbtn

    Set-GearVisible $inWindow

    $wantClickThrough = -not ($inGear -or $dragging)
    if ($wantClickThrough -ne $script:ClickThroughState) {
        Set-ClickThrough $wantClickThrough; $script:ClickThroughState = $wantClickThrough
    }

    if ($dragging) {
        if (-not $script:Dragging) { $script:Dragging = $true; $script:LastMouse = $pos }
        else {
            Set-WindowOrigin ($o.x + ($pos.X - $script:LastMouse.X) / $scale) ($o.y + ($pos.Y - $script:LastMouse.Y) / $scale)
            $script:LastMouse = $pos
        }
    }
    else {
        # Drag just ended: capture the orb's new top-right offset and persist it immediately
        # (so it survives even without a clean quit, and shows up if Settings is opened next).
        if ($script:Dragging) {
            $a = Get-OrbAnchor
            $script:Settings.position.fromRight = $a.fromRight
            $script:Settings.position.fromTop = $a.fromTop
            Write-AppSettings $script:Settings
        }
        $script:Dragging = $false
    }
}

function Invoke-Frame {
    $t = $script:Watch.Elapsed.TotalSeconds
    $dt = Limit-FrameDt ($t - $script:LastClock) $script:MaxFrameDt
    $script:LastClock = $t

    # Re-assert always-on-top ~1x/sec: launching another app (e.g. Paint) can knock the overlay
    # out of the topmost band, and WPF's Topmost property never puts it back on its own.
    if (($t - $script:LastTopmostT) -ge 1.0) { $script:LastTopmostT = $t; Set-Topmost }

    if (-not $script:State.paused) { $script:BreathingT += $dt }
    $prev = $script:State.mode
    $res = Invoke-PomodoroTick $script:State $dt
    $script:State = $res.state
    Invoke-Events $res.events
    Update-ModeChange $prev
    Set-TrayPaused $script:State.paused   # sync when a boundary auto-pauses (autoContinue off)

    $pattern = Get-ActivePattern
    $size = Get-SizeAt $pattern $script:BreathingT
    $labelText = Get-CurrentLabel $pattern $script:BreathingT
    $phaseText = ''
    $info = Get-PhaseAt $pattern $script:BreathingT
    if ($info) { $phaseText = [string][int][math]::Ceiling($info.remaining) }
    $pomoTime = if ($script:State.running) { Format-Remaining $script:State.remaining } else { '' }
    # Pomodoro line = remaining time, optionally followed by "(N)" = work sessions until the long
    # break. Each part has its own appearance toggle; either or both can show. Read from
    # $script:Appearance (window.ps1's preview-aware copy) so both toggles preview live.
    $pomoText = ''
    if ($script:State.running) {
        $parts = @()
        if ($script:Appearance.showRemainingTimeUnderBubble) { $parts += $pomoTime }
        if ($script:Appearance.showLongBreakCountdown -and $script:State.longBreakEvery -gt 0) {
            $parts += '({0})' -f ($script:State.longBreakEvery - ($script:State.workCount % $script:State.longBreakEvery))
        }
        $pomoText = ($parts -join ' ')
    }
    Update-Bubble $script:State.mode $size $labelText $phaseText $pomoText
    Set-TrayTooltip $(if ($script:State.running) { "BreathPause $pomoTime" } else { 'BreathPause' })

    Update-Hotkeys
    if ($script:State.mode -ne 'break') {
        Update-Interaction   # gear/drag only in work mode
    }
    else {
        if ($script:Dragging) { $script:Dragging = $false }
        # Esc ends the break (polled system-wide; edge-detected so it fires once). 0x1B = VK_ESCAPE.
        $esc = ([BPNative]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0
        if ($esc -and -not $script:EscDown) { $script:EscDown = $true; Invoke-CloseBreakConfirm }
        elseif (-not $esc) { $script:EscDown = $false }
    }
}

# Live preview (no persistence): update colors/opacity/text/fonts/position on the bubble.
function Preview-Settings {
    param($New, $NewStrings)
    Set-Appearance $New
    if ($script:State.mode -eq 'break') { Set-BubbleColor $New.appearance.colors.breakFill }
    else { Set-BubbleColor $New.appearance.colors.workFill }
    if ($NewStrings) { Set-WindowStrings $NewStrings; Set-TrayStrings $NewStrings }
    # Reposition live (work mode only — the break window is fullscreen).
    if ($script:State.mode -ne 'break') { Set-OrbAnchor ([double]$New.position.fromRight) ([double]$New.position.fromTop) }
}

# Revert a cancelled preview back to the committed settings.
function Revert-Settings { Preview-Settings $script:Settings $script:Strings }

# Apply edited settings: persist, sync start-on-boot, refresh live visuals + patterns.
function Apply-Settings {
    param($New, $NewStrings)
    Write-AppSettings $New
    $script:Settings = $New
    if ($NewStrings) {
        Write-AppStrings $NewStrings
        $script:Strings = $NewStrings
        Set-WindowStrings $NewStrings
        Set-TrayStrings $NewStrings
    }
    Set-StartOnBoot ([bool]$New.behavior.startOnBoot)
    $script:WorkPattern = Get-WorkPattern $New
    $script:BreakPattern = Get-BreakPattern $New
    $script:LongBreakPattern = Find-Pattern $New $New.longBreakPatternId
    if ($null -eq $script:LongBreakPattern) { $script:LongBreakPattern = $script:BreakPattern }
    Set-Appearance $New
    Rebuild-Hotkeys
    if ($script:State.mode -eq 'break') { Set-BreakMode $New } else { Set-WorkMode $New }
}

# Register/clear an HKCU Run entry so the app launches at login.
function Set-StartOnBoot {
    param([bool]$Enabled)
    $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    try {
        if ($Enabled) {
            $cmd = 'powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
            Set-ItemProperty -Path $run -Name 'breathpause' -Value $cmd
        }
        else { Remove-ItemProperty -Path $run -Name 'breathpause' -ErrorAction SilentlyContinue }
    }
    catch { }
}

# ---- global hotkeys (SPEC §6): polled via GetAsyncKeyState, edge-detected ----------------
# (parsing lives in core/hotkeys.ps1 -> Convert-FromHotkeyString, so it can be unit-tested)
function Rebuild-Hotkeys {
    $script:Hotkeys = @()
    $map = @{ startStop = $handlers.OnStartStop; pauseResume = $handlers.OnPauseResume; skip = $handlers.OnSkip; settings = $handlers.OnSettings }
    foreach ($name in $map.Keys) {
        $hk = Convert-FromHotkeyString $script:Settings.hotkeys.$name
        if ($hk) { $hk.action = $map[$name]; $script:Hotkeys += $hk }
    }
}
function Test-VkDown { param([int]$Vk) return ((([BPNative]::GetAsyncKeyState($Vk)) -band 0x8000) -ne 0) }
function Update-Hotkeys {
    if (-not $script:Hotkeys) { return }
    foreach ($hk in $script:Hotkeys) {
        $modsDown = $true
        foreach ($m in $hk.mods) { if (-not (Test-VkDown $m)) { $modsDown = $false; break } }
        $keyDown = Test-VkDown $hk.vk
        if ($modsDown -and $keyDown -and -not $hk.down) { $hk.down = $true; & $hk.action }
        elseif (-not $keyDown) { $hk.down = $false }
    }
}

# ---- menu handlers -----------------------------------------------------------------------
$handlers = @{
    OnPauseResume = {
        if ($script:State.paused) { $script:State = Resume-Pomodoro $script:State; Add-AppEvent 'resume' @{} }
        else { $script:State = Suspend-Pomodoro $script:State; Add-AppEvent 'pause' @{} }
        Set-TrayPaused $script:State.paused
    }
    OnSkip     = { $prev = $script:State.mode; $r = Invoke-PomodoroSkip $script:State; $script:State = $r.state; Add-AppEvent 'skip' @{}; Invoke-Events $r.events; Update-ModeChange $prev }
    # User confirmed Esc / close button on the break overlay -> end the break early (SPEC §5).
    OnCloseBreak = {
        if ($script:State.mode -eq 'break') {
            $prev = $script:State.mode; $r = Invoke-PomodoroSkip $script:State; $script:State = $r.state
            Add-AppEvent 'skip' @{ reason = 'break_closed' }; Invoke-Events $r.events; Update-ModeChange $prev
        }
    }
    # Toggle: running -> stop to breathing-only; stopped -> start a fresh work session.
    OnStartStop = {
        if ($script:State.running) {
            $script:State = Reset-PomodoroState $script:State; Add-AppEvent 'reset' @{}
            Set-WorkMode $script:Settings; Set-TrayPaused $false
        }
        else {
            $script:State = New-PomodoroState (Get-WorkSeconds $script:Settings.timers.work) (Get-BreakSeconds $script:Settings.timers.break) (Get-BreakSeconds $script:Settings.timers.longBreak) ([int]$script:Settings.cycle.longBreakEvery) ([bool]$script:Settings.cycle.autoContinue)
            $script:BreathingT = 0.0; Add-AppEvent 'session_start' @{ mode = 'work' }
        }
        Set-TrayRunning $script:State.running
    }
    OnSettings = { Show-SettingsWindow $script:Settings $script:Strings { param($n, $s) Preview-Settings $n $s } { param($n, $s) Apply-Settings $n $s } { Revert-Settings } { & $handlers.OnQuit } }
    OnQuit     = {
        Write-AppSettings $script:Settings   # persist position (a Ctrl+drag updates it in-memory)
        Add-AppEvent 'quit' @{}
        $script:Timer.Stop(); Remove-Tray
        if ($script:Mutex) { $script:Mutex.ReleaseMutex() }
        $script:App.Shutdown()
    }
}

# ---- launch ------------------------------------------------------------------------------
# Create the Application FIRST. If it's created after Show()/Run(), Run() has nothing to pump
# and returns immediately -> the script ends and the window vanishes.
$script:App = New-Object System.Windows.Application
$script:App.ShutdownMode = 'OnExplicitShutdown'   # stay alive until Quit (not when a window closes)
# A failing render tick would otherwise crash the whole app: log it once and keep running.
$script:App.add_DispatcherUnhandledException({
        param($s, $e)
        if (-not $script:LoopErrorLogged) {
            $script:LoopErrorLogged = $true
            $p = Join-Path (Get-ConfigDir) 'error.log'
            try { Add-Content -Path $p -Value ('[' + (Get-Date).ToString('o') + '] [dispatcher] ' + ($e.Exception | Out-String)) } catch { }
        }
        $e.Handled = $true
    })

# Tray/menu handlers run on the WinForms message loop, whose exceptions bypass the WPF trap
# (that's why an error there showed the raw .NET dialog). Route them to error.log + a clean popup.
try { [System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException) } catch { }
[System.Windows.Forms.Application]::add_ThreadException({
        param($s, $e)
        $p = Join-Path (Get-ConfigDir) 'error.log'
        try { Add-Content -Path $p -Value ('[' + (Get-Date).ToString('o') + '] [winforms] ' + ($e.Exception | Out-String)) } catch { }
        try { [void][System.Windows.MessageBox]::Show([string]$e.Exception.Message, 'breathpause error') } catch { }
    })

New-BubbleWindow $script:Settings
Set-CloseBreakHandler $handlers.OnCloseBreak
Set-GearHandler { & $handlers.OnSettings }
Set-StartOnBoot ([bool]$script:Settings.behavior.startOnBoot)   # keep registry in sync with the setting
Rebuild-Hotkeys
New-Tray $handlers
Set-TrayRunning $script:State.running
Add-AppEvent 'session_start' @{ mode = $script:State.mode }

$script:Timer = New-Object System.Windows.Threading.DispatcherTimer
$script:Timer.Interval = [TimeSpan]::FromMilliseconds(33)  # ~30 fps
$script:Timer.add_Tick({ Invoke-Frame })
$script:Timer.Start()

Add-AppEvent 'loop_start' @{}     # if this line shows in events.log, the message loop was reached
$script:App.Run() | Out-Null
