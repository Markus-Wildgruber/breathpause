# Mirrors test/macos/strings.test.js. Run: Invoke-Pester test/win
BeforeAll { . $PSScriptRoot/../../src/win/core/strings.ps1 }

Describe 'Get-DefaultStrings' {
    It 'exposes tray + break chrome strings' {
        $d = Get-DefaultStrings
        $d.version | Should -Be 1
        $d.tray.startTimer | Should -Be 'Start timer'
        $d.tray.exit | Should -Be 'Exit'
        $d.break.endBreak | Should -Be 'End break'
        $d.break.confirmTitle | Should -Be 'End the break?'
    }
}

Describe 'Get-NormalizedStrings' {
    It 'fills missing/blank keys from defaults' {
        $s = Get-NormalizedStrings @{ tray = @{ pause = 'Pausieren'; skip = '' }; break = @{ endBreak = 'Pause beenden' } }
        $s.tray.pause | Should -Be 'Pausieren'        # kept
        $s.tray.skip | Should -Be 'Skip'              # blank -> default
        $s.tray.settings | Should -Be 'Settings'      # missing -> default
        $s.break.endBreak | Should -Be 'Pause beenden' # kept
        $s.break.cancel | Should -Be 'Cancel'         # missing -> default
    }
}

Describe 'ConvertFrom/To-StringsJson' {
    It 'falls back to defaults on bad JSON and round-trips good JSON' {
        $bad = ConvertFrom-StringsJson 'not json'
        $bad.tray.exit | Should -Be 'Exit'
        $custom = Get-NormalizedStrings @{ tray = @{ exit = 'Beenden' } }
        $round = ConvertFrom-StringsJson (ConvertTo-StringsJson $custom)
        $round.tray.exit | Should -Be 'Beenden'
    }
}
