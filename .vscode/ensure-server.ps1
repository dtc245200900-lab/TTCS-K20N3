$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$healthUrl = "http://127.0.0.1:3001/health"

function Get-HotelHealth {
    try {
        return Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    }
    catch {
        return $null
    }
}

$health = Get-HotelHealth
if ($health -and $health.status -eq "ok") {
    if ($health.runtime -eq "python") {
        Write-Output "Hotel management app is ready at http://127.0.0.1:3001"
        exit 0
    }
    throw "Port 3001 is serving a backend other than Python. Stop it and press F5 again."
}

$logPrefix = Join-Path $env:TEMP "hotel-manager-server-$PID"
$stdoutLog = "$logPrefix.out.log"
$stderrLog = "$logPrefix.err.log"
$serverProcess = Start-Process `
    -FilePath $env:ComSpec `
    -ArgumentList @("/c", 'set "HOTEL_NO_PAUSE=1" && start-server.cmd') `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

$deadline = [DateTime]::UtcNow.AddSeconds(180)
while ([DateTime]::UtcNow -lt $deadline) {
    $health = Get-HotelHealth
    if ($health -and $health.status -eq "ok") {
        if ($health.runtime -eq "python") {
            Write-Output "Hotel management app is ready at http://127.0.0.1:3001"
            exit 0
        }
        throw "Port 3001 is serving a backend other than Python. Stop it and press F5 again."
    }

    if ($serverProcess.HasExited) {
        break
    }
    $serverProcess.WaitForExit(500) | Out-Null
}

if (Test-Path $stdoutLog) {
    Get-Content $stdoutLog -Tail 30
}
if (Test-Path $stderrLog) {
    Get-Content $stderrLog -Tail 30
}
throw "Python server did not become ready on port 3001."