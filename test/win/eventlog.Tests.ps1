# Mirrors test/macos/eventlog.test.js. Run: Invoke-Pester test/win
BeforeAll { . $PSScriptRoot/../../src/win/core/eventlog.ps1 }

Describe 'Test-EventName' {
    It 'matches the SPEC event set' {
        Test-EventName 'session_start' | Should -BeTrue
        Test-EventName 'work_complete' | Should -BeTrue
        Test-EventName 'quit'          | Should -BeTrue
        Test-EventName 'nope'          | Should -BeFalse
        (Get-EventNames).Count         | Should -Be 9
    }
}

Describe 'New-EventRecord' {
    It 'builds ts+event and merges extra' {
        $rec = New-EventRecord 'break_start' '2026-06-03T10:00:00.000Z' @{ mode = 'break'; cycle = 2 }
        $rec.ts | Should -Be '2026-06-03T10:00:00.000Z'
        $rec.event | Should -Be 'break_start'
        $rec.mode | Should -Be 'break'
        $rec.cycle | Should -Be 2
    }
    It 'ignores attempts to override ts/event via extra' {
        $rec = New-EventRecord 'pause' 'T' @{ ts = 'X'; event = 'Y'; note = 'ok' }
        $rec.ts | Should -Be 'T'
        $rec.event | Should -Be 'pause'
        $rec.note | Should -Be 'ok'
    }
    It 'tolerates missing extra' {
        $rec = New-EventRecord 'resume' 'T'
        $rec.ts | Should -Be 'T'
        $rec.event | Should -Be 'resume'
    }
}

Describe 'ConvertTo-EventLine' {
    It 'produces single-line JSON' {
        $line = ConvertTo-EventLine (New-EventRecord 'quit' 'T')
        $line | Should -Be '{"ts":"T","event":"quit"}'
        $line.Contains("`n") | Should -BeFalse
    }
}
