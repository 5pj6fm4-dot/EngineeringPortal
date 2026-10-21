$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$indexPath = Join-Path $root 'index.html'
$dataPath = Join-Path $root 'Data\Tolerance zone.xlsx'
$port = 8765
$url = "http://127.0.0.1:$port/index.html"

if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    Write-Host 'Error: index.html was not found in the EngineeringPortal folder.' -ForegroundColor Red
    Write-Host "Folder: $root"
    exit 1
}
if (-not (Test-Path -LiteralPath $dataPath -PathType Leaf)) {
    Write-Host 'Warning: Data\Tolerance zone.xlsx was not found.' -ForegroundColor Yellow
    Write-Host 'The portal can open, but the tolerance page will not be able to load that workbook.'
}

# If the local server is already running, reuse it.
$serverReady = $false
try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $serverReady = $true }
} catch { }

if (-not $serverReady) {
    $pythonCommand = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    $pyCommand = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $pythonExe = $pythonCommand.Source
        $pythonArgs = "-m http.server $port --bind 127.0.0.1 --directory `"$root`""
    } elseif ($pyCommand) {
        $pythonExe = $pyCommand.Source
        $pythonArgs = "-3 -m http.server $port --bind 127.0.0.1 --directory `"$root`""
    } else {
        Write-Host 'Error: Python was not found. Install Python 3 or ask IT to install it.' -ForegroundColor Red
        exit 1
    }

    # Use a local working directory; CMD/PowerShell cannot use a UNC path as CMD's current directory.
    Start-Process -FilePath $pythonExe -ArgumentList $pythonArgs -WorkingDirectory $env:TEMP -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 300
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { $serverReady = $true; break }
        } catch { }
    } while ((Get-Date) -lt $deadline)
}

if (-not $serverReady) {
    Write-Host "Error: the local website did not respond at $url" -ForegroundColor Red
    Write-Host 'Check whether port 8765 is blocked or already used by another program.'
    exit 1
}

Write-Host 'Design Tools is ready. Opening the portal...' -ForegroundColor Green
Start-Process -FilePath $url
exit 0
