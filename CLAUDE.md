# Kita Bahagia — catatan kerja untuk Claude

Situs statis multi-halaman (HTML/CSS/JS vanilla) di Vercel, backend Supabase
(Postgres + Edge Functions), pembayaran Midtrans (QRIS). Detail backend:
`supabase/README.md`.

## Cara kerja yang disepakati

- Pakai prinsip `lean-build`: pakai ulang yang sudah ada, scope ketat, berhenti
  begitu yang diminta selesai. Jalankan `code-review` pada diff sebelum commit.
- Ubah aturan CSS yang sudah ada **di tempatnya**, jangan menimpanya dengan
  aturan baru di bawah, supaya `css/style.css` tidak menumpuk. Jangan lupa cek
  breakpoint tablet dan HP juga.
- Verifikasi di browser lokal (Playwright + Chromium) dengan data tiruan:
  fungsi dulu, lalu screenshot desktop/tablet/HP, lalu tes regresi (jadwal,
  pembayaran QRIS, validasi nomor HP, layar lewat batas bayar). Skrip tes
  browser tidak ada di repo; skrip lama butuh env `S` dan working directory.
  Di tes klik, scroll dulu elemennya ke dalam viewport.
- Laporkan dengan jujur kalau sesuatu baru dicek di lokal, belum di situs live.
- Bahasa ke user: Indonesia santai (gua/lu boleh).

## Deploy (user pakai PowerShell di Windows)

Kalau perubahan cuma tampilan (tanpa migrasi/function), kasih perintah ini
satu per satu, masing-masing di blok kode terpisah:

```
git checkout main
git fetch origin
git merge origin/<branch-claude>
git push origin main
```

Setelah Vercel selesai deploy: buka situs, tekan Ctrl+Shift+R. Kalau ada
migrasi atau Edge Function, tulis juga langkah Supabase-nya secara eksplisit.

Edge Function tidak ikut ter-deploy lewat Vercel. Deploy dari `main` dan selalu
sebut project-nya (folder lokal user belum tentu ter-link):

```
npx supabase functions deploy <nama-function> --project-ref cmrdapfuqtjlmpepfwfq
```

Kalau diminta login: `npx supabase login` dulu. Cek hasilnya di Supabase →
Edge Functions (waktu deploy terakhir) sebelum menyimpulkan kodenya salah.

## Keputusan desain yang sudah dibuat

Daftar kegiatan (`jadwal.html` + beranda, dirender oleh `js/script.js`):
- Filter berupa tab, kolom cari bergaris bawah.
- Dikelompokkan per bulan ("Oktober 2026 · 3 kegiatan"); jumlah ikut
  filter/pencarian, bulan kosong disembunyikan.
- Status default "Pendaftaran dibuka" disembunyikan; hanya status penting
  (mis. "Kuota penuh") yang tampil.
- Seluruh baris bisa diklik (stretched link di judul) ke halaman pendaftaran;
  tombol Daftar tetap di atas lapisan link.
- Kalau hanya ada 1 kegiatan yang segera tutup, tampil sebagai fitur lebar
  dengan poster lebih besar; di HP poster pindah ke atas dengan lebar dibatasi.
- Label tutup: "Tutup 27 September · 3 hari lagi" / "Besok" / "Hari ini".
- Bingkai poster 4:5 dengan `object-fit: contain` (poster tidak terpotong).
- Judul kegiatan bisa ~80 karakter: ukuran judul `clamp(20px, 2vw, 26px)`.
- HP: Jadwal = daftar ke bawah (tanggal "10 OKT · Sabtu" + kategori di atas,
  judul selebar penuh, lalu tempat/waktu/harga/Daftar di samping poster 104px);
  beranda = kartu geser dengan poster besar, judul dipotong maks. 4 baris. Keduanya pakai `eventRowMarkup`
  yang sama, beda di CSS `@media (max-width:640px)`. Efek hover baris hanya di
  `@media (hover:hover)` supaya tidak "nyangkut" setelah tap.

Halaman pendaftaran (`pendaftaran.html`):
- Thumbnail poster ("Lihat poster") membuka `<dialog>` native; tutup via ×,
  Esc, atau klik di luar.
- Langkah 1–2 mengikuti gaya halaman pembayaran; watermark header memakai
  logo Kita Bahagia.
- Event gratis + Seleksi punya tab/bagian "Persyaratan jika lolos" di detail
  kegiatan. Isinya masih placeholder statis di `pendaftaran.html` (sama untuk
  semua event seleksi) sampai admin bisa mengaturnya per kegiatan.

Lainnya:
- Foto disajikan sebagai WebP yang sudah diperkecil (originalnya 2–7 MB).
- Upload foto di admin dikompres di browser sebelum dikirim (`compressImage`
  di `js/admin.js`): kegiatan maks. 1200×1500, kisah maks. 1600×1600, WebP
  (JPEG di browser tanpa WebP). File sumber boleh sampai 25 MB.
- Hero beranda di HP/tablet setinggi layar (`max(560px,100svh)`). HP (≤767px)
  memakai crop potret `img/hero-*-mobile.webp` lewat `<picture>`. Slide 1 =
  foto relawan + adik-adik (`hero-volunteer-*`, dari `IMG_20260815_011030.jpg`,
  dicerahkan sedikit saat ekspor); slide 2 dari `DSCF6787.webp` (diberi
  grade hangat saat ekspor); crop slide 3 dari `DSC01930.JPG.jpeg`.
- Foto yang tampil dengan `object-fit: cover` di bingkai yang lebih "kotak"
  dari fotonya butuh file lebih lebar dari bingkainya: atur `sizes` ke lebar
  foto yang benar-benar dirender (contoh foto Jejak di beranda:
  `relawan-anak-960/1440/1920`, `sizes` 890px). Selalu ekspor dari file asli.
  Foto kelas lama (`hero-relawan*.webp`) masih dipakai di halaman lain.
- Midtrans sandbox/production dipilih lewat `MIDTRANS_ENV`; payload QRIS mentah
  disimpan dan QR digambar sendiri (`js/vendor/qrcode-generator.min.js`).
- Jendela pembayaran/seat-hold diatur per kegiatan dari admin
  (`payment_window_minutes`); lihat "Seat-hold rules" di `supabase/README.md`.
  Copy menjelaskan slot ditahan sementara sampai deadline yang sama; countdown
  tetap memakai `payment_deadline` existing. Jangan hardcode durasi. CTA
  "Ikuti Kita Bahagia di Instagram" muncul setelah pendaftaran gratis biasa
  terkonfirmasi atau pembayaran berbayar terkonfirmasi. Pendaftar gratis mode
  Seleksi diminta follow dan unggah bukti sebelum submit, jadi CTA follow tidak
  muncul lagi setelah sukses.
- Kegiatan lebih dari 1 hari: admin mengisi "Tanggal selesai" + "Jam selesai"
  (digabung jadi `end_at`, tanpa perubahan skema). Publik menampilkan
  "Sabtu · 2 hari" dan "24 Okt, 09.00 – 25 Okt, 17.00 WIB".
- Mode Seleksi (kegiatan gratis): pendaftar jadi `applied` ("Menunggu seleksi"),
  tidak memakan kursi; admin mengatur batas pendaftar, jam buka, tanggal
  pengumuman, pertanyaan esai + minimal karakter, dan teks komitmen per
  kegiatan. Publik **tidak** melihat angka apa pun untuk kegiatan seleksi (cuma
  "Seleksi" / "Pendaftaran ditutup"). Detail: "Selection mode" di
  `supabase/README.md`. Tahap 2 admin: filter/status Menunggu seleksi, Diterima,
  Cadangan, dan Tidak lolos; jawaban esai satu baris dengan dialog detail;
  keputusan satuan/bulk dengan batas kapasitas dari server; ringkasan hasil dan
  riwayat keikutsertaan; ekspor CSV dari baris yang sedang tampil; serta draft
  WhatsApp dengan template per kegiatan atau pesan default. Dialog detail
  memakai `<dialog>` native, navigasi panah, dan layout layar penuh di HP.
  Semua baris pendaftar kini ringkas dan membuka dialog detail universal; data,
  status pembayaran, dan catatan tampil di dialog, sedangkan kontrol seleksi
  hanya muncul untuk kegiatan mode Seleksi. Email otomatis masih belum
  dikerjakan (butuh domain). Bukti follow Instagram hanya untuk event gratis +
  Seleksi: multipart hanya pada kondisi itu; JPG/PNG/WebP maksimal 2 MiB masuk
  ke bucket privat `instagram-proofs`, dan database hanya menyimpan object path.
  Admin mendapat signed URL 10 menit setelah verifikasi admin. Rate limiting
  upload anonim adalah follow-up security pra-launch; function crash di antara
  upload dan RPC bisa meninggalkan object privat orphan. Detail ada di
  `supabase/README.md`.
- Status "Kedaluwarsa" di admin tidak disimpan di database: `admin-registrations`
  menurunkannya (`payment_expired`) dari `pending_payment` + `payment_deadline`
  yang sudah lewat, sama dengan aturan pelepasan kursi. "Lunas" selalu menang.

## Keamanan

`SUPABASE_SERVICE_ROLE_KEY` hanya di server. Jangan pernah taruh di kode
browser, log, atau commit.

CSP di `vercel.json` sudah **enforce** (bukan Report-Only). Artinya: tidak ada
`<script>`/`<style>` inline, atribut `style="..."`, handler `on*=`, atau gambar
`data:`/`blob:` di HTML/CSS. Host luar baru (font, gambar, API, iframe) harus
ditambahkan ke CSP dulu. Cek dengan memuat halaman ber-header CSP di Playwright
dan cari pesan "Refused to" di console.
Bucket `instagram-proofs` tetap privat dan tidak punya policy Storage untuk
browser; jangan membuka akses anon atau menyimpan signed/public URL di database.
