#Requires -Version 5.1
<#
  Downloads the third-party runtime dependencies and extracts the JDK classes
  used by the browser runtime.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
    powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -JdkHome "C:\Program Files\Eclipse Adoptium\jdk-17..."
#>
param(
  [string]$JdkHome = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path $PSScriptRoot -Parent
$Lab = Join-Path $Root "lab"
$Vendor = Join-Path $Root "vendor"
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null

function Expand-Classes([string]$Jar, [string]$Target) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Jar)
  try {
    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName.EndsWith(".class")) { continue }
      $dest = Join-Path $Target $entry.FullName
      $dir = Split-Path $dest -Parent
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
    }
  } finally {
    $zip.Dispose()
  }
}

$deps = @(
  @{ Name = "asm-9.8.jar";       Url = "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.8/asm-9.8.jar";             Dir = "asm" },
  @{ Name = "asm-tree-9.8.jar";  Url = "https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.8/asm-tree-9.8.jar";   Dir = "asm" },
  @{ Name = "mixin-0.8.5.jar";   Url = "https://repo1.maven.org/maven2/org/spongepowered/mixin/0.8.5/mixin-0.8.5.jar"; Dir = "mixin" },
  @{ Name = "guava-31.1-jre.jar"; Url = "https://repo1.maven.org/maven2/com/google/guava/guava/31.1-jre/guava-31.1-jre.jar"; Dir = "guava" },
  @{ Name = "gson-2.10.jar";     Url = "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10/gson-2.10.jar"; Dir = "gson" }
)

foreach ($dep in $deps) {
  $jar = Join-Path $Vendor $dep.Name
  if (-not (Test-Path $jar)) {
    Write-Host "download $($dep.Name)"
    & curl.exe -L --fail --retry 3 --connect-timeout 20 --max-time 180 -o $jar $dep.Url
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jar)) {
      throw "failed to download $($dep.Url)"
    }
  }
  $target = Join-Path $Lab $dep.Dir
  if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
  Expand-Classes $jar $target

  # Convenience copies used by the Java test harness classpath.
  Copy-Item $jar (Join-Path $Lab $dep.Name) -Force
}

if (-not $JdkHome) {
  $candidates = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  if ($candidates) { $JdkHome = $candidates[0].FullName }
}
if (-not $JdkHome -or -not (Test-Path $JdkHome)) {
  throw "JDK 17 not found. Pass -JdkHome <path to JDK 17>."
}

$jmods = Join-Path $JdkHome "jmods"
$jdkTarget = Join-Path $Lab "jdk\classes"
New-Item -ItemType Directory -Force -Path $jdkTarget | Out-Null

foreach ($module in @("java.base.jmod", "java.logging.jmod")) {
  $jmod = Join-Path $jmods $module
  if (-not (Test-Path $jmod)) { throw "Missing $jmod" }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($jmod)
  try {
    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName.StartsWith("classes/")) { continue }
      if (-not $entry.FullName.EndsWith(".class")) { continue }
      $relative = $entry.FullName.Substring("classes/".Length)
      $dest = Join-Path $jdkTarget $relative
      $dir = Split-Path $dest -Parent
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
    }
  } finally {
    $zip.Dispose()
  }
  Write-Host "extracted $module"
}

Write-Host "setup complete"
