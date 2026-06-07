# strings — user-facing UI text (tray + break chrome), kept in a SEPARATE file from settings
# so it can be swapped/translated independently. Pure logic; file I/O lives in the shell.
# Mirrors src/macos/core/strings.js.

# Dev-time dependency for Get-Prop; build-win.ps1 strips this dot-source line (Get-Prop is then
# already defined in the bundle scope alongside the rest of core).
. $PSScriptRoot/settings.ps1

function Get-DefaultStrings {
    return @{
        version = 1
        tray    = @{
            startTimer = 'Start timer'
            stopTimer  = 'Stop timer'
            pause      = 'Pause'
            resume     = 'Resume'
            skip       = 'Skip'
            settings   = 'Settings'
            exit       = 'Exit'
        }
        break   = @{
            endBreak       = 'End break'
            confirmTitle   = 'End the break?'
            confirmMessage = 'Return to work now?'
            cancel         = 'Cancel'
        }
    }
}

# Fill missing/blank keys from defaults. Always returns a complete, safe strings hashtable;
# a partial or stale file never leaves a label undefined.
function Get-NormalizedStrings {
    param($Raw)
    $d = Get-DefaultStrings
    $out = Get-DefaultStrings
    foreach ($group in @('tray', 'break')) {
        $rg = Get-Prop $Raw $group
        foreach ($key in @($d[$group].Keys)) {
            $v = Get-Prop $rg $key
            $out[$group][$key] = if ($v -is [string] -and $v.Length -gt 0) { $v } else { $d[$group][$key] }
        }
    }
    return $out
}

function ConvertFrom-StringsJson {
    param([string]$JsonString)
    $raw = $null
    try { $raw = ConvertFrom-Json $JsonString -ErrorAction Stop } catch { $raw = $null }
    return Get-NormalizedStrings $raw
}

function ConvertTo-StringsJson {
    param($Strings)
    return (ConvertTo-Json (Get-NormalizedStrings $Strings) -Depth 10)
}
