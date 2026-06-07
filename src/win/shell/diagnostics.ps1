# shell/diagnostics - `-Debug` self-check ("doctor"). Verifies each subsystem in isolation
# and reports exactly where startup fails, instead of the window vanishing. (SPEC §13)
# Baked into the bundle: run `dist\breathpause.ps1 -Debug`.

# Sets $script:LastCheckOk (no return value, so nothing leaks to the console).
function Write-Check {
    param([string]$Name, [scriptblock]$Test)
    try {
        $out = @(& $Test)                 # tolerate scriptblocks that emit extra objects
        $detail = if ($out.Count) { $out[-1] } else { $null }
        $suffix = if ($detail) { " - $detail" } else { '' }
        Write-Host ("  [ OK ] {0}{1}" -f $Name, $suffix) -ForegroundColor Green
        $script:LastCheckOk = $true
    }
    catch {
        Write-Host ("  [FAIL] {0} - {1}" -f $Name, $_.Exception.Message) -ForegroundColor Red
        $script:DoctorErrors += [pscustomobject]@{ step = $Name; error = ($_ | Out-String) + $_.ScriptStackTrace }
        $script:LastCheckOk = $false
    }
}

# Runs all checks, prints a report, and writes failures to debug.log. Does NOT enter the
# message loop - it tears down what it created and returns.
function Invoke-Doctor {
    param($Settings)
    $script:DoctorErrors = @()

    Write-Host 'breathpause - debug doctor' -ForegroundColor Cyan
    Write-Host ('PowerShell {0} ({1})  Apartment={2}  OS={3}' -f `
            $PSVersionTable.PSVersion, $PSVersionTable.PSEdition, `
            [Threading.Thread]::CurrentThread.GetApartmentState(), [Environment]::OSVersion.VersionString)
    Write-Host 'Checks:'

    Write-Check 'Thread is STA (required for WPF)' {
        if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'thread is MTA - run under powershell.exe (Windows PowerShell) or with -STA' }
        'STA'
    }
    Write-Check 'WPF assemblies load' { Add-Type -AssemblyName PresentationFramework -ErrorAction Stop; 'PresentationFramework' }
    Write-Check 'WinForms assemblies load' { Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; 'System.Windows.Forms' }
    Write-Check 'BPNative (DWM/click-through P-Invoke) compiled' {
        if (-not ('BPNative' -as [type])) { throw 'BPNative type not defined - Add-Type for the native helper failed' }
        'present'
    }
    Write-Check 'Config dir writable' {
        $d = Get-ConfigDir; $t = Join-Path $d '.writetest'
        Set-Content -Path $t -Value 'x'; Remove-Item $t -Force -ErrorAction SilentlyContinue; $d
    }
    Write-Check 'Settings load & normalize' { $s = Read-AppSettings; "$(@($s.patterns).Count) pattern(s)" }
    Write-Check 'Timers parse' {
        $w = Get-WorkSeconds $Settings.timers.work; $b = Get-BreakSeconds $Settings.timers.break
        if ($null -eq $w -or $null -eq $b) { throw "invalid timers work='$($Settings.timers.work)' break='$($Settings.timers.break)'" }
        "work=$w s, break=$b s"
    }
    Write-Check 'Patterns resolve' { $null = Get-WorkPattern $Settings; $null = Get-BreakPattern $Settings; 'work + break' }

    Write-Check 'Create always-on-top window' { New-BubbleWindow $Settings; 'created' }
    if ($script:LastCheckOk) {
        Write-Check 'Enable DWM acrylic blur' { if ($script:Hwnd) { [BPNative]::EnableBlur($script:Hwnd, (Get-AccentColor $Settings.appearance.colors.breakOverlayTint)) }; 'applied' }
        Write-Check 'Render a frame' { Update-Bubble 'work' 0.5 'Breathe in' '3' '24:13'; 'rendered' }
        Write-Check 'Create tray icon' { New-Tray @{ OnStartStop = {}; OnPauseResume = {}; OnSkip = {}; OnSettings = {}; OnQuit = {} }; Set-TrayRunning $true; 'created' }
        Write-Check 'Build settings window' { $sw = New-SettingsWindow $Settings (Get-DefaultStrings) { } { } { }; $sw.Close(); 'built' }
        Write-Check 'Write a test event to events.log' { Add-AppEvent 'session_start' @{ mode = 'doctor' }; (Join-Path (Get-ConfigDir) 'events.log') }
        try { Remove-Tray } catch { }
        try { $script:Win.Close() } catch { }
    }

    Write-Host ''
    if ($script:DoctorErrors.Count -eq 0) {
        Write-Host 'All checks passed - the environment looks good.' -ForegroundColor Green
    }
    else {
        Write-Host ("{0} check(s) FAILED:" -f $script:DoctorErrors.Count) -ForegroundColor Red
        foreach ($e in $script:DoctorErrors) { Write-Host ("--- {0} ---`n{1}" -f $e.step, $e.error) -ForegroundColor DarkYellow }
        $log = Join-Path (Get-ConfigDir) 'debug.log'
        ($script:DoctorErrors | ForEach-Object { "[$($_.step)]`n$($_.error)" }) | Set-Content -Path $log -Encoding UTF8
        Write-Host "Full details written to: $log" -ForegroundColor Cyan
    }
}
