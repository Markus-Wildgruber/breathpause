# Mirrors test/macos/hotkeys.test.js. Run: Invoke-Pester test/win
BeforeAll { . $PSScriptRoot/../../src/win/core/hotkeys.ps1 }

Describe 'ConvertTo-HotkeyVk' {
    It 'maps letters/digits/F-keys' {
        ConvertTo-HotkeyVk 'P'   | Should -Be 0x50
        ConvertTo-HotkeyVk 'a'   | Should -Be 0x41
        ConvertTo-HotkeyVk '5'   | Should -Be 0x35
        ConvertTo-HotkeyVk 'F1'  | Should -Be 0x70
        ConvertTo-HotkeyVk 'F12' | Should -Be 0x7B
        ConvertTo-HotkeyVk 'F13' | Should -Be $null
    }
}

Describe 'Convert-FromHotkeyString' {
    It 'parses valid combos' {
        $r = Convert-FromHotkeyString 'Ctrl+Alt+P'
        $r.vk | Should -Be 0x50
        ($r.mods -join ',') | Should -Be '17,18'   # 0x11,0x12
        (Convert-FromHotkeyString 'Ctrl+Shift+F3').vk | Should -Be 0x72
        (Convert-FromHotkeyString 'Win+Q').vk | Should -Be 0x51
        (Convert-FromHotkeyString 'Win+Q').mods -join ',' | Should -Be '91'  # 0x5B
        (Convert-FromHotkeyString 'Control+P').mods -join ',' | Should -Be '17'  # 'control' alias of 'ctrl'
    }
    It 'rejects bare key / empty / modifier-only' {
        Convert-FromHotkeyString 'P'        | Should -Be $null
        Convert-FromHotkeyString ''         | Should -Be $null
        Convert-FromHotkeyString 'Ctrl+Alt' | Should -Be $null
    }
}
