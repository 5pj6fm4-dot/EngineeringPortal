$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find Python (either python.exe or the Windows py launcher).
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
$pyLauncher = $false
if (-not $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
    $pyLauncher = $true
}
if (-not $pythonCmd) {
    Write-Host "找不到 Python。" -ForegroundColor Red
    Write-Host "請先安裝 Python，並勾選 Add Python to PATH；或告訴我你的電腦是否有安裝 Python。"
    exit 1
}

# Pick a currently unused local port.
$port = $null
foreach ($candidate in 8765..8795) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        $listener.Start()
        $port = $candidate
        break
    } catch {
        # Try the next port.
    } finally {
        if ($listener) { $listener.Stop() }
    }
}
if (-not $port) {
    Write-Host "找不到可用的本機連接埠（8765–8795）。" -ForegroundColor Red
    exit 1
}

if ($pyLauncher) {
    $arguments = @("-3", "-m", "http.server", "$port", "--bind", "127.0.0.1")
} else {
    $arguments = @("-m", "http.server", "$port", "--bind", "127.0.0.1")
}

try {
    $server = Start-Process -FilePath $pythonCmd.Source `
        -ArgumentList $arguments `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -PassThru
} catch {
    Write-Host "無法啟動本機網站伺服器：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$url = "http://127.0.0.1:$port/index.html"
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        if ($server.HasExited) { break }
    }
}

if (-not $ready) {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "本機網站伺服器啟動失敗。請確認 Python 可正常執行。" -ForegroundColor Red
    exit 1
}

Write-Host "Design Tools 已啟動：" -ForegroundColor Green
Write-Host $url
Write-Host "Excel 自動載入路徑應為：Data\Tolerance zone.xlsx"
Start-Process $url
