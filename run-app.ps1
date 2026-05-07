$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiRoot = Join-Path $projectRoot "api"

# Local development OAuth credentials (kept out of production config).
$env:GITHUB_CLIENT_ID = "Ov23liTI1dMPWzifsk7i"
$env:GITHUB_CLIENT_SECRET = "2831b7a8fccaa16696bd4a13d56dd104a9544846"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet was not found. Install .NET 10 SDK and try again."
}

if (-not (Test-Path (Join-Path $apiRoot "ListFlair.Api.csproj"))) {
  throw "ListFlair.Api.csproj not found in $apiRoot"
}

$projectRootPattern = [Regex]::Escape($projectRoot)

$listeningProcessIds = @(
  Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
)

foreach ($processId in $listeningProcessIds) {
  if ($processId -and $processId -ne $PID) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

$nodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessId -ne $PID -and (
      $_.CommandLine -match $projectRootPattern -or
      $_.CommandLine -match "server\.js"
    )
  }

foreach ($process in $nodeProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoExit",
  "-Command",
  "`$env:GITHUB_CLIENT_ID = 'Ov23liTI1dMPWzifsk7i'; `$env:GITHUB_CLIENT_SECRET = '2831b7a8fccaa16696bd4a13d56dd104a9544846'; Set-Location '$apiRoot'; dotnet run"
)

Start-Process "http://localhost:3000"

Write-Host "ListFlair app launching..."
Write-Host "Server: http://localhost:3000"
