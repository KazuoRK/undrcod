# setup-whisper.ps1
# Baixa e instala whisper.cpp + modelo ggml-base.bin em resources/whisper/
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup-whisper.ps1

$ErrorActionPreference = 'Stop'

# ---- Constantes / URLs de fallback ----
$FallbackVersion       = 'v1.7.1'
$FallbackBinaryUrl     = "https://github.com/ggerganov/whisper.cpp/releases/download/$FallbackVersion/whisper-bin-x64.zip"
$LatestApiUrl          = 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest'
$ModelUrl              = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true'
$ModelMinValidBytes    = 100MB

# ---- Helpers de output ----
function Write-Step    { param([string]$msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok      { param([string]$msg) Write-Host "    [OK] $msg"   -ForegroundColor Green }
function Write-Skip    { param([string]$msg) Write-Host "    [SKIP] $msg" -ForegroundColor Yellow }
function Write-Warn2   { param([string]$msg) Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Err     { param([string]$msg) Write-Host "    [ERROR] $msg" -ForegroundColor Red }

function Fail-Exit {
    param([string]$msg, [string]$manualUrl)
    Write-Err $msg
    if ($manualUrl) {
        Write-Host ""
        Write-Host "Download manual:" -ForegroundColor Yellow
        Write-Host "  $manualUrl" -ForegroundColor Yellow
    }
    exit 1
}

# ---- Resolver paths ----
$TargetDir = Join-Path $PSScriptRoot '..\resources\whisper'
$TargetDir = [System.IO.Path]::GetFullPath($TargetDir)
$ExePath   = Join-Path $TargetDir 'whisper-cli.exe'
$ModelPath = Join-Path $TargetDir 'ggml-base.bin'
$TempRoot  = Join-Path $env:TEMP ("whisper-setup-" + [guid]::NewGuid().ToString('N').Substring(0,8))

Write-Step "Preparando diretorio de destino"
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Write-Ok "Criado $TargetDir"
} else {
    Write-Ok "Existe $TargetDir"
}

# ---- Etapa 1: binario whisper.cpp ----
Write-Step "Instalando binario whisper.cpp"

$shouldDownloadBinary = $true
if (Test-Path $ExePath) {
    Write-Warn2 "Ja existe whisper-cli.exe em $ExePath"
    $resp = Read-Host "Sobrescrever? [s/N]"
    if ($resp -notmatch '^[sSyY]') {
        Write-Skip "Mantendo whisper-cli.exe existente"
        $shouldDownloadBinary = $false
    }
}

if ($shouldDownloadBinary) {
    # Tentar resolver URL mais recente
    $binaryUrl = $null
    try {
        Write-Host "    Consultando release mais recente..." -ForegroundColor DarkGray
        $rel = Invoke-RestMethod -Uri $LatestApiUrl -UseBasicParsing -Headers @{ 'User-Agent' = 'akai-code-setup' } -TimeoutSec 15
        $asset = $rel.assets | Where-Object { $_.name -match '^whisper-bin-x64.*\.zip$' } | Select-Object -First 1
        if ($asset) {
            $binaryUrl = $asset.browser_download_url
            Write-Ok "Release: $($rel.tag_name) - $($asset.name)"
        }
    } catch {
        Write-Warn2 "Nao consegui consultar latest release ($($_.Exception.Message))"
    }

    if (-not $binaryUrl) {
        Write-Warn2 "Usando fallback $FallbackVersion"
        $binaryUrl = $FallbackBinaryUrl
    }

    # Preparar temp
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    $zipPath     = Join-Path $TempRoot 'whisper-bin.zip'
    $extractPath = Join-Path $TempRoot 'extracted'

    try {
        Write-Host "    Baixando $binaryUrl" -ForegroundColor DarkGray
        $oldPref = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $binaryUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 300
        } finally {
            $ProgressPreference = $oldPref
        }
        $zipSize = (Get-Item $zipPath).Length
        Write-Ok ("Zip baixado ({0:N1} MB)" -f ($zipSize / 1MB))

        Write-Host "    Extraindo..." -ForegroundColor DarkGray
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        Write-Ok "Extraido em $extractPath"

        # Encontrar exe (whisper-cli.exe novo, main.exe antigo)
        $exeCandidate = Get-ChildItem -Path $extractPath -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $exeCandidate) {
            $exeCandidate = Get-ChildItem -Path $extractPath -Recurse -Filter 'main.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if (-not $exeCandidate) {
            Fail-Exit "Nao achei whisper-cli.exe nem main.exe no zip extraido" $binaryUrl
        }

        Copy-Item -Path $exeCandidate.FullName -Destination $ExePath -Force
        Write-Ok "whisper-cli.exe instalado ($([math]::Round((Get-Item $ExePath).Length / 1MB, 1)) MB)"

        # Copiar DLLs necessarias do mesmo diretorio do exe
        $exeDir = Split-Path $exeCandidate.FullName -Parent
        $dllPatterns = @('ggml*.dll', 'whisper*.dll', 'SDL2.dll')
        $dllCount = 0
        foreach ($pat in $dllPatterns) {
            $dlls = Get-ChildItem -Path $exeDir -Filter $pat -ErrorAction SilentlyContinue
            foreach ($dll in $dlls) {
                Copy-Item -Path $dll.FullName -Destination (Join-Path $TargetDir $dll.Name) -Force
                $dllCount++
            }
        }
        Write-Ok "Copiadas $dllCount DLL(s) auxiliares"
    } catch {
        Fail-Exit "Falha no download/extracao do binario: $($_.Exception.Message)" $binaryUrl
    } finally {
        # Limpeza
        if (Test-Path $TempRoot) {
            Remove-Item -Path $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
            Write-Ok "Limpeza de temp concluida"
        }
    }
}

# ---- Etapa 2: modelo ggml-base.bin ----
Write-Step "Baixando modelo ggml-base.bin (~148 MB)"

$shouldDownloadModel = $true
if (Test-Path $ModelPath) {
    $existingSize = (Get-Item $ModelPath).Length
    if ($existingSize -gt $ModelMinValidBytes) {
        Write-Skip ("Modelo ja existe ({0:N1} MB) - assumindo valido" -f ($existingSize / 1MB))
        $shouldDownloadModel = $false
    } else {
        Write-Warn2 ("Modelo existente parece truncado ({0:N0} bytes) - rebaixando" -f $existingSize)
    }
}

if ($shouldDownloadModel) {
    try {
        Write-Host "    De: $ModelUrl" -ForegroundColor DarkGray

        # Download com progresso simples (5% steps) via HttpWebRequest
        $req = [System.Net.HttpWebRequest]::Create($ModelUrl)
        $req.UserAgent = 'akai-code-setup'
        $req.Timeout = 60000
        $req.ReadWriteTimeout = 120000
        $resp = $req.GetResponse()
        $totalBytes = $resp.ContentLength
        $stream = $resp.GetResponseStream()

        $tmpModel = "$ModelPath.partial"
        if (Test-Path $tmpModel) { Remove-Item $tmpModel -Force }
        $fileStream = [System.IO.File]::Create($tmpModel)

        $buffer = New-Object byte[] 65536
        $bytesRead = 0
        $totalRead = 0L
        $lastPct = -5
        try {
            while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $fileStream.Write($buffer, 0, $bytesRead)
                $totalRead += $bytesRead
                if ($totalBytes -gt 0) {
                    $pct = [int](($totalRead * 100) / $totalBytes)
                    if ($pct -ge ($lastPct + 5)) {
                        Write-Host ("    {0,3}% ({1:N1} / {2:N1} MB)" -f $pct, ($totalRead/1MB), ($totalBytes/1MB)) -ForegroundColor DarkGray
                        $lastPct = $pct
                    }
                }
            }
        } finally {
            $fileStream.Close()
            $stream.Close()
            $resp.Close()
        }

        Move-Item -Path $tmpModel -Destination $ModelPath -Force
        Write-Ok ("Modelo baixado: {0:N1} MB" -f ((Get-Item $ModelPath).Length / 1MB))
    } catch {
        Fail-Exit "Falha no download do modelo: $($_.Exception.Message)" $ModelUrl
    }
}

# ---- Etapa 3: verificacao final ----
Write-Step "Verificando instalacao"

$problems = @()

if (-not (Test-Path $ExePath)) {
    $problems += "whisper-cli.exe NAO encontrado em $ExePath"
} else {
    $sz = (Get-Item $ExePath).Length
    if ($sz -le 0) { $problems += "whisper-cli.exe tem tamanho zero" }
    else { Write-Ok ("whisper-cli.exe OK ({0:N1} MB)" -f ($sz/1MB)) }
}

if (-not (Test-Path $ModelPath)) {
    $problems += "ggml-base.bin NAO encontrado em $ModelPath"
} else {
    $sz = (Get-Item $ModelPath).Length
    if ($sz -le 0) { $problems += "ggml-base.bin tem tamanho zero" }
    elseif ($sz -lt $ModelMinValidBytes) { $problems += "ggml-base.bin parece truncado ($sz bytes)" }
    else { Write-Ok ("ggml-base.bin OK ({0:N1} MB)" -f ($sz/1MB)) }
}

# Lista DLLs presentes
$dlls = Get-ChildItem -Path $TargetDir -Filter '*.dll' -ErrorAction SilentlyContinue
if ($dlls) {
    Write-Ok ("DLLs auxiliares: {0}" -f (($dlls | ForEach-Object { $_.Name }) -join ', '))
}

if ($problems.Count -gt 0) {
    Write-Host ""
    Write-Host "Problemas detectados:" -ForegroundColor Red
    $problems | ForEach-Object { Write-Err $_ }
    Fail-Exit "Verificacao falhou" $null
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Whisper instalado em $TargetDir." -ForegroundColor Green
Write-Host " Reinicie o UNDRCode e use o botao de microfone no composer." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

exit 0
