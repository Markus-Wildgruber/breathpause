# build-msi — wrap dist/breathpause.ps1 into a winget-installable MSI via the WiX v5 .NET tool.
# Prerequisite (CI installs it; locally run once): dotnet tool install --global wix
# Run build-win.ps1 first so dist/breathpause.ps1 exists.
param(
    [Parameter(Mandatory)][string]$Version,                              # numeric x.y.z (no leading 'v')
    [string]$Script = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist/breathpause.ps1'),
    [string]$Out    = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist/breathpause-$Version.msi")
)
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be numeric x.y.z (got '$Version')" }
if (-not (Test-Path $Script)) { throw "Bundle not found: $Script (run build-win.ps1 first)" }

$wxs = Join-Path $PSScriptRoot 'breathpause.wxs'
& wix build $wxs -d "Version=$Version" -d "ScriptPath=$Script" -o $Out
if ($LASTEXITCODE -ne 0) { throw "wix build failed (exit $LASTEXITCODE)" }
Write-Host "Wrote $Out"
