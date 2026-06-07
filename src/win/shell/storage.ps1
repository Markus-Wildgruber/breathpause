# shell/storage — settings.json + events.log under %APPDATA% (SPEC §7). File I/O.
# ⚠️ UNVERIFIED on real Windows, but headless-verifiable: paths use $env:APPDATA, and the
#    event-record formatting comes from the tested core (eventlog/settings).
#
# On Windows %APPDATA% = C:\Users\<you>\AppData\Roaming, so the config dir is
#   C:\Users\<you>\AppData\Roaming\breathpause\  (events.log, settings.json).

function Get-ConfigDir {
    $base = Join-Path $env:APPDATA 'breathpause'
    if (-not (Test-Path $base)) { New-Item -ItemType Directory -Force -Path $base | Out-Null }
    return $base
}

function Read-AppSettings {
    $p = Join-Path (Get-ConfigDir) 'settings.json'
    if (Test-Path $p) { return (ConvertFrom-SettingsJson (Get-Content $p -Raw)) }
    return (Get-DefaultSettings)
}

function Write-AppSettings {
    param($S)
    Set-Content -Path (Join-Path (Get-ConfigDir) 'settings.json') -Value (ConvertTo-SettingsJson $S) -Encoding UTF8
}

# User-facing UI text lives in its own file (strings.json) so it can be translated/swapped
# independently of settings.json.
function Read-AppStrings {
    $p = Join-Path (Get-ConfigDir) 'strings.json'
    if (Test-Path $p) { return (ConvertFrom-StringsJson (Get-Content $p -Raw)) }
    return (Get-DefaultStrings)
}

function Write-AppStrings {
    param($S)
    Set-Content -Path (Join-Path (Get-ConfigDir) 'strings.json') -Value (ConvertTo-StringsJson $S) -Encoding UTF8
}

# Append one JSON-Lines record to events.log (SPEC §7).
function Add-AppEvent {
    param([string]$Name, [hashtable]$Extra)
    $ts = (Get-Date).ToUniversalTime().ToString('o')
    $line = ConvertTo-EventLine (New-EventRecord $Name $ts $Extra)
    Add-Content -Path (Join-Path (Get-ConfigDir) 'events.log') -Value $line -Encoding UTF8
}
