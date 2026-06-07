# build-win — concatenate src/win modules into one self-contained dist/breathpause.ps1
# (SPEC §11). Zero dependencies: text concatenation + the built-in PowerShell parser check.
# Function names are verb-noun and unique across modules, so one scope is collision-free.
# Dev-time dot-source lines (`. $PSScriptRoot/...`) are stripped.
param([string]$Version = $env:BP_VERSION)  # release tag (e.g. v0.1.0); stamped into the header. Empty for dev builds.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'src/win'
$out = Join-Path $root 'dist/breathpause.ps1'
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

# Order matters: a module must be defined before a later module dot-sources/uses it.
$files = @(
    'core/timefmt.ps1', 'core/breathing.ps1', 'core/pomodoro.ps1', 'core/eventlog.ps1', 'core/settings.ps1', 'core/strings.ps1', 'core/hotkeys.ps1',
    'shell/storage.ps1', 'shell/sound.ps1', 'shell/window.ps1', 'shell/tray.ps1', 'shell/settingswindow.ps1', 'shell/diagnostics.ps1', 'main.ps1'
) | ForEach-Object { Join-Path $src $_ }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# breathpause (Windows) - GENERATED bundle. Do not edit; edit src/win/* and rebuild.')
if ($Version) { [void]$sb.AppendLine("# Version: $Version") }
[void]$sb.AppendLine('# Run:        powershell -ExecutionPolicy Bypass -File dist\breathpause.ps1')
[void]$sb.AppendLine('# Debug mode: powershell -ExecutionPolicy Bypass -File dist\breathpause.ps1 -Debug')
# `param` must be the first statement (comments allowed above it).
[void]$sb.AppendLine('param([switch]$Debug)')

# Bootstrap (literal here-string; runtime vars must NOT expand here): WPF requires an STA
# thread (pwsh 7 is MTA by default -> relaunch under STA, forwarding -Debug and keeping the
# console open), and any fatal error is logged to %APPDATA%\breathpause\error.log and shown
# in a MessageBox so the window never just vanishes.
$bootstrap = @'
if (-not $env:BREATHPAUSE_RELAUNCHED -and [Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    [Environment]::SetEnvironmentVariable('BREATHPAUSE_RELAUNCHED', '1', 'Process')
    $hostArgs = @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass')
    if ($Debug) { $hostArgs += '-NoExit' } else { $hostArgs += @('-WindowStyle', 'Hidden') }
    $scriptArgs = @('-File', ('"' + $PSCommandPath + '"'))
    if ($Debug) { $scriptArgs += '-Debug' }
    # -Debug keeps a visible console (doctor output); otherwise relaunch with no window.
    if ($Debug) { Start-Process powershell.exe -ArgumentList ($hostArgs + $scriptArgs) }
    else { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ($hostArgs + $scriptArgs) }
    return
}
# Already STA and not relaunching (e.g. Windows PowerShell 5.1 started with a visible console):
# hide our own console so the GUI app has no terminal behind it. -Debug keeps it for the doctor.
if (-not $Debug) {
    try {
        Add-Type -Name BPWin -Namespace BPBoot -MemberDefinition '
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
' -ErrorAction Stop
        $cw = [BPBoot.BPWin]::GetConsoleWindow()
        if ($cw -ne [System.IntPtr]::Zero) { [void][BPBoot.BPWin]::ShowWindow($cw, 0) }  # 0 = SW_HIDE
    }
    catch { }
}
trap {
    $log = Join-Path $env:APPDATA 'breathpause\error.log'
    $msg = '[' + (Get-Date).ToString('o') + '] ' + ($_ | Out-String) + $_.ScriptStackTrace
    try { New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null; Add-Content -Path $log -Value $msg } catch { }
    if ($Debug) { Write-Host $msg -ForegroundColor Red }
    try { Add-Type -AssemblyName PresentationFramework -ErrorAction Stop; [void][System.Windows.MessageBox]::Show($msg, 'breathpause error') }
    catch { Write-Host $msg -ForegroundColor Red; Read-Host 'Press Enter to exit' }
    exit 1
}
'@
[void]$sb.AppendLine($bootstrap)
foreach ($f in $files) {
    if (-not (Test-Path $f)) { continue }
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("# ===== $f =====")
    Get-Content $f | Where-Object { $_ -notmatch '^\s*\.\s+\$PSScriptRoot' } | ForEach-Object { [void]$sb.AppendLine($_) }
}
# Write UTF-8 WITH BOM so Windows PowerShell 5.1 reads it as UTF-8 (a BOM-less file is read
# as the system ANSI codepage, which corrupts any non-ASCII byte and breaks parsing).
[System.IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
Write-Host "Wrote $out ($((Get-Content $out).Count) lines)"

# Syntax check using the PowerShell language parser (no execution).
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($out, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_.Message }
    exit 1
}
Write-Host 'Syntax OK'

# Static gate: the parser accepts calls to functions that don't exist (they only fail at
# RUNTIME). Walk the AST and fail the build if any hyphenated command is neither a function
# defined in the bundle nor a real cmdlet/exe. Catches the "New-SwHeader not found" class.
$defined = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) |
    ForEach-Object { $_.Name } | Sort-Object -Unique
$called = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) |
    ForEach-Object { $_.GetCommandName() } | Where-Object { $_ -and $_ -match '-' } | Sort-Object -Unique
$undef = @()
foreach ($c in $called) {
    if ($defined -contains $c) { continue }
    if (Get-Command $c -ErrorAction SilentlyContinue) { continue }
    $undef += $c
}
if ($undef.Count -gt 0) {
    Write-Error ('Undefined commands called in bundle (would crash at runtime): ' + ($undef -join ', '))
    exit 1
}
Write-Host 'Static check OK (no undefined commands)'
