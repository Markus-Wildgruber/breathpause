# settings — schema defaults, normalize/validate, pattern resolution. Pure logic. (SPEC §6,§8)
# File I/O lives in the shell; this module only turns strings <-> normalized objects.
# Mirrors src/macos/core/settings.js.

# Dev-time dependency; build-win.ps1 strips this dot-source line (timefmt funcs are then
# already defined in the bundle scope).
. $PSScriptRoot/timefmt.ps1

function Get-PhaseTypes { return @('inhale', 'exhale', 'hold') }

# App release version (distinct from the settings-schema `version` field below). Shown in the
# settings window. Bump on release; keep in sync with src/macos/core/settings.js appVersion().
function Get-AppVersion { return '0.1.0' }

# Read a property from either a hashtable (tests) or a PSCustomObject (ConvertFrom-Json).
function Get-Prop {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $null }
    if ($Obj -is [hashtable]) {
        if ($Obj.ContainsKey($Name)) { return $Obj[$Name] }
        return $null
    }
    $p = $Obj.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-DefaultSettings {
    return @{
        version       = 1
        patterns      = @(
            @{ id = 'coherent-5-5'; name = '5.5 In / 5.5 Out'; phases = @(
                    @{ type = 'inhale'; seconds = 5.5; label = 'In' },
                    @{ type = 'exhale'; seconds = 5.5; label = 'Out' }
                ) }
        )
        workPatternId      = 'coherent-5-5'
        breakPatternId     = 'coherent-5-5'
        longBreakPatternId = 'coherent-5-5'
        timers             = @{ work = '00:25'; break = '05:00'; longBreak = '15:00' }
        cycle              = @{ mode = 'loop-forever'; longBreakEvery = 4; autoContinue = $true }  # longBreakEvery 0 = off; autoContinue $false = wait for Resume
        appearance         = @{
            collapsedDiameterPx          = 80
            expandedDiameterPx           = 200
            opacity                      = 0.20
            breakSizePctScreenHeight     = 40
            easing                       = 'ease-in-out'
            showLabel                    = $true
            showPhaseCountdown           = $true
            showRemainingTimeUnderBubble = $true
            showLongBreakCountdown       = $false
            font                         = @{ family = 'Segoe UI Variable'; size = 16; countdownSize = 13; pomodoroSize = 12 }
            colors                       = @{
                workFill = '#4FC3F7'; breakFill = '#81C784'; text = '#FFFFFF'; breakOverlayTint = '#000000CC'
            }
        }
        position           = @{ fromRight = 16; fromTop = 16 }   # orb top-right corner, px from the screen's top-right
        behavior           = @{ autoStartTimerOnLaunch = $true; singleInstance = $true; startOnBoot = $false }
        hotkeys            = @{ startStop = ''; pauseResume = ''; skip = ''; settings = '' }  # '' = disabled
        sound              = @{ enabled = $true }
    }
}

function Get-ClampedNumber {
    param($Value, [double]$Lo, [double]$Hi, [double]$Default)
    if ($Value -isnot [double] -and $Value -isnot [int] -and $Value -isnot [long]) { return $Default }
    $v = [double]$Value
    if ([double]::IsNaN($v)) { return $Default }
    return [math]::Min($Hi, [math]::Max($Lo, $v))
}

function Test-HexColor {
    param($Value)
    return ($Value -is [string]) -and ($Value -match '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$')
}

# A pattern is valid if it has >=1 phase, each a known type with seconds in [0.1, 60].
function Test-Pattern {
    param($P)
    if ($null -eq $P) { return $false }
    $id = Get-Prop $P 'id'
    $phases = Get-Prop $P 'phases'
    if ($id -isnot [string] -or $null -eq $phases) { return $false }
    $arr = @($phases)
    if ($arr.Count -eq 0) { return $false }
    foreach ($ph in $arr) {
        $type = Get-Prop $ph 'type'
        $seconds = Get-Prop $ph 'seconds'
        if ((Get-PhaseTypes) -notcontains $type) { return $false }
        if (($seconds -isnot [double] -and $seconds -isnot [int]) -or [double]$seconds -lt 0.1 -or [double]$seconds -gt 60) { return $false }
    }
    return $true
}

function Get-BoolOr {
    param($Value, [bool]$Default)
    if ($Value -is [bool]) { return $Value }
    return $Default
}

# Fill missing fields from defaults and clamp out-of-range values. Always returns a
# complete, safe settings hashtable; invalid patterns are dropped (defaults kept if none).
function Get-NormalizedSettings {
    param($Raw)
    $d = Get-DefaultSettings
    $out = Get-DefaultSettings

    $rawPatterns = Get-Prop $Raw 'patterns'
    if ($null -ne $rawPatterns) {
        $kept = @(@($rawPatterns) | Where-Object { Test-Pattern $_ })
        if ($kept.Count -gt 0) { $out.patterns = $kept }
    }
    $ids = @($out.patterns | ForEach-Object { Get-Prop $_ 'id' })
    $wp = Get-Prop $Raw 'workPatternId'
    $bp = Get-Prop $Raw 'breakPatternId'
    $lp = Get-Prop $Raw 'longBreakPatternId'
    $out.workPatternId = if ($ids -contains $wp) { $wp } else { $out.patterns[0].id }
    $out.breakPatternId = if ($ids -contains $bp) { $bp } else { $out.patterns[0].id }
    $out.longBreakPatternId = if ($ids -contains $lp) { $lp } else { $out.breakPatternId }

    $t = Get-Prop $Raw 'timers'
    $out.timers.work = if ($null -ne (Get-WorkSeconds (Get-Prop $t 'work'))) { Get-Prop $t 'work' } else { $d.timers.work }
    $out.timers.break = if ($null -ne (Get-BreakSeconds (Get-Prop $t 'break'))) { Get-Prop $t 'break' } else { $d.timers.break }
    $out.timers.longBreak = if ($null -ne (Get-BreakSeconds (Get-Prop $t 'longBreak'))) { Get-Prop $t 'longBreak' } else { $d.timers.longBreak }

    $cy = Get-Prop $Raw 'cycle'
    $lbe = Get-Prop $cy 'longBreakEvery'
    $out.cycle.longBreakEvery = if (($lbe -is [int] -or $lbe -is [long] -or $lbe -is [double]) -and $lbe -ge 0) { [int][math]::Min(99, [math]::Floor([double]$lbe)) } else { $d.cycle.longBreakEvery }
    $out.cycle.autoContinue = Get-BoolOr (Get-Prop $cy 'autoContinue') $d.cycle.autoContinue

    $a = Get-Prop $Raw 'appearance'
    $oa = $out.appearance
    $oa.collapsedDiameterPx = Get-ClampedNumber (Get-Prop $a 'collapsedDiameterPx') 8 2000 $d.appearance.collapsedDiameterPx
    $oa.expandedDiameterPx = Get-ClampedNumber (Get-Prop $a 'expandedDiameterPx') 8 4000 $d.appearance.expandedDiameterPx
    if ($oa.expandedDiameterPx -lt $oa.collapsedDiameterPx) { $oa.expandedDiameterPx = $oa.collapsedDiameterPx }
    $oa.opacity = Get-ClampedNumber (Get-Prop $a 'opacity') 0.05 1 $d.appearance.opacity
    $oa.breakSizePctScreenHeight = Get-ClampedNumber (Get-Prop $a 'breakSizePctScreenHeight') 5 100 $d.appearance.breakSizePctScreenHeight
    $oa.showLabel = Get-BoolOr (Get-Prop $a 'showLabel') $d.appearance.showLabel
    $oa.showPhaseCountdown = Get-BoolOr (Get-Prop $a 'showPhaseCountdown') $d.appearance.showPhaseCountdown
    $oa.showRemainingTimeUnderBubble = Get-BoolOr (Get-Prop $a 'showRemainingTimeUnderBubble') $d.appearance.showRemainingTimeUnderBubble
    $oa.showLongBreakCountdown = Get-BoolOr (Get-Prop $a 'showLongBreakCountdown') $d.appearance.showLongBreakCountdown
    $fnt = Get-Prop $a 'font'
    $ff = Get-Prop $fnt 'family'
    $oa.font.family = if ($ff -is [string] -and $ff.Length -gt 0) { $ff } else { $d.appearance.font.family }
    $oa.font.size = Get-ClampedNumber (Get-Prop $fnt 'size') 8 72 $d.appearance.font.size
    # Per-text sizes: countdown/pomodoro. Missing values migrate from the (single) legacy size.
    $oa.font.countdownSize = Get-ClampedNumber (Get-Prop $fnt 'countdownSize') 8 72 ([math]::Round($oa.font.size * 0.8))
    $oa.font.pomodoroSize = Get-ClampedNumber (Get-Prop $fnt 'pomodoroSize') 8 72 ([math]::Round($oa.font.size * 0.72))
    $c = Get-Prop $a 'colors'
    foreach ($k in @('workFill', 'breakFill', 'text', 'breakOverlayTint')) {
        $cv = Get-Prop $c $k
        $oa.colors[$k] = if (Test-HexColor $cv) { $cv } else { $d.appearance.colors[$k] }
    }

    $p = Get-Prop $Raw 'position'
    $pr = Get-Prop $p 'fromRight'; $pt = Get-Prop $p 'fromTop'
    $out.position.fromRight = if ($pr -is [double] -or $pr -is [int]) { [math]::Max(0.0, [double]$pr) } else { $d.position.fromRight }
    $out.position.fromTop = if ($pt -is [double] -or $pt -is [int]) { [math]::Max(0.0, [double]$pt) } else { $d.position.fromTop }

    $b = Get-Prop $Raw 'behavior'
    $out.behavior.autoStartTimerOnLaunch = Get-BoolOr (Get-Prop $b 'autoStartTimerOnLaunch') $d.behavior.autoStartTimerOnLaunch
    $out.behavior.singleInstance = Get-BoolOr (Get-Prop $b 'singleInstance') $d.behavior.singleInstance
    $out.behavior.startOnBoot = Get-BoolOr (Get-Prop $b 'startOnBoot') $d.behavior.startOnBoot

    $hk = Get-Prop $Raw 'hotkeys'
    foreach ($k in @('startStop', 'pauseResume', 'skip', 'settings')) {
        $hv = Get-Prop $hk $k
        $out.hotkeys[$k] = if ($hv -is [string]) { $hv } else { $d.hotkeys[$k] }
    }

    $snd = Get-Prop $Raw 'sound'
    $out.sound.enabled = Get-BoolOr (Get-Prop $snd 'enabled') $d.sound.enabled

    return $out
}

function Find-Pattern {
    param($Settings, [string]$Id)
    foreach ($p in @($Settings.patterns)) { if ($p.id -eq $Id) { return $p } }
    return $null
}

function Get-WorkPattern {
    param($Settings)
    $p = Find-Pattern $Settings $Settings.workPatternId
    if ($p) { return $p }
    return $Settings.patterns[0]
}

function Get-BreakPattern {
    param($Settings)
    $p = Find-Pattern $Settings $Settings.breakPatternId
    if ($p) { return $p }
    return $Settings.patterns[0]
}

# Parse a JSON string into a normalized settings object; falls back to defaults on bad JSON.
function ConvertFrom-SettingsJson {
    param([string]$JsonString)
    $raw = $null
    try { $raw = ConvertFrom-Json $JsonString -ErrorAction Stop } catch { $raw = $null }
    return Get-NormalizedSettings $raw
}

function ConvertTo-SettingsJson {
    param($Settings)
    return (ConvertTo-Json (Get-NormalizedSettings $Settings) -Depth 10)
}
