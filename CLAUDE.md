# Kita Bahagia — catatan kerja untuk Claude

Situs statis multi-halaman (HTML/CSS/JS vanilla) di Cloudflare Pages
(`kitabahagia.id`; Vercel = cadangan sementara), backend Supabase
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
- Skill pihak ketiga (MIT) di `.claude/skills/`: `ui-ux-pro-max` (skrip dari root
  repo) dan `design-dna` (ukur warna butuh `npm install --prefix` di folder
  `scripts`-nya; `node_modules` tidak di-commit), `cast` + `paint` dari genjutsu
  (sub-skill di `.claude/skills/genjutsu/_jutsu`, dicari dari root repo). `cast`/
  `paint` hanya dipakai kalau user memintanya. Keputusan desain di file ini
  tetap menang atas sarannya.
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
- Bingkai poster 4:5 dengan `object-fit: contain` (poster tidak terpotong);
  poster non-4:5 duduk di latar polos `--sand` (latar blur dihapus: keruh).
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
- Layar Konfirmasi punya kalimat konsekuensi per mode (`[data-review-consequence]`):
  berbayar = QRIS dibuat + slot ditahan; seleksi = masuk seleksi + tanggal
  pengumuman; gratis biasa = langsung aman. Copy `expired` (QRIS kedaluwarsa, slot
  masih ditahan sampai deadline, buat QRIS baru), `failed`, gagal cek status, dan
  `SERVER_ERROR` menjelaskan data tetap tersimpan dan tidak perlu daftar/bayar ulang.
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
- Sudut membulat di halaman pendaftaran/pembayaran (kartu 22–28px, tombol dan
  label pil) **disengaja** biar playful; jangan disamakan ke 6–8px halaman lain
  (sudah dicoba, user: terlalu kaku). Label kapital kecil (`.eyebrow`) di beranda maksimal 2
  (Jejak + Agenda berikutnya). Jangan pakai `font-style: italic` pada
  Instrument Sans/DM Sans: versi italic tidak dimuat, jadi browser memiringkan palsu.
- Gerak halus ala Aesop: `.reveal` (fade + naik 16px, .8s) juga dipasang otomatis
  oleh JS ke `main > section:not(:first-child) > .container > *` yang di bawah
  layar pertama (bukan di halaman pendaftaran, bukan saat reduced motion, bukan
  `sr-only`/tersembunyi). Zoom foto kisah/kegiatan pelan (1.2s/.9s) hanya di
  `@media (hover:hover)` untuk kisah.
- Transisi antarhalaman: `@view-transition` fade .3s (mati saat reduced motion).
  Angka Jejak beranda 2×2 di semua lebar dan menghitung naik sekali saat terlihat
  (tahun tidak); label pakai `.impact-editorial-stat > span` supaya span di dalam
  angka tidak ikut mengecil.
- Hero beranda: foto slide aktif zoom pelan 1.08→1 (7 s) dan judul muncul dengan
  wipe atas→bawah (`hero-title-in`); HP/tablet hanya teks slide pertama. Mati saat
  reduced motion.
- Program beranda desktop (≥901px): JS menambah `.program-stage` (salinan foto
  kartu, aria-hidden, ditaruh di akhir grid supaya `:nth-child` kartu tetap) yang
  menempel di kiri dan berganti dengan efek tirai saat teks program lewat tengah
  layar; foto per kartu disembunyikan. HP/tablet tetap baris biasa + tirai saat
  kartu muncul. Sticky butuh `overflow-x: clip` (bukan `hidden`) di
  `html.home-document`/`.home-page`.
- Kesan premium (hasil design-dna): kata aksen `h1 em, h2 em` = Newsreader italic
  maroon (dimuat di semua halaman ber-Google Fonts; `em` netral pakai
  `font-family: inherit`); `text-wrap: balance` di heading, `pretty` di paragraf;
  token `--radius-photo` 2px, `--radius-card` 4px, `--ease`; tekstur kertas
  `img/grain.png` (4 KB) via `body::after` (bukan di pendaftaran); foto `main`
  fade saat selesai dimuat (`.img-fade`, hero dikecualikan).
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
  hanya muncul untuk kegiatan mode Seleksi. Email otomatis ke pendaftar belum
  dikerjakan (domain + SMTP Brevo sudah siap). Bukti follow Instagram hanya untuk event gratis +
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
  (`registrationLoadSeq`). Panel Detail (tahap 2): header menempel berisi ‹ n/N ›,
  nama, status (titik) + kode, dan tombol keputusan (khusus Seleksi); isi dikelompokkan
  Seleksi → Data pendaftar → Kegiatan & pembayaran; WA hasil di footer (tersembunyi
  bila belum ada hasil). Pintasan: ← → pindah, T/C/X = Terima/Cadangan/Tolak.
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

Hosting & pembayaran (keputusan user, Sep 2026):
- Domain **kitabahagia.id** (dibeli di Jagoan Hosting, Sep 2026), tanpa www
  (www dialihkan ke apex lewat Redirect Rule Cloudflare). Hosting pindah ke
  **Cloudflare Pages** (Vercel Hobby tidak boleh komersial); Vercel tetap hidup
  sebagai cadangan sampai domain stabil, lalu `vercel.json`, `middleware.js`,
  `.vercelignore` bisa dihapus. File Pages: build `bash scripts/build-pages.sh`
  → `dist/` (menyalin semua kecuali isi `.vercelignore`, dotfile, file Vercel;
  jadi `_headers`/`_routes.json` jangan dimasukkan ke `.vercelignore`),
  `_headers` (header + CSP, samakan dengan `vercel.json` selama dua-duanya ada),
  `functions/_middleware.js` (preview bot, dibatasi `_routes.json` ke
  `/pendaftaran(.html)` supaya kuota Functions tidak habis). Pages mengalihkan
  `x.html` → `/x`, jadi canonical/og:url/sitemap memakai URL tanpa `.html`;
  link di dalam situs tetap `.html` (tetap jalan lewat redirect). Supabase Auth:
  Site URL + Redirect URLs `https://kitabahagia.id/admin/`.
- Email (Sep 2026, semua lewat dashboard, tanpa kode): Supabase Auth mengirim via
  SMTP **Brevo** dengan pengirim `Kita Bahagia <noreply@kitabahagia.id>`; domain
  terautentikasi di Brevo (DKIM `brevo1/2._domainkey`, DMARC `p=none`). Email
  masuk lewat **Cloudflare Email Routing**: `halo@` dan `noreply@kitabahagia.id`
  → `kitabahagiaidn@gmail.com`. SPF hanya satu record (Cloudflare); jangan
  tambah record `v=spf1` kedua. Jalur ini dipakai juga untuk email sertifikat.
- Payment gateway: Midtrans tetap utama (owner mendaftar, perorangan). Xendit
  dan Duitku didaftarkan sebagai cadangan; pindah hanya kalau Midtrans belum
  approve sampai akhir Oktober. Yang diganti cuma `create-payment` +
  `midtrans-webhook`, CSP, env, dan teks FAQ/Ketentuan/Privasi; frontend QR,
  seat-hold, `payment-status` tetap.


Web sengaja tidak ditambah fitur baru sampai pemicunya terjadi (roadmap:
4 kegiatan/bulan, tim ± 70 orang; 24 perancang program = 6 tim × 4 orang,
tim 1–3 dan 4–6 bergantian tiap bulan, + 1 kegiatan gratis akhir bulan).
**Ingatkan user soal sertifikat otomatis** kalau topiknya muncul atau user
bilang "lanjut fitur sertifikat".

Sertifikat relawan otomatis (disepakati konsepnya, belum dibangun):
- Tahap 1 **dibangun (Sep 2026)**: "Tandai hadir"/"Batal hadir" (bulk) di admin
  Pendaftar, checkbox muncul untuk semua mode saat 1 kegiatan dipilih; hanya
  pendaftar `confirmed`, mulai hari kegiatan (WIB), 1 kegiatan per aksi;
  `registrations.attended_at/attendance_marked_by`, RPC `mark_attendance`. Detail:
  "Attendance" di `supabase/README.md`. Tahap berikutnya: daftar tanda tangan →
  pengaturan sertifikat per kegiatan → terbitkan + email → halaman cek keaslian.
- Alur: admin klik "Terbitkan sertifikat" → semua yang hadir → pratinjau
  daftar nama (bisa dibetulkan; rapikan huruf kapital) → tiap sertifikat dapat
  **link pribadi** acak (`sertifikat?k=...`, sama dengan isi QR) yang
  menampilkan "sah" + tombol Unduh PDF. User ingin serba instan, tanpa input
  kode. Pengiriman: kalau sudah ada domain sendiri → email otomatis ke semua
  yang hadir (jalur utama) + 1 pengumuman di grup WA kegiatan; tombol "Kirim via
  WA" per orang (draf WA existing) sebagai cadangan. Sebelum ada domain → draf
  WA per orang. Cek status (kode pendaftaran + email) tetap ada sebagai cadangan.
- **Template dinamis (keputusan user, Sep 2026, "Opsi A")**: sertifikat digambar
  sistem, bukan PNG per kegiatan dari Desain. Desain meniru sertifikat lama KB
  (user akan mengirim 1–2 contoh; buat **mockup** dulu untuk disetujui sebelum
  membangun). Sistem menggambar latar/ornamen/logo, judul, nomor, nama (panjang
  otomatis mengecil), "Sebagai Relawan Tingkat Nasional", deskripsi kegiatan
  (judul/tanggal/lokasi dari data event), tanda tangan Founder + Project Leader,
  dan QR (area kosong kanan tanda tangan Project Leader). A4 landscape
  (2000×1414). Mockup disetujui arah umumnya (Sep 2026): layout, posisi, warna
  diukur dari contoh (kuning judul `#EFB635`, maroon nama `#780C06`, logo
  `assets/logo/2. Logo Gabungan/Logo Kita Bahagiaa.png`; logo putih `20.png` di
  ornamen gelap); font sementara Plus Jakarta Sans (judul/nama/tanda tangan) +
  Lexend (nomor/PENGHARGAAN/deskripsi) sampai Desain memberi font asli.
  Deskripsi: kalimat pertama otomatis dari data event, kalimat berikutnya ditulis
  admin per kegiatan. Nama panjang (keputusan user): mengecil dari 118px sampai
  batas ±84px; kalau masih tidak muat, pecah jadi 2 baris di spasi antarkata
  dengan panjang baris seimbang.
- **Daftar tanda tangan (keputusan user)**: admin sendiri mengunggah tanda tangan
  lewat menu admin "Tanda tangan", sekali per orang (nama + peran Founder/Project
  Leader) + stempel Founder (file terpisah, ditumpuk seperti contoh). Latar putih
  dihapus otomatis di browser saat upload (PNG transparan), dengan pratinjau di
  sertifikat. Wajib centang "Pemilik tanda tangan sudah mengizinkan"; catat
  pengunggah + waktu. Bisa dinonaktifkan (sertifikat lama tetap sah, nama tidak
  bisa dipilih untuk kegiatan baru). Saat menerbitkan, admin memilih Project
  Leader dari daftar; scan baru hanya untuk PL yang belum ada. Sumber scan: file
  lama dari Desain, atau pulpen hitam tebal di HVS putih difoto/scan lurus.
- **Font: Garet** (dari tim Desain; desain Canva "Sertifikat Volunteer Kita
  Bahagia - Tidung", A4 1123×794). Tidak ada di Google Fonts: file font di-host
  sendiri (aman untuk CSP `font-src 'self'`); cek lisensi + varian (tampaknya
  Heavy untuk judul/nama, Book untuk teks) sebelum dipakai. Mockup sementara
  pakai Plus Jakarta Sans + Lexend.
- **Kegiatan kolaborasi** (opsional per kegiatan): logo mitra di kanan atas
  sebelah logo KB (versi putih di ornamen gelap), kolom tanda tangan ketiga untuk
  penanda tangan mitra dengan jabatan bebas (urutan Founder · Mitra · Project
  Leader, QR tetap di kanan PL), dan kalimat pertama deskripsi otomatis memuat
  "…berkolaborasi dengan {mitra}…". Daftar tanda tangan perlu peran "Mitra"
  (nama + jabatan + organisasi).
- **Ornamen kanan per kegiatan (keputusan user, "cara 3")**: default pilih
  **preset** (kelopak, balok, bisa ditambah; dengan pilihan warna), atau admin
  **upload ornamen khusus** dari Desain (PNG transparan ±700×1414, hanya panel
  kanan ± sepertiga) yang menggantikan preset. Area kiri (teks) selalu bersih;
  ada pratinjau sebelum terbit.
- Nomor (format `13.044/KB/VII/2026`) **sama untuk semua relawan dalam satu
  kegiatan** dan **diketik admin** saat menerbitkan; arti "13" dan "044" rahasia
  internal, jadi sistem tidak menghitung atau menafsirkannya (cukup simpan teks
  nomornya per kegiatan). Admin juga memilih Project Leader kegiatan itu.
- Tanda tangan: PNG (latar transparan) Founder + tiap Project Leader, **hanya
  dengan izin orangnya**, disimpan di bucket privat. Font: dari sertifikat lama
  (kalau tidak diketahui, cari yang paling mirip di Google Fonts).
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
- Masih ditunggu dari user: contoh sertifikat lama, scan tanda tangan (dengan
  izin), nama font.
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

CSP di `_headers` (Cloudflare) dan `vercel.json` (cadangan) sudah **enforce** (bukan Report-Only). Artinya: tidak ada
`<script>`/`<style>` inline, atribut `style="..."`, handler `on*=`, atau gambar
`data:`/`blob:` di HTML/CSS. Host luar baru (font, gambar, API, iframe) harus
ditambahkan ke CSP dulu. Cek dengan memuat halaman ber-header CSP di Playwright
dan cari pesan "Refused to" di console.
Bucket `instagram-proofs` tetap privat dan tidak punya policy Storage untuk
browser; jangan membuka akses anon atau menyimpan signed/public URL di database.
