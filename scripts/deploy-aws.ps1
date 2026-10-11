param(
  [string]$Profile = 'airday',
  [string]$Region = 'ap-south-1',
  [string]$StackName = 'airday-api',
  [string]$AppName = 'airday-outdoor-planner',
  [string]$BranchName = 'production',
  [string]$AlertEmail = '',
  [string]$NotificationSender = '',
  [string]$RestoredEvidenceTable = '',
  [ValidateSet('R0R2','Full')][string]$ReleaseScope = 'R0R2',
  [switch]$SharedWorkspaces,
  [switch]$ArchiveOpenAq,
  [switch]$ReviewEmail,
  [switch]$Weather,
  [switch]$Fires,
  [switch]$FirmsProductVerified,
  [switch]$PublicEvidence,
  [switch]$PublicRedistributionReviewed,
  [string]$PublicEmbedOrigins = '',
  [ValidateSet('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT')][string]$FirmsProduct = 'VIIRS_NOAA20_NRT'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if ($ReleaseScope -eq 'R0R2' -and ($SharedWorkspaces -or $ReviewEmail -or $Weather -or $Fires -or $PublicEvidence -or $PublicEmbedOrigins -or $NotificationSender)) {
  throw 'The R0-R2 release keeps staff accounts, email and other R3 integrations disabled. Their later release requires explicitly selecting Full scope.'
}
if ($ReviewEmail -and -not $SharedWorkspaces) { throw 'Scheduled email requires explicitly enabled staff workspaces.' }
if ($StackName -notmatch '^[a-z][a-z0-9-]{1,40}$' -or $BranchName -notmatch '^[a-z][a-z0-9-]{1,30}$') { throw 'Use short lowercase stack and branch names.' }
$aws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$sam = 'C:\Program Files\Amazon\AWSSAMCLI\bin\sam.cmd'
if (-not (Test-Path -LiteralPath $aws)) { $aws = (Get-Command aws -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $sam)) { $sam = (Get-Command sam -ErrorAction Stop).Source }
function Invoke-AwsJson {
  param([string[]]$Arguments)
  $result = & $aws @Arguments --profile $Profile --region $Region --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw "AWS CLI failed: $($Arguments[0]) $($Arguments[1]). Check the console error." }
  return (($result -join "`n") | ConvertFrom-Json)
}
function Read-LocalKey {
  param([string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  if (Test-Path -LiteralPath '.env') {
    foreach ($line in Get-Content -LiteralPath '.env') {
      if ($line -match "^\s*$Name\s*=\s*(.*)$") { return $Matches[1].Trim().Trim('"', "'") }
    }
  }
  return ''
}
# Complete all local gates before provisioning. Provider secrets never become stack parameters.
if ($ReviewEmail -and (-not $NotificationSender -or (Read-LocalKey 'ALERT_SIGNING_KEY').Length -lt 32)) { throw 'Scheduled email requires a verified SES sender and a signing key of at least 32 characters in the local secret configuration.' }
if ($Fires -and (-not $FirmsProductVerified -or -not (Read-LocalKey 'FIRMS_MAP_KEY'))) { throw 'Satellite fires require a FIRMS key and explicit verification of the selected NOAA product.' }
if ($PublicEvidence -and -not $PublicRedistributionReviewed) { throw 'Public evidence requires explicit source redistribution review.' }
foreach ($embedOrigin in @($PublicEmbedOrigins -split ',' | Where-Object { $_ })) {
  $embedUri = $null
  if (-not [Uri]::TryCreate($embedOrigin, [UriKind]::Absolute, [ref]$embedUri) -or $embedUri.Scheme -ne 'https' -or $embedUri.UserInfo -or $embedUri.GetLeftPart([UriPartial]::Authority) -cne $embedOrigin) { throw 'Use exact HTTPS origins separated by commas for widget embedding.' }
}
if ($ReleaseScope -eq 'R0R2') {
  $releaseTests = @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter '*.test.mjs' -File |
    Where-Object { $_.Name -notmatch '^r[345](?:[-.]|$)' -and $_.Name -notin @('workspace.test.mjs','pilot-integration.test.mjs') } |
    Sort-Object Name | ForEach-Object { $_.FullName })
  if (-not $releaseTests.Count) { throw 'No R0-R2 release tests were found.' }
  Write-Host "Running $($releaseTests.Count) scoped R0-R2 test files."
  $releaseTemp = Join-Path $root '.airday-local\test-temp'
  $null = New-Item -ItemType Directory -Path $releaseTemp -Force
  $previousTmp = $env:TMP
  $previousTemp = $env:TEMP
  try {
    $env:TMP = $releaseTemp
    $env:TEMP = $releaseTemp
    & node --test @releaseTests
    if ($LASTEXITCODE -ne 0) { throw 'Local release gate failed: scoped R0-R2 tests' }
  } finally { $env:TMP = $previousTmp; $env:TEMP = $previousTemp }
} else {
  & pnpm run test
  if ($LASTEXITCODE -ne 0) { throw 'Local release gate failed: full tests' }
}
foreach ($script in @('lint', 'check:config', 'check:security', 'build', 'build:api', 'check:infra')) {
  & pnpm run $script
  if ($LASTEXITCODE -ne 0) { throw "Local release gate failed: $script" }
}
$identity = Invoke-AwsJson -Arguments @('sts', 'get-caller-identity')
Write-Host "Deploying to AWS account $($identity.Account), $Region."
$apps = Invoke-AwsJson -Arguments @('amplify', 'list-apps')
$app = @($apps.apps | Where-Object name -eq $AppName | Select-Object -First 1)[0]
if (-not $app) { $app = (Invoke-AwsJson -Arguments @('amplify', 'create-app', '--name', $AppName, '--platform', 'WEB')).app }
$appId = [string]$app.appId
$siteUrl = "https://$BranchName.$($app.defaultDomain)"
if (-not $appId -or -not $app.defaultDomain) { throw 'Amplify app identity is missing.' }
$branches = Invoke-AwsJson -Arguments @('amplify', 'list-branches', '--app-id', $appId)
if (-not @($branches.branches | Where-Object branchName -eq $BranchName).Count) {
  $null = Invoke-AwsJson -Arguments @('amplify', 'create-branch', '--app-id', $appId, '--branch-name', $BranchName, '--stage', 'PRODUCTION')
}
$env:SAM_CLI_TELEMETRY = '0'
$archiveValue = if ($ArchiveOpenAq) { 'true' } else { 'false' }
$sharedValue = if ($SharedWorkspaces) { 'true' } else { 'false' }
$parameters = @("SiteOrigin=$siteUrl", "ArchiveOpenAq=$archiveValue", "SharedWorkspacesEnabled=$sharedValue", "ReleaseScope=$ReleaseScope")
foreach ($setting in @(@('ReviewEmailEnabled',$ReviewEmail),@('WeatherEnabled',$Weather),@('FiresEnabled',$Fires),@('FirmsProductVerified',$FirmsProductVerified),@('PublicEvidenceEnabled',$PublicEvidence),@('PublicRedistributionReviewed',$PublicRedistributionReviewed))) {
  $settingValue = if ($setting[1]) { 'true' } else { 'false' }
  $parameters += "$($setting[0])=$settingValue"
}
$parameters += "FirmsProduct=$FirmsProduct"
if ($PublicEmbedOrigins) { $parameters += "PublicEmbedOrigins=$PublicEmbedOrigins" }
if ($AlertEmail) { $parameters += "AlertEmail=$AlertEmail" }
if ($NotificationSender) { $parameters += "NotificationSender=$NotificationSender" }
if ($RestoredEvidenceTable) { $parameters += "RestoredEvidenceTable=$RestoredEvidenceTable" }
& $sam deploy --template-file template.yaml --stack-name $StackName --resolve-s3 --capabilities CAPABILITY_IAM --region $Region --profile $Profile --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides @parameters
if ($LASTEXITCODE -ne 0) { throw 'SAM deployment failed. Correct the error before continuing.' }
$stack = Invoke-AwsJson -Arguments @('cloudformation', 'describe-stacks', '--stack-name', $StackName)
$outputs = @{}
foreach ($item in $stack.Stacks[0].Outputs) { $outputs[$item.OutputKey] = $item.OutputValue }
$apiUrl = [string]$outputs.AirdayApiUrl
if (-not $apiUrl) { throw 'API output is missing.' }
$keyNames = @('OPENAQ_API_KEY', 'DATAGOV_API_KEY', 'OPEN_METEO_API_KEY')
if ($Fires) { $keyNames += 'FIRMS_MAP_KEY' }
if ($ReviewEmail) { $keyNames += 'ALERT_SIGNING_KEY' }
$keys = @{}
foreach ($key in $keyNames) { $value = Read-LocalKey $key; if ($value) { $keys[$key] = $value } }
if ($keys.Count) {
  $existingSecret = Invoke-AwsJson -Arguments @('secretsmanager', 'get-secret-value', '--secret-id', $outputs.ProviderSecretArn)
  $mergedKeys = @{}
  if ($existingSecret.SecretString) {
    $savedKeys = $existingSecret.SecretString | ConvertFrom-Json
    foreach ($name in @('OPENAQ_API_KEY', 'DATAGOV_API_KEY', 'OPEN_METEO_API_KEY', 'FIRMS_MAP_KEY', 'ALERT_SIGNING_KEY')) {
      $property = $savedKeys.PSObject.Properties[$name]
      if ($property -and $property.Value) { $mergedKeys[$name] = [string]$property.Value }
    }
  }
  foreach ($name in $keys.Keys) { $mergedKeys[$name] = $keys[$name] }
  $secretFile = Join-Path ([System.IO.Path]::GetTempPath()) ("airday-$([Guid]::NewGuid()).json")
  try {
    [System.IO.File]::WriteAllText($secretFile, ($mergedKeys | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
    $null = Invoke-AwsJson -Arguments @('secretsmanager', 'put-secret-value', '--secret-id', $outputs.ProviderSecretArn, '--secret-string', "file://$secretFile")
  } finally { if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force } }
}
$apiOrigin = ([Uri]$apiUrl).GetLeftPart([System.UriPartial]::Authority)
$authOrigin = if ($outputs.AuthDomain) { "https://$($outputs.AuthDomain)" } else { '' }
$headers = @"
customHeaders:
  - pattern: '**/*'
    headers:
      - key: Strict-Transport-Security
        value: 'max-age=31536000; includeSubDomains'
      - key: X-Content-Type-Options
        value: nosniff
      - key: Referrer-Policy
        value: strict-origin-when-cross-origin
      - key: X-Frame-Options
        value: DENY
      - key: Permissions-Policy
        value: 'geolocation=(self), camera=(), microphone=()'
      - key: Content-Security-Policy
        value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://tile.openstreetmap.org; worker-src 'self'; manifest-src 'self'; connect-src 'self' $apiOrigin $authOrigin; form-action 'self' $authOrigin"
"@
# Manual Amplify deployments configure headers on the app, not just inside the ZIP.
$headersFile = Join-Path ([System.IO.Path]::GetTempPath()) ("airday-headers-$([Guid]::NewGuid()).yaml")
try {
  [System.IO.File]::WriteAllText($headersFile, $headers, [System.Text.UTF8Encoding]::new($false))
  $null = Invoke-AwsJson -Arguments @('amplify', 'update-app', '--app-id', $appId, '--custom-headers', "file://$headersFile")
} finally { if (Test-Path -LiteralPath $headersFile) { Remove-Item -LiteralPath $headersFile -Force } }
$previousBase = $env:VITE_API_BASE_URL
try {
  $env:VITE_API_BASE_URL = $apiUrl
  & pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { $env:VITE_API_BASE_URL = $previousBase }
$zip = Join-Path $root 'airday-dist.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$distRoot = (Resolve-Path -LiteralPath (Join-Path $root 'dist')).Path
$zipStream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    foreach ($file in Get-ChildItem -LiteralPath $distRoot -Recurse -File) {
      $entryPath = $file.FullName.Substring($distRoot.Length + 1).Replace('\', '/')
      $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryPath, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archive.Dispose() }
} finally { $zipStream.Dispose() }
$deployment = Invoke-AwsJson -Arguments @('amplify', 'create-deployment', '--app-id', $appId, '--branch-name', $BranchName)
if (-not $deployment.zipUploadUrl -or -not $deployment.jobId) { throw 'Amplify upload information is missing.' }
$curl = (Get-Command curl.exe -ErrorAction Stop).Source
& $curl --fail --silent --show-error --upload-file $zip --header 'Content-Type: application/zip' $deployment.zipUploadUrl
if ($LASTEXITCODE -ne 0) { throw 'Amplify ZIP upload failed.' }
$null = Invoke-AwsJson -Arguments @('amplify', 'start-deployment', '--app-id', $appId, '--branch-name', $BranchName, '--job-id', [string]$deployment.jobId)
$state = @{ profile = $Profile; region = $Region; stack = $StackName; appId = $appId; branch = $BranchName; jobId = $deployment.jobId; siteUrl = $siteUrl; releaseScope = $ReleaseScope; outputs = $outputs }
$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '.airday-deploy.json' -Encoding utf8
Write-Host "Deployment started: $siteUrl"
$complete = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $job = Invoke-AwsJson -Arguments @('amplify', 'get-job', '--app-id', $appId, '--branch-name', $BranchName, '--job-id', [string]$deployment.jobId)
  $status = [string]$job.job.summary.status
  if ($status -eq 'SUCCEED') { $complete = $true; break }
  if ($status -in @('FAILED', 'CANCELLED')) { throw "Amplify failed: $status" }
  Start-Sleep -Seconds 3
}
if (-not $complete) { throw 'Deployment is still running; check the saved job ID with amplify get-job.' }
$health = Invoke-RestMethod -Uri "$apiUrl/api/health" -TimeoutSec 30
if (-not $health.ok -or $health.storage -ne 'dynamodb') { throw 'Deployed API health check failed.' }
$page = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 30
if ($page.StatusCode -ne 200 -or -not $page.Headers['Content-Security-Policy']) { throw 'Hosting or security header verification failed.' }
$dashboard = Invoke-RestMethod -Uri "$apiUrl/api/dashboard?lat=28.6139&lon=77.209&city=New%20Delhi&state=Delhi" -TimeoutSec 30
for ($attempt = 0; $attempt -lt 18 -and $dashboard.pending; $attempt++) {
  Start-Sleep -Seconds 5
  $dashboard = Invoke-RestMethod -Uri "$apiUrl/api/dashboard?lat=28.6139&lon=77.209&city=New%20Delhi&state=Delhi" -TimeoutSec 30
}
if ($dashboard.schemaVersion -ne 2) { throw 'Dashboard contract verification failed.' }
$config = Invoke-RestMethod -Uri "$apiUrl/api/config" -TimeoutSec 30
if ($config.schemaVersion -ne 2 -or -not $config.capabilities) { throw 'Deployed capability contract verification failed.' }
if ($config.releaseScope -ne $ReleaseScope) { throw 'The deployed API release scope differs from the selected deployment scope.' }
$deferredCapabilities = @($config.capabilities.r4.PSObject.Properties | Where-Object { $_.Value -eq $true }) + @($config.capabilities.r5.PSObject.Properties | Where-Object { $_.Value -eq $true })
if ($ReleaseScope -eq 'R0R2' -and ($config.userPoolId -or $config.clientId -or $config.authDomain -or $config.notificationConfigured -or $config.capabilities.sharedWorkspaces -or $config.capabilities.localGroups -or $config.capabilities.reviewEmail -or $config.capabilities.weather -or $config.capabilities.fires -or $config.capabilities.publicEvidence -or $deferredCapabilities.Count)) {
  throw 'The deployed API advertises an integration outside the selected R0-R2 release scope.'
}
Write-Host "Site: $siteUrl"
Write-Host "API: $apiUrl"
Write-Host "Coverage: $($dashboard.coverage.state). Check station freshness and source identity in the dashboard."
$microgramsPerCubicMetre = ([char]0x00B5).ToString() + 'g/m' + ([char]0x00B3).ToString()
$freshReadings = @($dashboard.monitors | Where-Object {
  $measurementTime = [DateTimeOffset]::MinValue
  $_.unit -eq $microgramsPerCubicMetre -and -not $_.stale -and [DateTimeOffset]::TryParse([string]$_.observedAt, [ref]$measurementTime) -and
    $measurementTime -le [DateTimeOffset]::UtcNow.AddMinutes(5) -and $measurementTime -ge [DateTimeOffset]::UtcNow.AddHours(-3)
})
Write-Host "Fresh returned observations: $($freshReadings.Count)."
if (-not $dashboard.forecast -or -not $freshReadings.Count) { Write-Warning 'A forecast or fresh observation is unavailable. Stale readings are not fresh coverage; preserve the app limitation when recording the demo.' }
