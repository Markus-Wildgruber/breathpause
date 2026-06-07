# Mirrors test/macos/pomodoro.test.js. Run: Invoke-Pester test/win
BeforeAll {
    . $PSScriptRoot/../../src/win/core/pomodoro.ps1
    function Init { New-PomodoroState 1500 300 }
}

Describe 'New-PomodoroState' {
    It 'auto-starts in work mode' {
        $s = Init
        $s.running | Should -BeTrue
        $s.mode | Should -Be 'work'
        $s.remaining | Should -Be 1500
        $s.paused | Should -BeFalse
        $s.cyclesCompleted | Should -Be 0
    }
}

Describe 'Invoke-PomodoroTick' {
    It 'decrements without mutating the input' {
        $s = Init
        $r = Invoke-PomodoroTick $s 10
        $r.state.remaining | Should -Be 1490
        $r.events.Count | Should -Be 0
        $s.remaining | Should -Be 1500
    }
    It 'fires work_complete + break_start at the work boundary' {
        $r = Invoke-PomodoroTick (Init) 1500
        $r.state.mode | Should -Be 'break'
        $r.state.remaining | Should -Be 300
        ($r.events -join ',') | Should -Be 'work_complete,break_start'
    }
    It 'loops a full cycle back to work and counts it' {
        $r = Invoke-PomodoroTick (Init) (1500 + 300)
        $r.state.mode | Should -Be 'work'
        $r.state.remaining | Should -Be 1500
        $r.state.cyclesCompleted | Should -Be 1
        ($r.events -join ',') | Should -Be 'work_complete,break_start,break_complete,session_start'
    }
    It 'carries a large dt across multiple boundaries' {
        $r = Invoke-PomodoroTick (Init) (1500 + 300 + 1500 + 300 + 10)
        $r.state.mode | Should -Be 'work'
        $r.state.cyclesCompleted | Should -Be 2
        $r.state.remaining | Should -Be 1490
    }
}

Describe 'Limit-FrameDt' {
    It 'passes a normal small frame delta through unchanged' {
        Limit-FrameDt 0.033 2.0 | Should -Be 0.033
    }
    It 'clamps a large delta (sleep/hibernate gap) to the cap' {
        Limit-FrameDt 7200 2.0 | Should -Be 2.0
    }
    It 'returns the cap exactly at the boundary' {
        Limit-FrameDt 2.0 2.0 | Should -Be 2.0
    }
    It 'floors a negative delta to zero' {
        Limit-FrameDt -5 2.0 | Should -Be 0
    }
}

Describe 'pause / resume' {
    It 'freezes then unfreezes the clock' {
        $s = Suspend-Pomodoro (Init)
        $s.paused | Should -BeTrue
        $frozen = Invoke-PomodoroTick $s 100
        $frozen.state.remaining | Should -Be 1500
        $frozen.events.Count | Should -Be 0
        $s2 = Resume-Pomodoro $frozen.state
        (Invoke-PomodoroTick $s2 100).state.remaining | Should -Be 1400
    }
}

Describe 'skip / reset' {
    It 'skip ends the current segment immediately' {
        $r = Invoke-PomodoroSkip (Init)
        $r.state.mode | Should -Be 'break'
        ($r.events -join ',') | Should -Be 'work_complete,break_start'
    }
    It 'reset stops back to breathing-only work' {
        $inBreak = (Invoke-PomodoroTick (Init) 1500).state
        $r = Reset-PomodoroState $inBreak
        $r.running | Should -BeFalse
        $r.mode | Should -Be 'work'
        $r.remaining | Should -Be 1500
        (Invoke-PomodoroTick $r 100).state.remaining | Should -Be 1500
        (Invoke-PomodoroSkip $r).events.Count | Should -Be 0
    }
}

Describe 'Get-SegmentLength' {
    It 'reports per-mode length' {
        $s = Init
        Get-SegmentLength $s 'work'  | Should -Be 1500
        Get-SegmentLength $s 'break' | Should -Be 300
    }
}

Describe 'long break every N rounds' {
    It 'makes every Nth break long' {
        $s = New-PomodoroState 100 10 30 2   # work100, short10, long30, every 2
        $s = (Invoke-PomodoroTick $s 100).state
        $s.mode | Should -Be 'break'; $s.breakKind | Should -Be 'short'; $s.remaining | Should -Be 10
        $s = (Invoke-PomodoroTick $s 10).state
        $s.workCount | Should -Be 1; $s.cyclesCompleted | Should -Be 1
        $s = (Invoke-PomodoroTick $s 100).state
        $s.breakKind | Should -Be 'long'; $s.remaining | Should -Be 30
        Get-SegmentLength $s 'break' | Should -Be 30
    }
    It 'longBreakEvery 0 disables long breaks' {
        $s = New-PomodoroState 100 10 30 0
        for ($i = 0; $i -lt 3; $i++) {
            $s = (Invoke-PomodoroTick $s 100).state
            $s.breakKind | Should -Be 'short'
            $s = (Invoke-PomodoroTick $s $s.remaining).state
        }
    }
    It 'autoContinue=false pauses the next segment until Resume' {
        $s = New-PomodoroState 100 10 30 0 $false
        $s = (Invoke-PomodoroTick $s 100).state
        $s.mode | Should -Be 'break'; $s.paused | Should -BeTrue; $s.remaining | Should -Be 10
        (Invoke-PomodoroTick $s 5).state.remaining | Should -Be 10
        $s = Resume-Pomodoro $s
        $s = (Invoke-PomodoroTick $s 10).state
        $s.mode | Should -Be 'work'; $s.paused | Should -BeTrue
    }
    It 'autoContinue default true loops without pausing' {
        $s = New-PomodoroState 100 10 30 0
        $s = (Invoke-PomodoroTick $s 110).state
        $s.paused | Should -BeFalse; $s.mode | Should -Be 'work'
    }
    It 'defaults to short breaks when no long-break args given' {
        $s = New-PomodoroState 1500 300
        $s.longBreakEvery | Should -Be 0
        $s = (Invoke-PomodoroTick $s 1500).state
        $s.breakKind | Should -Be 'short'; $s.remaining | Should -Be 300
    }
}
