param(
  [string]$Message = "Update PDF parts/report template"
)

Write-Host "Staging all changes..."
git add -A

Write-Host "Committing: $Message"
git commit -m $Message

if ($LASTEXITCODE -eq 0) {
  Write-Host "Commit created successfully. You can push with: git push"
} else {
  Write-Host "No changes to commit or commit failed. Exit code: $LASTEXITCODE"
}
