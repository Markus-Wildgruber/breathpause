# Mirrors test/macos/timefmt.test.js. Run: Invoke-Pester test/win
BeforeAll { . $PSScriptRoot/../../src/win/core/timefmt.ps1 }

Describe 'Get-WorkSeconds (hh:mm)' {
    It 'parses valid values (25 min is 00:25, not 25:00)' {
        Get-WorkSeconds '00:25' | Should -Be (25 * 60)
        Get-WorkSeconds '25:00' | Should -Be (25 * 3600)
        Get-WorkSeconds '01:30' | Should -Be (3600 + 30 * 60)
        Get-WorkSeconds '00:01' | Should -Be 60
        Get-WorkSeconds '99:59' | Should -Be (99 * 3600 + 59 * 60)
    }
    It 'rejects zero / out-of-range / malformed' {
        Get-WorkSeconds '00:00'  | Should -Be $null
        Get-WorkSeconds '00:60'  | Should -Be $null
        Get-WorkSeconds '100:00' | Should -Be $null
        Get-WorkSeconds '5:5'    | Should -Be $null
        Get-WorkSeconds ''       | Should -Be $null
        Get-WorkSeconds 'abc'    | Should -Be $null
    }
}

Describe 'Get-BreakSeconds (mm:ss)' {
    It 'parses valid values' {
        Get-BreakSeconds '05:00' | Should -Be 300
        Get-BreakSeconds '00:01' | Should -Be 1
        Get-BreakSeconds '59:59' | Should -Be (59 * 60 + 59)
    }
    It 'rejects zero / out-of-range' {
        Get-BreakSeconds '00:00' | Should -Be $null
        Get-BreakSeconds '60:00' | Should -Be $null
        Get-BreakSeconds '05:60' | Should -Be $null
    }
}

Describe 'Format-Remaining' {
    It 'formats under and over an hour' {
        Format-Remaining 0    | Should -Be '00:00'
        Format-Remaining 5    | Should -Be '00:05'
        Format-Remaining 125  | Should -Be '02:05'
        Format-Remaining 3600 | Should -Be '1:00:00'
        Format-Remaining 3661 | Should -Be '1:01:01'
        Format-Remaining -10  | Should -Be '00:00'
    }
}

Describe 'Format-Pad2' {
    It 'pads single digits, leaves two-digit values as-is' {
        Format-Pad2 3  | Should -Be '03'
        Format-Pad2 42 | Should -Be '42'
    }
}

Describe 'Convert-ClockToParts' {
    It 'returns null for a null value' {
        Convert-ClockToParts $null | Should -Be $null
    }
}
