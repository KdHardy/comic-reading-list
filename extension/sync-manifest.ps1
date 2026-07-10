# Copy the Chrome/Edge manifest template into manifest.json (gitignored).
# Run this after git pull whenever extension host permissions or content scripts change.
Copy-Item (Join-Path $PSScriptRoot 'manifest.chrome.json') (Join-Path $PSScriptRoot 'manifest.json') -Force
Write-Host 'Synced extension/manifest.json from manifest.chrome.json'
