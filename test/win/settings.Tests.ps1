# Mirrors test/macos/settings.test.js. Run: Invoke-Pester test/win
BeforeAll { . $PSScriptRoot/../../src/win/core/settings.ps1 }

Describe 'Get-DefaultSettings' {
    It 'matches the SPEC schema' {
        $d = Get-DefaultSettings
        $d.version | Should -Be 1
        $d.workPatternId | Should -Be 'coherent-5-5'
        $d.timers.work | Should -Be '00:25'
        $d.timers.break | Should -Be '05:00'
        $d.appearance.collapsedDiameterPx | Should -Be 80
        $d.appearance.opacity | Should -Be 0.20
        $d.behavior.autoStartTimerOnLaunch | Should -BeTrue
        Test-Pattern $d.patterns[0] | Should -BeTrue
        $d.timers.longBreak | Should -Be '15:00'
        $d.cycle.longBreakEvery | Should -Be 4
        $d.cycle.autoContinue | Should -BeTrue
        $d.longBreakPatternId | Should -Be 'coherent-5-5'
        $d.appearance.showLabel | Should -BeTrue
        $d.appearance.font.family | Should -Be 'Segoe UI Variable'
        $d.appearance.font.size | Should -Be 16
        $d.appearance.font.countdownSize | Should -Be 13
        $d.appearance.font.pomodoroSize | Should -Be 12
        $d.appearance.theme | Should -Be 'system'
        $d.behavior.startOnBoot | Should -BeFalse
        $d.position.fromRight | Should -Be 16
        $d.position.fromTop | Should -Be 16
    }
}

Describe 'position (orb top-right anchor)' {
    It 'clamps negative offsets to zero' {
        $s = Get-NormalizedSettings @{ position = @{ fromRight = -5; fromTop = -1 } }
        $s.position.fromRight | Should -Be 0
        $s.position.fromTop | Should -Be 0
    }
    It 'falls back to the default when not a number' {
        $s = Get-NormalizedSettings @{ position = @{ fromRight = 'x' } }
        $s.position.fromRight | Should -Be 16
        $s.position.fromTop | Should -Be 16
    }
}

Describe 'Get-NormalizedSettings (added fields)' {
    It 'clamps longBreakEvery and font size, rejects bad longBreak timer' {
        $s = Get-NormalizedSettings @{
            cycle      = @{ longBreakEvery = 999 }
            timers     = @{ longBreak = 'nope' }
            appearance = @{ font = @{ family = ''; size = 999 } }
            behavior   = @{ startOnBoot = $true }
        }
        $s.cycle.longBreakEvery | Should -Be 99
        $s.timers.longBreak | Should -Be '15:00'
        $s.appearance.font.family | Should -Be 'Segoe UI Variable'
        $s.appearance.font.size | Should -Be 72
        $s.behavior.startOnBoot | Should -BeTrue
    }

    It 'keeps a valid theme and rejects an unknown one' {
        (Get-NormalizedSettings @{ appearance = @{ theme = 'light' } }).appearance.theme | Should -Be 'light'
        (Get-NormalizedSettings @{ appearance = @{ theme = 'dark' } }).appearance.theme | Should -Be 'dark'
        (Get-NormalizedSettings @{ appearance = @{ theme = 'neon' } }).appearance.theme | Should -Be 'system'
        (Get-NormalizedSettings @{}).appearance.theme | Should -Be 'system'
    }

    It 'exposes an app version distinct from the schema version' {
        Get-AppVersion | Should -Match '^\d+\.\d+\.\d+$'
        (Get-DefaultSettings).version | Should -Be 1
    }

    It 'migrates per-text font sizes from legacy size when absent' {
        $s = Get-NormalizedSettings @{ appearance = @{ font = @{ size = 20 } } }
        $s.appearance.font.size | Should -Be 20
        $s.appearance.font.countdownSize | Should -Be 16   # round(20 * 0.8)
        $s.appearance.font.pomodoroSize | Should -Be 14    # round(20 * 0.72)
    }

    It 'keeps and clamps per-text font sizes when present' {
        $s = Get-NormalizedSettings @{ appearance = @{ font = @{ size = 16; countdownSize = 30; pomodoroSize = 999 } } }
        $s.appearance.font.countdownSize | Should -Be 30
        $s.appearance.font.pomodoroSize | Should -Be 72    # clamped
    }
}

Describe 'Test-Pattern' {
    It 'rejects bad patterns' {
        Test-Pattern $null | Should -BeFalse
        Test-Pattern @{ id = 'x'; phases = @() } | Should -BeFalse
        Test-Pattern @{ id = 'x'; phases = @(@{ type = 'sniff'; seconds = 1 }) } | Should -BeFalse
        Test-Pattern @{ id = 'x'; phases = @(@{ type = 'inhale'; seconds = 0 }) } | Should -BeFalse
        Test-Pattern @{ id = 'x'; phases = @(@{ type = 'inhale'; seconds = 61 }) } | Should -BeFalse
        Test-Pattern @{ id = 'x'; phases = @(@{ type = 'hold'; seconds = 0.1 }) } | Should -BeTrue
    }
}

Describe 'Get-NormalizedSettings' {
    It 'clamps out-of-range numbers and bad colors' {
        $s = Get-NormalizedSettings @{ appearance = @{
                opacity = 5; collapsedDiameterPx = -10; expandedDiameterPx = 50
                breakSizePctScreenHeight = 999; colors = @{ workFill = 'red'; text = '#FFFFFF' }
            } }
        $s.appearance.opacity | Should -Be 1
        $s.appearance.collapsedDiameterPx | Should -Be 8
        $s.appearance.expandedDiameterPx | Should -Be 50
        $s.appearance.breakSizePctScreenHeight | Should -Be 100
        $s.appearance.colors.workFill | Should -Be (Get-DefaultSettings).appearance.colors.workFill
        $s.appearance.colors.text | Should -Be '#FFFFFF'
    }
    It 'rejects invalid timer strings, keeps valid' {
        $s = Get-NormalizedSettings @{ timers = @{ work = '00:00'; break = '03:30' } }
        $s.timers.work | Should -Be '00:25'
        $s.timers.break | Should -Be '03:30'
    }
    It 'bumps expanded diameter up to collapsed when it is smaller' {
        $s = Get-NormalizedSettings @{ appearance = @{ collapsedDiameterPx = 300; expandedDiameterPx = 100 } }
        $s.appearance.collapsedDiameterPx | Should -Be 300
        $s.appearance.expandedDiameterPx | Should -Be 300
    }
    It 'drops invalid patterns but keeps valid ones; falls back missing ids' {
        $s = Get-NormalizedSettings @{
            patterns = @(
                @{ id = 'good'; name = 'g'; phases = @(@{ type = 'inhale'; seconds = 2; label = 'in' }) },
                @{ id = 'bad'; phases = @() }
            )
            workPatternId = 'good'; breakPatternId = 'missing'
        }
        @($s.patterns).Count | Should -Be 1
        $s.workPatternId | Should -Be 'good'
        $s.breakPatternId | Should -Be 'good'
    }
}

Describe 'pattern resolution' {
    It 'resolves work/break patterns and missing ids' {
        $s = Get-DefaultSettings
        (Get-WorkPattern $s).id | Should -Be 'coherent-5-5'
        (Get-BreakPattern $s).id | Should -Be 'coherent-5-5'
        Find-Pattern $s 'nope' | Should -Be $null
    }
    It 'falls back to the first pattern when the configured id is unknown' {
        $s = @{
            patterns       = @(@{ id = 'only'; name = 'o'; phases = @(@{ type = 'inhale'; seconds = 2; label = 'in' }) })
            workPatternId  = 'nope'
            breakPatternId = 'nope'
        }
        (Get-WorkPattern $s).id  | Should -Be 'only'
        (Get-BreakPattern $s).id | Should -Be 'only'
    }
}

Describe 'Get-ClampedNumber' {
    It 'returns the default for non-numbers and NaN' {
        Get-ClampedNumber 'x' 0 10 5            | Should -Be 5
        Get-ClampedNumber ([double]::NaN) 0 10 5 | Should -Be 5
        Get-ClampedNumber 50 0 10 5             | Should -Be 10   # clamped to Hi
    }
}

Describe 'JSON round-trip' {
    It 'bad JSON falls back to defaults; good JSON normalizes' {
        $fromBad = ConvertFrom-SettingsJson 'not json{'
        $fromBad.timers.work | Should -Be '00:25'
        $round = ConvertFrom-SettingsJson (ConvertTo-SettingsJson (Get-DefaultSettings))
        $round.timers.break | Should -Be '05:00'
        $round.appearance.colors.workFill | Should -Be '#4FC3F7'
    }
    It 'fills defaults for keys absent from a partial JSON object' {
        $s = ConvertFrom-SettingsJson '{"timers":{"work":"00:30"}}'
        $s.timers.work | Should -Be '00:30'
        $s.timers.break | Should -Be '05:00'        # missing -> default
        $s.appearance.opacity | Should -Be 0.20      # whole section absent -> default
    }
}

Describe 'Test-HexColor' {
    It 'validates hex colors' {
        Test-HexColor '#aabbcc'   | Should -BeTrue
        Test-HexColor '#AABBCCDD' | Should -BeTrue
        Test-HexColor '#abc'      | Should -BeFalse
        Test-HexColor 'blue'      | Should -BeFalse
    }
}
