#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot "build.ps1") @args
Push-Location (Join-Path $Root "lab")
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node not found on PATH"
  }
  node run-realmixin.mjs
} finally {
  Pop-Location
}
