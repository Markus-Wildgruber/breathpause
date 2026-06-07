# pomodoro — work/break state machine. Pure logic; no timers/clock here so it stays
# unit-testable (the shell calls Invoke-PomodoroTick on its own clock). (SPEC §5,§11)
# State is a hashtable. Functions return a NEW state; tick/skip also return fired events.
# Mirrors src/macos/core/pomodoro.js.

# longBreakEvery N: after every Nth work session the break is long (SPEC §5). 0 disables it.
function New-PomodoroState {
    param([int]$WorkSeconds, [int]$BreakSeconds, [int]$LongBreakSeconds = 0, [int]$LongBreakEvery = 0, [bool]$AutoContinue = $true)
    if ($LongBreakSeconds -le 0) { $LongBreakSeconds = $BreakSeconds }
    return @{
        running          = $true   # auto-starts on launch (SPEC §5)
        mode             = 'work'
        remaining        = [double]$WorkSeconds
        paused           = $false
        workSeconds      = [double]$WorkSeconds
        breakSeconds     = [double]$BreakSeconds
        longBreakSeconds = [double]$LongBreakSeconds
        longBreakEvery   = [int]$LongBreakEvery
        autoContinue     = [bool]$AutoContinue   # $false = next segment starts paused
        breakKind        = 'short'   # 'short' | 'long'
        workCount        = 0
        cyclesCompleted  = 0
    }
}

function Copy-PomodoroState {
    param($S)
    return @{
        running = $S.running; mode = $S.mode; remaining = $S.remaining; paused = $S.paused
        workSeconds = $S.workSeconds; breakSeconds = $S.breakSeconds
        longBreakSeconds = $S.longBreakSeconds; longBreakEvery = $S.longBreakEvery
        autoContinue = $S.autoContinue
        breakKind = $S.breakKind; workCount = $S.workCount; cyclesCompleted = $S.cyclesCompleted
    }
}

function Get-SegmentLength {
    param($S, [string]$Mode)
    if ($Mode -ne 'break') { return $S.workSeconds }
    if ($S.breakKind -eq 'long') { return $S.longBreakSeconds } else { return $S.breakSeconds }
}

# Apply one segment boundary, mutating $S and appending fired events to the ArrayList.
function Step-Boundary {
    param($S, [System.Collections.ArrayList]$Events)
    if ($S.mode -eq 'work') {
        $S.workCount += 1
        $isLong = ($S.longBreakEvery -gt 0) -and (($S.workCount % $S.longBreakEvery) -eq 0)
        $S.breakKind = if ($isLong) { 'long' } else { 'short' }
        $S.mode = 'break'
        $S.remaining = if ($isLong) { $S.longBreakSeconds } else { $S.breakSeconds }
        [void]$Events.Add('work_complete'); [void]$Events.Add('break_start')
    }
    else {
        [void]$Events.Add('break_complete'); [void]$Events.Add('session_start')
        $S.cyclesCompleted += 1
        $S.mode = 'work'
        $S.remaining = $S.workSeconds
    }
    if (-not $S.autoContinue) { $S.paused = $true }  # wait for Resume on the next segment
}

# Advance the clock by $Dt seconds. Carries across multiple boundaries if $Dt is large.
function Invoke-PomodoroTick {
    param($State, [double]$Dt)
    $s = Copy-PomodoroState $State
    $events = New-Object System.Collections.ArrayList
    if (-not $s.running -or $s.paused -or $Dt -le 0) {
        return @{ state = $s; events = @($events.ToArray()) }
    }
    $left = $Dt
    $guard = 0
    while ($left -gt 0 -and $guard -lt 10000) {
        $guard++
        if ($left -lt $s.remaining) {
            $s.remaining -= $left
            $left = 0
        }
        else {
            $left -= $s.remaining
            $s.remaining = 0
            Step-Boundary $s $events
            if ($s.paused) { break }   # autoContinue off -> segment waits for Resume
        }
    }
    return @{ state = $s; events = @($events.ToArray()) }
}

# Clamp a per-frame elapsed delta to [0, Max]. The shell measures dt from a clock that jumps after
# sleep/hibernate; feeding that raw gap to Invoke-PomodoroTick would fast-forward through many
# boundaries at once, so the frame loop caps it — sleep then effectively pauses the timer. (SPEC §5)
function Limit-FrameDt {
    param([double]$Raw, [double]$Max)
    $d = [math]::Max(0.0, $Raw)
    if ($d -gt $Max) { return $Max }
    return $d
}

function Suspend-Pomodoro { param($State) $s = Copy-PomodoroState $State; $s.paused = $true;  return $s }
function Resume-Pomodoro  { param($State) $s = Copy-PomodoroState $State; $s.paused = $false; return $s }

# End the current segment immediately and move to the next.
function Invoke-PomodoroSkip {
    param($State)
    $s = Copy-PomodoroState $State
    $events = New-Object System.Collections.ArrayList
    if ($s.running) {
        $s.remaining = 0
        Step-Boundary $s $events
    }
    return @{ state = $s; events = @($events.ToArray()) }
}

# Stop the session -> plain breathing-only bubble (work pattern, no countdown).
function Reset-PomodoroState {
    param($State)
    $s = Copy-PomodoroState $State
    $s.running = $false
    $s.paused = $false
    $s.mode = 'work'
    $s.remaining = $s.workSeconds
    $s.breakKind = 'short'
    $s.workCount = 0
    return $s
}
