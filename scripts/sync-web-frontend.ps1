$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot "gas\index.html"
$configPath = Join-Path $repoRoot "gas\Config.gs"
$targetDir = Join-Path $repoRoot "web-frontend"

if (!(Test-Path $sourcePath)) {
  throw "Source file not found: $sourcePath"
}

if (!(Test-Path $targetDir)) {
  New-Item -ItemType Directory -Path $targetDir | Out-Null
}

$appVersion = "dev"
if (Test-Path $configPath) {
  $configText = Get-Content -Raw -Path $configPath
  $versionMatch = [regex]::Match($configText, "APP_VERSION:\s*'([^']+)'")
  if ($versionMatch.Success) {
    $appVersion = $versionMatch.Groups[1].Value
  }
}

$content = Get-Content -Raw -Path $sourcePath

$styleMatch = [regex]::Match($content, "<style>\s*(?<css>[\s\S]*?)\s*</style>")
if (!$styleMatch.Success) {
  throw "Could not find <style> block in gas/index.html"
}
$css = $styleMatch.Groups["css"].Value.Trim()

$scriptMatches = [regex]::Matches($content, "<script>\s*(?<js>[\s\S]*?)\s*</script>")
if ($scriptMatches.Count -eq 0) {
  throw "Could not find <script> blocks in gas/index.html"
}
$js = $scriptMatches[$scriptMatches.Count - 1].Groups["js"].Value.Trim()
$js = $js -replace "const APP_VERSION = '__APP_VERSION__';", "const APP_VERSION = '$appVersion';"
$js = $js -replace "const url = window\.BBA_API_URL \|\| '';", "const url = window.BBA_API_URL || '/api';"

$bodyMatch = [regex]::Match($content, "<body>\s*(?<body>[\s\S]*?)\s*</body>")
if (!$bodyMatch.Success) {
  throw "Could not find <body> block in gas/index.html"
}
$body = $bodyMatch.Groups["body"].Value.Trim()
$body = [regex]::Replace($body, "<script>\s*[\s\S]*?</script>", "", [System.Text.RegularExpressions.RegexOptions]::Singleline).Trim()

$index = @"
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <meta name="bba-app-version" content="$appVersion" />
  <title>BBA Dublin Bible Quiz</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:wght@700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css?v=$appVersion" />
</head>
<body>
$body

  <script src="./config.js"></script>
  <script src="./app.js?v=$appVersion"></script>
</body>
</html>
"@

Set-Content -Path (Join-Path $targetDir "index.html") -Value $index -NoNewline
Set-Content -Path (Join-Path $targetDir "styles.css") -Value $css -NoNewline
Set-Content -Path (Join-Path $targetDir "app.js") -Value $js -NoNewline

Write-Host "Generated web-frontend for Firebase (version $appVersion)"
Write-Host "  web-frontend/index.html"
Write-Host "  web-frontend/styles.css"
Write-Host "  web-frontend/app.js"
