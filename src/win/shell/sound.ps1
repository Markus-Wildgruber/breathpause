# shell/sound — transition chime. WinForms SystemSounds. (SPEC §5)
# ⚠️ UNVERIFIED SCAFFOLDING — written without Windows; debug on-device.

function Play-Chime {
    param([bool]$Enabled)
    if (-not $Enabled) { return }
    try { [System.Media.SystemSounds]::Asterisk.Play() } catch { }
}
