# Mirrors test/macos/breathing.test.js. Run: Invoke-Pester test/win
BeforeAll {
    . $PSScriptRoot/../../src/win/core/breathing.ps1
    $script:DEFAULT = @{ phases = @(
            @{ type = 'inhale'; seconds = 3; label = 'Breathe in' },
            @{ type = 'exhale'; seconds = 5; label = 'Breathe out' }
        ) }
    function Close([double]$a, [double]$b) { [math]::Abs($a - $b) -le 1e-9 }
}

Describe 'Get-EaseInOut' {
    It 'has correct endpoints and midpoint' {
        Get-EaseInOut 0   | Should -Be 0
        Get-EaseInOut 1   | Should -Be 1
        Close (Get-EaseInOut 0.5) 0.5 | Should -BeTrue
        Get-EaseInOut -1  | Should -Be 0
        Get-EaseInOut 2   | Should -Be 1
    }
}

Describe 'Get-CycleDuration' {
    It 'sums phases' {
        Get-CycleDuration $DEFAULT | Should -Be 8
        Get-CycleDuration @{ phases = @() } | Should -Be 0
    }
}

Describe 'Get-SizeAt' {
    It 'goes 0 -> 1 -> 0 and loops continuously' {
        Close (Get-SizeAt $DEFAULT 0) 0 | Should -BeTrue
        Close (Get-SizeAt $DEFAULT 3) 1 | Should -BeTrue
        Close (Get-SizeAt $DEFAULT 8) 0 | Should -BeTrue
        (Get-SizeAt $DEFAULT 1.5) -gt 0 -and (Get-SizeAt $DEFAULT 1.5) -lt 1 | Should -BeTrue
        Close (Get-SizeAt $DEFAULT 2) (Get-SizeAt $DEFAULT 10) | Should -BeTrue
    }
    It 'holds keep the inherited size (box pattern)' {
        $box = @{ phases = @(
                @{ type = 'inhale'; seconds = 4; label = 'in' },
                @{ type = 'hold'; seconds = 4; label = 'hold' },
                @{ type = 'exhale'; seconds = 4; label = 'out' },
                @{ type = 'hold'; seconds = 4; label = 'hold' }
            ) }
        Close (Get-SizeAt $box 4) 1  | Should -BeTrue
        Close (Get-SizeAt $box 6) 1  | Should -BeTrue
        Close (Get-SizeAt $box 8) 1  | Should -BeTrue
        Close (Get-SizeAt $box 12) 0 | Should -BeTrue
        Close (Get-SizeAt $box 14) 0 | Should -BeTrue
    }
    It 'all-hold pattern settles to 0' {
        Close (Get-SizeAt @{ phases = @(@{ type = 'hold'; seconds = 2; label = 'h' }) } 1) 0 | Should -BeTrue
    }
}

Describe 'Get-PhaseAt / Get-CurrentLabel' {
    It 'reports index/label/remaining' {
        $info = Get-PhaseAt $DEFAULT 4
        $info.index | Should -Be 1
        $info.phase.label | Should -Be 'Breathe out'
        Close $info.remaining 4 | Should -BeTrue
        Get-CurrentLabel $DEFAULT 1 | Should -Be 'Breathe in'
        Get-CurrentLabel $DEFAULT 5 | Should -Be 'Breathe out'
    }
    It 'is safe for empty patterns' {
        Get-SizeAt @{ phases = @() } 1     | Should -Be 0
        Get-PhaseAt @{ phases = @() } 1    | Should -Be $null
        Get-CurrentLabel @{ phases = @() } 1 | Should -Be ''
    }
    It 'returns an empty label for a phase without one' {
        Get-CurrentLabel @{ phases = @(@{ type = 'inhale'; seconds = 2 }) } 1 | Should -Be ''
    }
}

Describe 'Get-BoundarySizes' {
    It 'tolerates a null / empty pattern (null-guard branch)' {
        Get-BoundarySizes $null            | Should -Be 0
        Get-BoundarySizes @{ phases = @() } | Should -Be 0
    }
}

Describe 'Get-DiameterForSize' {
    It 'maps 0..1 to px range' {
        Get-DiameterForSize 0 80 200   | Should -Be 80
        Get-DiameterForSize 1 80 200   | Should -Be 200
        Get-DiameterForSize 0.5 80 200 | Should -Be 140
    }
}
