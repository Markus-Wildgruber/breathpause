# timefmt — parse / format / validate clock strings. Pure logic. (SPEC §5,§11)
# Work = "hh:mm" (00:01–99:59). Break = "mm:ss" (00:01–59:59).
# Parse functions return [int] seconds, or $null when invalid (caller rejects gently).
# Mirrors src/macos/core/timefmt.js.

function Convert-ClockToParts {
    param([string]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -notmatch '^\s*(\d{1,2}):(\d{2})\s*$') { return $null }
    return @{ A = [int]$Matches[1]; B = [int]$Matches[2] }
}

# "hh:mm" -> seconds. hh 0–99, mm 0–59, total >= 60s (00:01). NB hh:mm, so 25 min = "00:25".
function Get-WorkSeconds {
    param([string]$Value)
    $p = Convert-ClockToParts $Value
    if ($null -eq $p) { return $null }
    if ($p.A -lt 0 -or $p.A -gt 99 -or $p.B -lt 0 -or $p.B -gt 59) { return $null }
    $s = $p.A * 3600 + $p.B * 60
    if ($s -ge 60) { return $s }
    return $null
}

# "mm:ss" -> seconds. mm 0–59, ss 0–59, total >= 1s (00:01).
function Get-BreakSeconds {
    param([string]$Value)
    $p = Convert-ClockToParts $Value
    if ($null -eq $p) { return $null }
    if ($p.A -lt 0 -or $p.A -gt 59 -or $p.B -lt 0 -or $p.B -gt 59) { return $null }
    $s = $p.A * 60 + $p.B
    if ($s -ge 1) { return $s }
    return $null
}

function Format-Pad2 {
    param([int]$N)
    $N = [int][math]::Floor([math]::Abs($N))
    if ($N -lt 10) { return "0$N" }
    return "$N"
}

# Remaining time for display: "MM:SS" under an hour, "H:MM:SS" at/over an hour.
function Format-Remaining {
    param([double]$TotalSeconds)
    if ($TotalSeconds -lt 0) { $TotalSeconds = 0 }
    $t = [int][math]::Floor($TotalSeconds)
    $h = [int][math]::Floor($t / 3600)
    $m = [int][math]::Floor(($t % 3600) / 60)
    $s = $t % 60
    if ($h -gt 0) { return ("{0}:{1}:{2}" -f $h, (Format-Pad2 $m), (Format-Pad2 $s)) }
    return ("{0}:{1}" -f (Format-Pad2 $m), (Format-Pad2 $s))
}
