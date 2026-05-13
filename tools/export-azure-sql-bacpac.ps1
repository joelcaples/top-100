# Azure SQL Database Export to BACPAC and Download
#
# Usage:
#   1. Open PowerShell as Administrator
#   2. cd to your repo root
#   3. .\tools\export-azure-sql-bacpac.ps1
#
# This script will:
#   - Reset the SQL admin password (if needed)
#   - Start a BACPAC export to blob storage
#   - Poll for export completion
#   - Download the BACPAC file locally

param(
    [string]$ResourceGroup = "listflair-prod-rg",
    [string]$SqlServer = "listflairprod-sql-zag6fb",
    [string]$Database = "listflairprod-db",
    [string]$StorageAccount = "listflairprodzag6fb",
    [string]$Container = "generated-images",
    [string]$AdminUser = "sqladminuser",
    [string]$LocalDownloadPath = "./$($Database)-$(Get-Date -Format 'yyyyMMdd-HHmmss').bacpac",
    [switch]$ShowSecrets
)

function New-RandomPassword {
    $chars = ([char[]](65..90 + 97..122 + 48..57 + 33,35,37,42,45,95,61,43))
    $pw = -join (Get-Random -Count 24 -InputObject $chars)
    if ($pw -notmatch '[A-Z]') { $pw = 'A' + $pw.Substring(1) }
    if ($pw -notmatch '[a-z]') { $pw = 'a' + $pw.Substring(1) }
    if ($pw -notmatch '[0-9]') { $pw = '1' + $pw.Substring(1) }
    if ($pw -notmatch '[!#%*\-_=+]') { $pw = '!' + $pw.Substring(1) }
    return $pw
}

$ErrorActionPreference = 'Stop'

Write-Host "[1/6] Generating temporary SQL admin password..."

$tempPassword = New-RandomPassword
if ($ShowSecrets) {
    Write-Host "[DEBUG] Temp SQL admin password: $tempPassword"
} else {
    Write-Host "[DEBUG] Temp SQL admin password generated (hidden). Use -ShowSecrets to print it."
}

Write-Host "[2/6] Resetting SQL admin password..."
az sql server update --resource-group $ResourceGroup --name $SqlServer --admin-password $tempPassword -o none

Write-Host "[3/6] Getting storage key..."

$storageKey = az storage account keys list --resource-group $ResourceGroup --account-name $StorageAccount --query "[0].value" -o tsv
if ($storageKey.Length -ge 8) {
    $maskedStorageKey = ("*" * ($storageKey.Length - 4)) + $storageKey.Substring($storageKey.Length - 4)
} else {
    $maskedStorageKey = "****"
}
if ($ShowSecrets) {
    Write-Host "[DEBUG] Storage key: $storageKey"
} else {
    Write-Host "[DEBUG] Storage key (masked): $maskedStorageKey"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bacpacName = "$Database-$timestamp.bacpac"
$storageUri = "https://$StorageAccount.blob.core.windows.net/$Container/$bacpacName"
if (-not $PSBoundParameters.ContainsKey('LocalDownloadPath')) {
    $LocalDownloadPath = "./$bacpacName"
}

Write-Host "[4/6] Starting export to $storageUri ..."
$exportRaw = az sql db export --resource-group $ResourceGroup --server $SqlServer --name $Database --admin-user $AdminUser --admin-password $tempPassword --storage-key-type StorageAccessKey --storage-key $storageKey --storage-uri $storageUri -o json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Export command failed. Azure CLI output:"
    Write-Host ($exportRaw | Out-String)
    exit 1
}

$export = $null
try {
    $export = $exportRaw | ConvertFrom-Json
} catch {
    Write-Error "Export command returned non-JSON output. Raw output:"
    Write-Host ($exportRaw | Out-String)
    exit 1
}

if (-not $export.operationStatusLink) {
    if (-not $export.id -and -not $export.requestId -and -not $export.status) {
        Write-Error "Export did not start. No operationStatusLink/id/status returned. Raw response:"
        Write-Host ($exportRaw | Out-String)
        exit 1
    }
}

Write-Host "[5/6] Polling export status..."
$finalSucceeded = $false

if ($export.operationStatusLink) {
    do {
        Start-Sleep -Seconds 10
        $status = az rest --method get --url $export.operationStatusLink -o json | ConvertFrom-Json
        Write-Host "  Status: $($status.status)"
    } while ($status.status -eq 'InProgress')

    if ($status.status -eq 'Succeeded') {
        $finalSucceeded = $true
    } else {
        $errMsg = $null
        if ($status.PSObject.Properties["error"] -and $status.error -and $status.error.PSObject.Properties["message"]) {
            $errMsg = $status.error.message
        }
        Write-Error ("Export failed: " + ($errMsg | Out-String))
        exit 1
    }
} else {
    $opId = $null
    if ($export.id) {
        $opId = [string]$export.id
    } elseif ($export.requestId) {
        $opId = [string]$export.requestId
    }

    $currentState = if ($export.status) { [string]$export.status } else { "InProgress" }
    Write-Host "  Initial export status: $currentState"

    do {
        if ($currentState -in @("Completed", "Succeeded")) {
            $finalSucceeded = $true
            break
        }
        if ($currentState -in @("Failed", "Cancelled", "Canceled")) {
            Write-Error "Export failed with status: $currentState"
            exit 1
        }

        Start-Sleep -Seconds 10
        $ops = az sql db op list --resource-group $ResourceGroup --server $SqlServer --database $Database -o json | ConvertFrom-Json
        $exportOp = $null

        if ($opId) {
            $exportOp = $ops | Where-Object { $_.name -eq $opId } | Select-Object -First 1
        }
        if (-not $exportOp) {
            $exportOp = $ops |
                Where-Object { $_.operation -eq "ExportDatabase" } |
                Sort-Object { [datetime]$_.startTime } -Descending |
                Select-Object -First 1
        }

        if (-not $exportOp) {
            Write-Host "  Status: Unknown (waiting for export operation to appear)"
            continue
        }

        $currentState = [string]$exportOp.state
        Write-Host "  Status: $currentState ($($exportOp.percentComplete)% complete)"

        if ($currentState -in @("Succeeded", "Completed")) {
            $finalSucceeded = $true
            break
        }

        if ($currentState -in @("Failed", "Cancelled", "Canceled")) {
            $errDesc = if ($exportOp.errorDescription) { [string]$exportOp.errorDescription } else { "No error description provided." }
            Write-Error "Export failed: $errDesc"
            exit 1
        }
    } while ($true)
}

if (-not $finalSucceeded) {
    Write-Error "Export did not reach a successful terminal state."
    exit 1
}

Write-Host "[6/6] Downloading BACPAC to $LocalDownloadPath ..."
$downloaded = $false
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
for ($i = 1; $i -le 18; $i++) {
    az storage blob download --account-name $StorageAccount --account-key $storageKey --container-name $Container --name $bacpacName --file $LocalDownloadPath --output none --only-show-errors 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $LocalDownloadPath)) {
        $downloaded = $true
        break
    }
    Write-Host "  Download not ready yet (attempt $i/18), retrying in 10s..."
    Start-Sleep -Seconds 10
}
$ErrorActionPreference = $previousErrorAction

if (-not $downloaded) {
    Write-Error "Export appears complete but BACPAC could not be downloaded yet. Check blob $bacpacName in $Container."
    exit 1
}

Write-Host "Done! BACPAC downloaded to $LocalDownloadPath"
