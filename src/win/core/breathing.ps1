# breathing — phase schedule + eased bubble size over time. Pure logic. (SPEC §2)
# Pattern = @{ phases = @( @{ type='inhale'|'exhale'|'hold'; seconds=<n>; label=<s> }, ... ) }.
# Size is normalized 0 (collapsed) .. 1 (expanded). Mirrors src/macos/core/breathing.js.

function Get-EaseInOut {
    param([double]$P)
    if ($P -le 0) { return 0.0 }
    if ($P -ge 1) { return 1.0 }
    return (1 - [math]::Cos([math]::PI * $P)) / 2  # cosine ease-in-out
}

function Get-CycleDuration {
    param($Pattern)
    $total = 0.0
    if ($Pattern -and $Pattern.phases) {
        foreach ($ph in $Pattern.phases) { $total += [math]::Max(0.0, [double]$ph.seconds) }
    }
    return $total
}

# Target size a phase drives toward, given the size it starts from.
function Get-PhaseTarget {
    param([string]$Type, [double]$StartSize)
    if ($Type -eq 'inhale') { return 1.0 }
    if ($Type -eq 'exhale') { return 0.0 }
    return $StartSize  # hold
}

# Boundary sizes b[0..n]; two passes make b[0] == b[n] for seamless looping.
function Get-BoundarySizes {
    param($Pattern)
    $phases = if ($Pattern -and $Pattern.phases) { @($Pattern.phases) } else { @() }
    $n = $phases.Count
    $walk = {
        param([double]$start)
        $b = @($start)
        for ($i = 0; $i -lt $n; $i++) { $b += (Get-PhaseTarget $phases[$i].type $b[$i]) }
        return $b
    }
    $first = & $walk 0
    return (& $walk $first[$n])
}

# Locate the phase active at time t within one cycle.
function Get-PhaseAt {
    param($Pattern, [double]$T)
    $phases = if ($Pattern -and $Pattern.phases) { @($Pattern.phases) } else { @() }
    $dur = Get-CycleDuration $Pattern
    if ($dur -le 0 -or $phases.Count -eq 0) { return $null }
    $tc = (($T % $dur) + $dur) % $dur  # wrap into [0, dur)
    $acc = 0.0
    for ($i = 0; $i -lt $phases.Count; $i++) {
        $len = [math]::Max(0.0, [double]$phases[$i].seconds)
        if ($tc -lt ($acc + $len) -or $i -eq ($phases.Count - 1)) {
            $elapsed = $tc - $acc
            $progress = if ($len -gt 0) { [math]::Min(1.0, $elapsed / $len) } else { 1.0 }
            return @{
                index     = $i
                phase     = $phases[$i]
                elapsed   = $elapsed
                remaining = [math]::Max(0.0, $len - $elapsed)
                progress  = $progress
            }
        }
        $acc += $len
    }
    return $null
}

# Normalized size 0..1 at time t.
function Get-SizeAt {
    param($Pattern, [double]$T)
    $info = Get-PhaseAt $Pattern $T
    if ($null -eq $info) { return 0.0 }
    $b = Get-BoundarySizes $Pattern
    $from = $b[$info.index]
    $type = $info.phase.type
    if ($type -eq 'hold') { return $from }
    $to = Get-PhaseTarget $type $from
    return $from + ($to - $from) * (Get-EaseInOut $info.progress)
}

# Map normalized size to a pixel diameter.
function Get-DiameterForSize {
    param([double]$Size, [double]$CollapsedPx, [double]$ExpandedPx)
    return $CollapsedPx + $Size * ($ExpandedPx - $CollapsedPx)
}

function Get-CurrentLabel {
    param($Pattern, [double]$T)
    $info = Get-PhaseAt $Pattern $T
    if ($null -eq $info) { return '' }
    if ($null -ne $info.phase.label) { return $info.phase.label }
    return ''
}
