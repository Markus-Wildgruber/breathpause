# eventlog — format records for events.log (JSON Lines). Pure logic. (SPEC §7)
# The shell supplies the ISO-8601 timestamp and appends ConvertTo-EventLine + "`n".
# Mirrors src/macos/core/eventlog.js.

function Get-EventNames {
    return @(
        'session_start', 'work_complete', 'break_start', 'break_complete',
        'pause', 'resume', 'skip', 'reset', 'quit'
    )
}

function Test-EventName {
    param([string]$Name)
    return ((Get-EventNames) -contains $Name)
}

# Build one log record. $Ts is an ISO-8601 string (caller-provided). $Extra is merged in.
function New-EventRecord {
    param([string]$Name, [string]$Ts, [hashtable]$Extra)
    $rec = [ordered]@{ ts = $Ts; event = $Name }
    if ($Extra) {
        foreach ($k in $Extra.Keys) {
            if ($k -ne 'ts' -and $k -ne 'event') { $rec[$k] = $Extra[$k] }
        }
    }
    return $rec
}

# One JSONL line (no trailing newline; the writer adds it).
function ConvertTo-EventLine {
    param($Record)
    return (ConvertTo-Json $Record -Compress -Depth 10)
}
