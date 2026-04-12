param(
    [Parameter(Mandatory = $false)]
    [string]$EqPath
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$patcherUrl = "https://dev.deacyde.com/eqemu/patcher.txt"

if ([string]::IsNullOrWhiteSpace($EqPath)) {
    try {
        $manifest = (Invoke-WebRequest -UseBasicParsing -Uri $patcherUrl).Content
    }
    catch {
        Write-Error "Failed to fetch patch manifest: $patcherUrl"
        exit 1
    }

    $lines = $manifest -split "`r?`n"
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -eq "Client root:" -and ($i + 1) -lt $lines.Length) {
            $EqPath = $lines[$i + 1].Trim()
            break
        }
    }

    if ([string]::IsNullOrWhiteSpace($EqPath)) {
        Write-Error "Could not find 'Client root' in patch manifest."
        exit 1
    }
}

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

Write-Host "EQ path: $EqPath"
Write-Host "Backup created: $backupFile"
Write-Host "Lines added: $added"
Write-Host "Done. Restart the EQ client and test the merc window again."
