param([int]$ProcessIdToCheck,[string]$ExpectedScript)
$ErrorActionPreference='Stop'
$workerProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessIdToCheck" -ErrorAction SilentlyContinue
if(-not $workerProcess -or $workerProcess.Name -ne 'node.exe'){exit 1}
$expected=[IO.Path]::GetFullPath($ExpectedScript).Replace('\','/')
$commandLine=([string]$workerProcess.CommandLine).Replace('\','/')
if($commandLine.IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -lt 0){exit 1}
exit 0
