param([Parameter(Mandatory=$true)][int]$ProcessIdToStop,[Parameter(Mandatory=$true)][string]$ExpectedRoot)
$ErrorActionPreference='Stop'
$target=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessIdToStop"
if(-not $target){exit 0}
$resolved=(Resolve-Path -LiteralPath $ExpectedRoot).Path
if($target.Name -ne 'java.exe' -or $target.CommandLine.IndexOf($resolved,[System.StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'Prozess gehört nicht zur erwarteten lokalen Keycloak-Laufzeit.'}
Stop-Process -Id $ProcessIdToStop
