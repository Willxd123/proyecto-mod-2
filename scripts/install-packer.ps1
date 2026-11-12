param([string]$Version = '1.14.3')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Versión inválida.' }
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolDirectory = Join-Path $repositoryRoot '.tools\packer'
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
$archiveName = "packer_${Version}_windows_amd64.zip"
$archivePath = Join-Path $toolDirectory $archiveName
$checksumsPath = Join-Path $toolDirectory "packer_${Version}_SHA256SUMS"
$baseUrl = "https://releases.hashicorp.com/packer/$Version"
Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
Invoke-WebRequest -Uri "$baseUrl/packer_${Version}_SHA256SUMS" -OutFile $checksumsPath -UseBasicParsing
$checksumLine = @(Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match ('\s+' + [regex]::Escape($archiveName) + '$') })
if ($checksumLine.Count -ne 1) { throw 'No se encontró un checksum único en el archivo oficial.' }
$expectedHash = ($checksumLine[0] -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($expectedHash -ne $actualHash) { throw 'Checksum de Packer no coincide. No se extrae ni ejecuta.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolDirectory -Force
& (Join-Path $toolDirectory 'packer.exe') version
if ($LASTEXITCODE -ne 0) { throw 'Packer no pudo ejecutarse.' }
Write-Output 'Packer portable instalado en .tools/packer. No se modificó el PATH del sistema.'
