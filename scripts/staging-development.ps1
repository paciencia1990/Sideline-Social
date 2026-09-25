# Run in VS Code's PowerShell terminal. Default mode performs local checks only.
param(
  [ValidateSet('Check', 'Build', 'Start')]
  [string]$Mode = 'Check',
  [string]$PrivateConfig = "$env:LOCALAPPDATA\SidelineSocial\staging-development\config.json"
)
$ErrorActionPreference = 'Stop'
$Node = (Get-Command node.exe -ErrorAction Stop).Source
& $Node "$PSScriptRoot\staging-development.cjs" $Mode $PrivateConfig
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
