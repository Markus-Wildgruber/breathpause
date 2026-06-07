# Windows test runner: Pester + coverage + 80%-core soft gate (SPEC §11).
# Requires Pester 5 (Install-Module Pester). For the browsable HTML report:
#   reportgenerator -reports:coverage/win/coverage.xml -targetdir:coverage/win -reporttypes:Html
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

Import-Module Pester -MinimumVersion 5.0

$cfg = New-PesterConfiguration
$cfg.Run.Path = Join-Path $root 'test/win'
$cfg.Run.PassThru = $true   # required for $r.CodeCoverage to be returned
$cfg.CodeCoverage.Enabled = $true
$cfg.CodeCoverage.Path = Join-Path $root 'src/win/core'
$cfg.CodeCoverage.OutputFormat = 'JaCoCo'
$cfg.CodeCoverage.OutputPath = Join-Path $root 'coverage/win/coverage.xml'
$cfg.Output.Verbosity = 'Detailed'

$r = Invoke-Pester -Configuration $cfg

$pct = if ($r.CodeCoverage) { [double]$r.CodeCoverage.CoveragePercent } else { 0 }
if ($pct -lt 80) {
    Write-Warning ("Lowest core coverage {0:N2}% < 80% target (soft gate, not failing)." -f $pct)
}
else {
    Write-Host ("Core coverage OK: {0:N2}% >= 80%." -f $pct)
}
