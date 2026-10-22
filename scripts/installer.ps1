param(
    [string]$AppVersion,
    [string]$IsccPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
$exePath = Join-Path $repoRoot 'app/bin/Release/net48/HexShift.exe'
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw 'Build app/HexShift.csproj in Release with a locked restore first.'
}
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($exePath)
# SDK informational versions may include a source revision after the version.
$builtVersion = ($info.ProductVersion -split '\+', 2)[0]
if (-not $AppVersion) { $AppVersion = $builtVersion }
if ($AppVersion -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw 'AppVersion must be a stable three-part version, for example 2.1.0.'
}
$versionInfo = [version]($AppVersion + '.0')
foreach ($part in @($versionInfo.Major, $versionInfo.Minor, $versionInfo.Build)) {
    if ($part -gt 65535) { throw 'Version components must fit the Windows version resource (0-65535).' }
}
$fileVersion = '{0}.{1}.{2}.{3}' -f $info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart
if ($AppVersion -ne $builtVersion -or $versionInfo.ToString() -ne $fileVersion) {
    throw "Installer version $AppVersion disagrees with HexShift.exe (product $builtVersion, file $fileVersion)."
}
if (-not $IsccPath) {
    $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($compiler) { $IsccPath = $compiler.Source }
    else {
        foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            foreach ($folder in @('Inno Setup 7', 'Inno Setup 6')) {
                $candidate = Join-Path $base ($folder + '/ISCC.exe')
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { $IsccPath = $candidate; break }
            }
            if ($IsccPath) { break }
        }
    }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
    throw 'Inno Setup ISCC.exe was not found. Pass -IsccPath with its installed location.'
}
$distPath = Join-Path $repoRoot 'dist'
New-Item -ItemType Directory -Force -Path $distPath | Out-Null
& $IsccPath "/DAppVersion=$AppVersion" "/O$distPath" (Join-Path $repoRoot 'installer/HexShift.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE." }
$installerName = "HexShift-$AppVersion-Setup.exe"
$installerPath = Join-Path $distPath $installerName
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw "ISCC did not produce $installerPath." }
$checksumPath = Join-Path $repoRoot 'SHA256SUMS.txt'
$checksums = @()
if (Test-Path -LiteralPath $checksumPath) {
    $checksums = @(Get-Content -LiteralPath $checksumPath | Where-Object { $_ -notmatch ('  ' + [regex]::Escape($installerName) + '$') })
}
$hash = Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
$checksums += $hash.Hash.ToLowerInvariant() + '  ' + $installerName
$checksums | Set-Content -LiteralPath $checksumPath -Encoding utf8
Write-Output "Prepared $installerPath and appended its SHA256SUMS.txt entry."
