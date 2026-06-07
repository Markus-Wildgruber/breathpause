# hotkeys - parse a hotkey string ("Ctrl+Alt+P") into modifier VKs + a key VK. Pure logic. (SPEC §6)
# A modifier is required; bare keys / empty strings are rejected (return $null = disabled).
# Mirrors src/macos/core/hotkeys.js.

# Key token (A-Z, 0-9, F1-F12) -> Windows virtual-key code, or $null.
function ConvertTo-HotkeyVk {
    param([string]$K)
    $u = $K.Trim().ToUpper()
    if ($u.Length -eq 1 -and $u -match '^[A-Z0-9]$') { return [int][char]$u }   # A-Z 0x41-5A, 0-9 0x30-39
    if ($u -match '^F([1-9]|1[0-2])$') { return 0x70 + ([int]$Matches[1] - 1) } # F1-F12 0x70-7B
    return $null
}

# "Ctrl+Alt+P" -> @{ mods=@(<vk>...); vk=<vk>; down=$false }, or $null.
function Convert-FromHotkeyString {
    param([string]$S)
    if (-not $S) { return $null }
    $mods = @(); $vk = $null
    foreach ($p in ($S -split '\+')) {
        switch ($p.Trim().ToLower()) {
            'ctrl' { $mods += 0x11 }      # VK_CONTROL
            'control' { $mods += 0x11 }
            'alt' { $mods += 0x12 }       # VK_MENU
            'shift' { $mods += 0x10 }     # VK_SHIFT
            'win' { $mods += 0x5B }       # VK_LWIN
            default { $vk = ConvertTo-HotkeyVk $p }
        }
    }
    if ($null -eq $vk -or $mods.Count -eq 0) { return $null }  # require a key AND >=1 modifier
    return @{ mods = $mods; vk = $vk; down = $false }
}
