#Requires -Version 5.1
param(
  [string]$JdkHome = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Lab = Join-Path $Root "lab"
$Vendor = Join-Path $Root "vendor"

if (-not $JdkHome) {
  $candidates = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  if ($candidates) { $JdkHome = $candidates[0].FullName }
}
if (-not $JdkHome) { throw "JDK 17 not found. Pass -JdkHome." }

$javac = Join-Path $JdkHome "bin\javac.exe"
$cp = @(
  (Join-Path $Vendor "asm-9.8.jar"),
  (Join-Path $Vendor "asm-tree-9.8.jar"),
  (Join-Path $Vendor "mixin-0.8.5.jar")
) -join ";"

$files = @(
  "MiniClassProvider.java",
  "MiniBytecodeProvider.java",
  "MiniConfigStream.java",
  "MiniContainer.java",
  "MiniLogger.java",
  "MiniMixinService.java",
  "ConfigHolder.java",
  "RealMixin.java",
  "RealMixinTest.java"
) | ForEach-Object { Join-Path $Lab $_ }

& $javac -proc:none -nowarn -source 17 -target 17 -cp $cp -d $Lab @files
if ($LASTEXITCODE -ne 0) { throw "javac failed" }
Write-Host "compiled $($files.Count) files"
