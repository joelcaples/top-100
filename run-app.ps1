$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js and try again."
}

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  throw "package.json not found in $projectRoot"
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  Write-Host "Installing dependencies..."
  Push-Location $projectRoot
  npm install
  Pop-Location
}

Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoExit",
  "-Command",
  "Set-Location '$projectRoot'; npm start"
)

Start-Process "http://localhost:3000"

Write-Host "Top 100 app launching..."
Write-Host "Server: http://localhost:3000"
