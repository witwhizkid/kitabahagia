# Backup database Kita Bahagia (schema public: kegiatan, pendaftar, pembayaran, kisah, admin).
# Hasil: backups\kitabahagia-YYYYMMDD-HHmm.dump (tidak ikut git). Butuh pg_dump dari
# PostgreSQL 17 "Command Line Tools". Cara pakai dan restore: supabase/README.md, "Database backup".
#
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
#
# Connection string (Session pooler) berisi password database: jangan disimpan di file repo.
param([string]$DbUrl = $env:KB_DB_URL)

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  Write-Error "pg_dump tidak ditemukan. Install PostgreSQL 17 (pilih Command Line Tools), lalu buka ulang terminal."
  exit 1
}
if (-not $DbUrl) {
  $DbUrl = Read-Host "Tempel connection string Session pooler dari Supabase (postgresql://...)"
}
if ($DbUrl -notmatch '^postgres(ql)?://') {
  Write-Error "Connection string harus diawali postgresql://"
  exit 1
}

$dir = Join-Path $PSScriptRoot "..\backups"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ("kitabahagia-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".dump")

pg_dump --dbname="$DbUrl" --schema=public --format=custom --no-owner --no-privileges --file="$file"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Backup gagal (lihat pesan di atas). Cek password dan pastikan memakai Session pooler."
  if (Test-Path $file) { Remove-Item $file }
  exit 1
}

$size = [math]::Round((Get-Item $file).Length / 1KB)
Write-Host "Backup selesai: $file ($size KB). Simpan salinannya di tempat lain juga (Google Drive/flashdisk)."
