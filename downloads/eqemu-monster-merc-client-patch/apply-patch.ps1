param(
    [Parameter(Mandatory = $true)]
    [string]$EqPath
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dbstrFile = Join-Path $EqPath "dbstr_us.txt"
$patchFile = Join-Path $scriptDir "dbstr_us.append.txt"

if (-not (Test-Path $dbstrFile)) {
    Write-Error "dbstr_us.txt not found at: $dbstrFile"
    exit 1
}

if (-not (Test-Path $patchFile)) {
    Write-Error "Patch file not found at: $patchFile"
    exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = "$dbstrFile.bak.$timestamp"
Copy-Item $dbstrFile $backupFile -Force

$existing = New-Object 'System.Collections.Generic.HashSet[string]'
Get-Content $dbstrFile | ForEach-Object { [void]$existing.Add($_) }

$added = 0
foreach ($line in Get-Content $patchFile) {
    if ([string]::IsNullOrWhiteSpace($line)) {
        continue
    }

    if (-not $existing.Contains($line)) {
        Add-Content -Path $dbstrFile -Value $line
        [void]$existing.Add($line)
        $added++
    }
}

Write-Host "Backup created: $backupFile"
Write-Host "Lines added: $added"
Write-Host "Done. Restart the EQ client and test the merc window again."
