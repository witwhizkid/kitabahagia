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
  kegiatan, diisi admin per kegiatan (satu poin per baris, `**teks**` = tebal).
  Form seleksi gratis juga punya CV/portofolio PDF (opsional, bucket privat
  `selection-cvs`, 5 MB) dan link portofolio `https://` (opsional), hanya kalau
  admin mencentang "Minta CV/portofolio" (keterangannya bisa diedit). Detail:
  "Selection extras" di `supabase/README.md`.
- Kartu ringkasan: nama lokasi sendiri jadi link ↗ ke Google Maps
  (`events.location_url` dari admin, kalau kosong pencarian nama lokasi). Detail
  kegiatan punya bagian "Lokasi" dengan peta Google tertanam (dicari dari teks
  lokasi, dimuat hanya saat "Detail kegiatan" dibuka) + tombol "Buka di Google
  Maps". CSP `frame-src` mengizinkan www.google.com dan maps.google.com. "Ajak teman ikut: WhatsApp ·
  Salin link" ada di layar sukses (`renderShare` di `renderOnboarding`), bukan di
  kartu ringkasan, supaya tidak mengganggu alur form. Tombol Daftar yang
  menempel ala Luma sengaja tidak dibuat: form sudah langsung di bawah ringkasan.
- Layar sukses (gratis terkonfirmasi / bayar lunas / diterima) punya "Simpan ke
  kalender": link Google Calendar + file .ics (pengingat H-1) dari `selectedEvent`
  (`renderCalendar` di `renderOnboarding`). Cek status belum punya karena
  `payment-status` tidak mengirim tanggal kegiatan.
- Centang "Ingat data saya" (tanpa `name`, tidak ikut terkirim) menyimpan nama,
  WA, email, domisili, instansi di `localStorage` `kb_volunteer_profile` saat
  submit valid dan mengisi otomatis pendaftaran berikutnya; tidak dicentang =
  data tersimpan dihapus.

Halaman detail Kisah (`kisah-detail.html`, `js/stories.js`), gaya editorial ala Kinfolk:
- Ringkasan tampil sebagai paragraf pembuka besar; baris info "tanggal · N menit
  baca" (200 kata/menit). Drop cap sudah dihapus (user: terlalu kuno).
- Isi, pembuka, dan kutipan memakai serif **Newsreader** (Google Fonts, hanya di
  halaman ini); judul/subjudul tetap font KB. Paragraf ber-indentasi baris
  pertama. Layar ≥900px: foto sampul menempel di kiri, teks di kanan
  (`.story-detail-layout.has-cover`); HP/tablet bertumpuk. Baris "Bagikan:
  WhatsApp · Salin link" di atas teks.
- Isi tetap teks polos di database; blok diawali `>` = kutipan besar (baris
  terakhir diawali "—" jadi nama narasumber kecil), diawali `##` = subjudul.
  Petunjuknya ada di bawah kolom Isi Kisah di admin.
- Penutup: ajakan "Lihat jadwal kegiatan" lalu "Kisah lainnya" (3 kartu,
  memakai kartu arsip). Belum: foto di tengah cerita, keterangan foto, penulis
  (butuh perubahan database).

Lainnya:
- Gerak halus ala Aesop: `.reveal` (fade + naik 16px, .8s) juga dipasang otomatis
  oleh JS ke `main > section:not(:first-child) > .container > *` yang di bawah
  layar pertama (bukan di halaman pendaftaran, bukan saat reduced motion, bukan
  `sr-only`/tersembunyi). Zoom foto kisah/kegiatan pelan (1.2s/.9s) hanya di
  `@media (hover:hover)` untuk kisah.
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
  Admin mendapat signed URL 10 menit setelah verifikasi admin. Rate limit per IP
  (hash, 30/10 menit, 200/24 jam; dilonggarkan karena CGNAT operator/WiFi kampus) ada di `create-registration` sebelum body dibaca
  (`check_registration_rate`, gagal = tetap diizinkan); function crash di antara
  upload dan RPC bisa meninggalkan object privat orphan. Detail ada di
  `supabase/README.md`.
- Akun admin: 6 ketua tim program memakai peran **Admin** biasa (boleh lihat
  pendaftar/data pribadi dan menayangkan kegiatan); arsip/hapus hanya oleh
  admin inti lewat kesepakatan, bukan kode. Peran khusus (Editor Kegiatan,
  Desain, Penulis Kisah) belum dibuat; buat hanya kalau dibutuhkan. Kartu
  kegiatan di admin menampilkan "Diubah <waktu> oleh <bagian email sebelum @>"
  (`events.last_edited_by/at`, hanya diisi `admin-events`; bukan riwayat lengkap).
- Admin → Pendaftar (tahap 1 "ala Linear", tampilan tetap KB): toolbar satu baris
  (cari dengan jeda 300 ms, filter langsung berlaku, Reset hanya saat ada filter,
  total, Ekspor CSV untuk semua kegiatan); satu header kolom lalu baris padat tanpa
  label berulang (Pendaftar · Kegiatan+kode · Status+bayar+riwayat · Terdaftar ·
  Detail); seluruh baris membuka Detail; status = titik warna + teks; ringkasan
  seleksi satu baris; command bar "N dipilih · Terima · Cadangan · Tolak" hanya
  saat ada yang dicentang; keputusan satuan tanpa `confirm()`. Tablet menyembunyikan
  kolom tanggal; HP baris bertumpuk. Respons pencarian lama diabaikan
  (`registrationLoadSeq`). Tahap 2 (susun ulang panel Detail) belum.
- Admin di HP (≤768px): tab bar bawah dengan ikon (disembunyikan saat form
  kegiatan/kisah terbuka), logo di header, judul + tombol Tambah satu baris,
  kartu kegiatan ringkas tanpa label. Tablet (769–900px) tetap tab atas. Form
  kegiatan punya tombol lompat per bagian yang menempel saat di-scroll.
- Preview link (WA/IG): tiap halaman memakai gambar JPG 1200×630 di `img/og/`
  (dibuat dari foto yang ada, di bawah 300 KB). Beranda dan halaman umum
  (kontak, FAQ, privasi, ketentuan, cek status, pendaftaran tanpa slug) memakai
  `img/og/beranda.jpg` = crop foto hero slide 2 yang ada bendera Kita Bahagia. `middleware.js` (Vercel Routing
  Middleware) hanya untuk bot preview di `pendaftaran.html?event=...`: bot
  mendapat HTML kecil dengan judul/tanggal/lokasi/harga/poster kegiatan dari
  `public-events`; pengunjung biasa tetap dapat halaman statis.
- Status "Kedaluwarsa" di admin tidak disimpan di database: `admin-registrations`
  menurunkannya (`payment_expired`) dari `pending_payment` + `payment_deadline`
  yang sudah lewat, sama dengan aturan pelepasan kursi. "Lunas" selalu menang.

## Rencana fitur (belum dikerjakan)

Web sengaja tidak ditambah fitur baru sampai pemicunya terjadi (roadmap:
4 kegiatan/bulan, tim ± 70 orang; 24 perancang program = 6 tim × 4 orang,
tim 1–3 dan 4–6 bergantian tiap bulan, + 1 kegiatan gratis akhir bulan).
**Ingatkan user soal sertifikat otomatis** kalau topiknya muncul atau user
bilang "lanjut fitur sertifikat".

Sertifikat relawan otomatis (disepakati konsepnya, belum dibangun):
- Fondasi: data kehadiran. Tambah "Tandai hadir" (bulk) di admin Pendaftar;
  sekarang sistem hanya tahu siapa yang daftar.
- Alur: admin klik "Terbitkan sertifikat" → semua yang hadir → pratinjau
  daftar nama (bisa dibetulkan; rapikan huruf kapital) → tiap sertifikat dapat
  **link pribadi** acak (`sertifikat?k=...`, sama dengan isi QR) yang
  menampilkan "sah" + tombol Unduh PDF. User ingin serba instan, tanpa input
  kode. Pengiriman: kalau sudah ada domain sendiri → email otomatis ke semua
  yang hadir (jalur utama) + 1 pengumuman di grup WA kegiatan; tombol "Kirim via
  WA" per orang (draf WA existing) sebagai cadangan. Sebelum ada domain → draf
  WA per orang. Cek status (kode pendaftaran + email) tetap ada sebagai cadangan.
- Template per kegiatan dari divisi Desain: PNG 2000×1414 (A4 landscape) yang
  sudah berisi latar, deskripsi kegiatan, tanda tangan Founder + Project Leader.
  Sistem hanya menempel nomor, nama, peran ("Sebagai Relawan Tingkat
  Nasional"/Panitia/Pemateri), dan QR. Posisi teks harus sama di semua
  template; nama panjang otomatis mengecil. QR di area kosong kanan tanda
  tangan Project Leader. Font nama: tanyakan ke Desain.
- Nomor dicetak dengan format lama `13.044/KB/VII/2026` (tampilan/arsip saja,
  berurutan jadi mudah ditebak); arti "13" dan "044" **belum dijawab** tim Desain.
- QR berisi kode verifikasi **acak** terpisah (tidak bisa ditebak/dienumerasi).
  Halaman link hanya menampilkan "sah", nama, kegiatan, tanggal, peran, dan
  PDF sertifikat itu sendiri; tanpa HP/email.
- Template bertanda tangan disimpan di bucket privat (bisa dipalsukan kalau
  bocor); relawan hanya bisa mengunduh sertifikat miliknya. Minta izin Project
  Leader untuk pemakaian tanda tangannya.
- Keputusan user: sertifikat **hanya untuk relawan yang hadir di lapangan**
  (tanpa panitia/"Tambah panitia"; peran selalu "Sebagai Relawan Tingkat
  Nasional", jadi baris ini boleh tetap di template); kegiatan gratis akhir
  bulan juga dapat; terbit **H+7**; "Tandai hadir" dan "Terbitkan" hanya oleh
  **admin** (tim pelaksana absen manual lalu lapor ke admin); izin tanda tangan
  aman; anggap domain sudah ada (email jalur utama). Belum ada data lama untuk
  diimpor; kegiatan pertama Oktober 2026.
- Template kosong = sertifikat jadi dengan teks nomor dan nama dihapus; minta
  juga 1 contoh terisi untuk posisi/ukuran.
- Data sebelum fitur ada dicatat di Google Sheet (template
  `Pencatatan-Kehadiran-Dampak-Kita-Bahagia.xlsx`): tab `Kegiatan` (slug,
  tanggal, durasi_jam, penerima_manfaat, hasil, dll.) dan `Kehadiran` (slug,
  kode_pendaftaran, nama_lengkap, no_hp, peran, hadir, dll.). Diimpor sekali
  saat fitur dibangun (cocokkan slug + kode/no. HP).

Dashboard dampak publik (setelah ± 6 laporan bulanan konsisten): angka total
kegiatan, relawan hadir unik, jam relawan (durasi × hadir), penerima manfaat,
lokasi, mitra, relawan yang ikut lagi; grafik per bulan. Sebagian otomatis dari
data hadir, sebagian dari bagian "Laporan dampak" di form kegiatan. Publik hanya
melihat agregat, tanpa data pribadi. Keputusan user: data kegiatan sebelum web
(sejak 2024) **tidak** diimpor per kegiatan (tidak tercatat). Dashboard berisi
angka rinci mulai Oktober 2026, ditambah satu kalimat sejarah yang bisa diedit
(mis. "Sejak 2024, Kita Bahagia telah mengadakan lebih dari 20 kegiatan di 8
kota"; angka disepakati owner, dibulatkan ke bawah).

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
