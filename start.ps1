[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$ApiPort = 8000,

    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repositoryRoot = $PSScriptRoot
$frontendRoot = Join-Path $repositoryRoot "frontend"
$dataRoot = Join-Path $repositoryRoot "data\local"
$databasePath = (Join-Path $dataRoot "knowtier.db").Replace("\", "/")
$uploadPath = Join-Path $dataRoot "uploads"
$modelConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) (
    "knowtier-mock-models-{0}-{1}.json" -f $PID, [guid]::NewGuid().ToString("N")
)
$readyUrl = "http://127.0.0.1:$ApiPort/ready"
$frontendUrl = "http://127.0.0.1:$FrontendPort"
$backendProcess = $null
$locationPushed = $false
$managedEnvironmentVariables = @(
    "UV_PROJECT_ENVIRONMENT",
    "COGNIGRAPH_ENVIRONMENT",
    "COGNIGRAPH_DESKTOP_MODE",
    "COGNIGRAPH_WORKSPACE_SCOPE_REQUIRED",
    "COGNIGRAPH_WORKSPACE_PROVISIONING_TOKEN",
    "COGNIGRAPH_DATABASE_URL",
    "COGNIGRAPH_STORAGE_PATH",
    "COGNIGRAPH_NEO4J_REQUIRED",
    "COGNIGRAPH_USE_MOCK_LLM",
    "COGNIGRAPH_MOCK_LEARNING_INSIGHTS_FIXTURE_ENABLED",
    "COGNIGRAPH_OCR_ENABLED",
    "COGNIGRAPH_MODEL_CONFIG_PATH",
    "COGNIGRAPH_MODEL_CONFIGURATION_TOKEN",
    "COGNIGRAPH_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "SILICONFLOW_API_KEY",
    "AZURE_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "VITE_DEV_API_PROXY_TARGET"
)
$previousEnvironment = @{}
foreach ($name in $managedEnvironmentVariables) {
    $previousEnvironment[$name] = @{
        Present = Test-Path -LiteralPath "Env:$name"
        Value = [Environment]::GetEnvironmentVariable(
            $name,
            [EnvironmentVariableTarget]::Process
        )
    }
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install it and run start.ps1 again."
    }
}

function Test-LocalPortInUse {
    param([Parameter(Mandatory = $true)][int]$Port)

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $attempt = $client.ConnectAsync("127.0.0.1", $Port)
        if (-not $attempt.Wait(250)) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForReady {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 60
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "KnowTier API stopped before it became ready (exit code $($Process.ExitCode))."
        }
        try {
            $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2
            if ($response.ready -eq $true) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 400
        }
    }
    throw "KnowTier API did not become ready within $TimeoutSeconds seconds."
}

Assert-Command "uv"
Assert-Command "npm"

if ($ApiPort -eq $FrontendPort) {
    throw "API and frontend ports must be different."
}
if (Test-LocalPortInUse -Port $ApiPort) {
    throw "Port $ApiPort is already in use. Choose another port with -ApiPort."
}
if (Test-LocalPortInUse -Port $FrontendPort) {
    throw "Port $FrontendPort is already in use. Choose another port with -FrontendPort."
}

New-Item -ItemType Directory -Force -Path $dataRoot, $uploadPath | Out-Null

try {
    # These process-scoped values make local startup deterministic and credential-free.
    $env:UV_PROJECT_ENVIRONMENT = Join-Path $repositoryRoot ".venv"
    $env:COGNIGRAPH_ENVIRONMENT = "development"
    $env:COGNIGRAPH_DESKTOP_MODE = "false"
    $env:COGNIGRAPH_WORKSPACE_SCOPE_REQUIRED = "false"
    $env:COGNIGRAPH_WORKSPACE_PROVISIONING_TOKEN = ""
    $env:COGNIGRAPH_DATABASE_URL = "sqlite+aiosqlite:///$databasePath"
    $env:COGNIGRAPH_STORAGE_PATH = $uploadPath
    $env:COGNIGRAPH_NEO4J_REQUIRED = "false"
    $env:COGNIGRAPH_USE_MOCK_LLM = "true"
    $env:COGNIGRAPH_MOCK_LEARNING_INSIGHTS_FIXTURE_ENABLED = "false"
    $env:COGNIGRAPH_OCR_ENABLED = "false"
    $env:COGNIGRAPH_MODEL_CONFIG_PATH = $modelConfigPath
    $env:COGNIGRAPH_MODEL_CONFIGURATION_TOKEN = ""
    $env:COGNIGRAPH_API_KEY = ""
    $env:OPENAI_API_KEY = ""
    $env:ANTHROPIC_API_KEY = ""
    $env:GEMINI_API_KEY = ""
    $env:OPENROUTER_API_KEY = ""
    $env:SILICONFLOW_API_KEY = ""
    $env:AZURE_API_KEY = ""
    $env:AWS_ACCESS_KEY_ID = ""
    $env:AWS_SECRET_ACCESS_KEY = ""
    $env:AWS_SESSION_TOKEN = ""
    $env:VITE_DEV_API_PROXY_TARGET = "http://127.0.0.1:$ApiPort"

    Push-Location $repositoryRoot
    $locationPushed = $true
    Write-Host "Installing locked backend dependencies..."
    & uv sync --frozen --dev --extra documents
    if ($LASTEXITCODE -ne 0) {
        throw "Backend dependency installation failed with exit code $LASTEXITCODE."
    }

    Write-Host "Installing locked frontend dependencies..."
    & npm --prefix $frontendRoot ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend dependency installation failed with exit code $LASTEXITCODE."
    }

    $cognigraph = Join-Path $env:UV_PROJECT_ENVIRONMENT "Scripts\cognigraph.exe"
    $uvicorn = Join-Path $env:UV_PROJECT_ENVIRONMENT "Scripts\uvicorn.exe"
    if (-not (Test-Path -LiteralPath $cognigraph) -or -not (Test-Path -LiteralPath $uvicorn)) {
        throw "The locked Python environment is incomplete. Run start.ps1 again."
    }

    Write-Host "Initializing the local SQLite database..."
    & $cognigraph init
    if ($LASTEXITCODE -ne 0) {
        throw "Database initialization failed with exit code $LASTEXITCODE."
    }

    Write-Host "Starting KnowTier API on http://127.0.0.1:$ApiPort..."
    $backendOptions = @{
        FilePath = $uvicorn
        ArgumentList = @(
            "cognigraph.main:app", "--host", "127.0.0.1", "--port", "$ApiPort"
        )
        WorkingDirectory = $repositoryRoot
        NoNewWindow = $true
        PassThru = $true
    }
    $backendProcess = Start-Process @backendOptions

    Wait-ForReady -Url $readyUrl -Process $backendProcess
    Write-Host "KnowTier is ready at $frontendUrl (press Ctrl+C to stop)."

    & npm --prefix $frontendRoot run dev -- --host 127.0.0.1 --port $FrontendPort --strictPort
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 130) {
        throw "Frontend stopped with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -ne $backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
        $backendProcess.WaitForExit(5000) | Out-Null
    }
    Remove-Item -LiteralPath $modelConfigPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$modelConfigPath.bak", "$modelConfigPath.tmp" `
        -Force -ErrorAction SilentlyContinue
    foreach ($name in $managedEnvironmentVariables) {
        $previous = $previousEnvironment[$name]
        $value = if ($previous.Present) { $previous.Value } else { $null }
        [Environment]::SetEnvironmentVariable(
            $name,
            $value,
            [EnvironmentVariableTarget]::Process
        )
    }
    if ($locationPushed) {
        Pop-Location
    }
}
