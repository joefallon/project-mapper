[CmdletBinding(PositionalBinding = $false)]
param(
    [Alias('n')]
    [string]$Name = 'capture',

    [Alias('h')]
    [switch]$Help,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Command
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Show-Usage {
    Write-Host 'Usage:'
    Write-Host '  .ai\capture.ps1 [-n NAME] -- <command> [args...]'
    Write-Host ''
    Write-Host 'Examples:'
    Write-Host "  .ai\capture.ps1 -n gold_csv_disable_logic -- rg -B 2 -A 10 'csv' application\controllers\LeadSourceReportController.php"
    Write-Host '  .ai\capture.ps1 -- git diff -- application\controllers\LeadSourceReportController.php'
    Write-Host '  .ai\capture.ps1 -n spooler_status -- Get-Service Spooler'
}

function Format-CommandArg {
    param([string]$Arg)

    if ($null -eq $Arg) {
        return '""'
    }

    if ($Arg -match '^[A-Za-z0-9._/\\:\-]+$') {
        return $Arg
    }

    return '"' + ($Arg -replace '"', '\"') + '"'
}

function Write-CaptureText {
    param([string[]]$Lines)

    $Lines | Tee-Object -FilePath $script:OutPath -Append
}

if ($Help) {
    Show-Usage
    exit 0
}

if ($Command -and $Command.Length -gt 0 -and $Command[0] -eq '--') {
    if ($Command.Length -eq 1) {
        [Console]::Error.WriteLine('ERROR: no command provided')
        Show-Usage
        exit 2
    }

    if ($Command.Length -eq 2) {
        $Command = @($Command[1])
    }
    else {
        $Command = $Command[1..($Command.Length - 1)]
    }
}

if (-not $Command -or $Command.Length -eq 0) {
    [Console]::Error.WriteLine('ERROR: no command provided')
    Show-Usage
    exit 2
}

$outDir = Join-Path '.ai' 'out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$safeName = ($Name -replace '[ /:]', '-' -replace '[^A-Za-z0-9._-]', '')
if ([string]::IsNullOrWhiteSpace($safeName)) {
    $safeName = 'capture'
}

$script:OutPath = Join-Path $outDir ('{0}_{1}.txt' -f $ts, $safeName)
$displayCommand = ($Command | ForEach-Object { Format-CommandArg $_ }) -join ' '

Write-CaptureText @(
    '=== host ==='
    [System.Net.Dns]::GetHostName()
    ''
    '=== pwd ==='
    (Get-Location).Path
    ''
    '=== date ==='
    (Get-Date).ToString('o')
    ''
    '=== cmd ==='
    $displayCommand
    ''
    '=== out ==='
)

$status = 0
$global:LASTEXITCODE = 0

try {
    $commandName = $Command[0]
    $commandArgs = @()

    if ($Command.Length -gt 1) {
        $commandArgs = $Command[1..($Command.Length - 1)]
    }

    & $commandName @commandArgs 2>&1 | Tee-Object -FilePath $script:OutPath -Append

    if ($null -ne $LASTEXITCODE) {
        $status = [int]$LASTEXITCODE
    }
    else {
        $status = 0
    }
}
catch {
    $status = 1
    (($_ | Out-String).TrimEnd("`r", "`n")) | Tee-Object -FilePath $script:OutPath -Append
}
finally {
    Write-CaptureText @(
        ''
        '=== exit ==='
        "$status"
    )
}

if ($status -ne 0) {
    [Console]::Error.WriteLine(("WROTE: {0} (command failed with exit {1})" -f $script:OutPath, $status))
    [Console]::Error.WriteLine()
    [Console]::Error.WriteLine()
    exit $status
}

[Console]::Error.WriteLine(("WROTE: {0}" -f $script:OutPath))
[Console]::Error.WriteLine()
[Console]::Error.WriteLine()
