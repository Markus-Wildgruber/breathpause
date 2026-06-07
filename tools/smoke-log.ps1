# Headless smoke harness — drives the real core + storage (no GUI) to write a real
# settings.json + events.log, so the on-disk log format/location can be verified without
# a Mac/Windows GUI. Uses short simulated durations to fire the full event sequence.
#
# Usage (WSL, pointing at Windows AppData):
#   pwsh -File tools/smoke-log.ps1 -AppData '/mnt/c/Users/Marku/AppData/Roaming'
# On real Windows, omit -AppData and it uses the live %APPDATA%.
param([string]$AppData)

if ($AppData) { $env:APPDATA = $AppData }
$root = Split-Path -Parent $PSScriptRoot
. $root/src/win/core/timefmt.ps1
. $root/src/win/core/breathing.ps1
. $root/src/win/core/pomodoro.ps1
. $root/src/win/core/eventlog.ps1
. $root/src/win/core/settings.ps1
. $root/src/win/shell/storage.ps1

$settings = Read-AppSettings
Write-AppSettings $settings

# Simulate a session with short durations so events fire immediately.
$state = New-PomodoroState 3 2     # 3s work, 2s break (simulated)
Add-AppEvent 'session_start' @{ mode = $state.mode }

function Drain($r) { $script:state = $r.state; foreach ($e in $r.events) { Add-AppEvent $e @{ mode = $script:state.mode; cycle = $script:state.cyclesCompleted } } }

Drain (Invoke-PomodoroTick $state 3)     # finish work -> break
$state = Suspend-Pomodoro $state; Add-AppEvent 'pause' @{}
$state = Resume-Pomodoro $state;  Add-AppEvent 'resume' @{}
Drain (Invoke-PomodoroSkip $state)       # end break early -> back to work
Add-AppEvent 'quit' @{}

$dir = Get-ConfigDir
Write-Host "Config dir: $dir"
Write-Host "--- settings.json (first lines) ---"
Get-Content (Join-Path $dir 'settings.json') -TotalCount 6
Write-Host "--- events.log ---"
Get-Content (Join-Path $dir 'events.log')
