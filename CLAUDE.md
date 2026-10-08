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

Daftar kegiatan (`jadwal.html` + beranda, dirender oleh `js/script.js`), dirombak Okt 2026 karena KB
hanya ±4–5 kegiatan/bulan dan poster terbit ±H-7 (keputusan user, ala card Kitabisa):
- Jadwal = grid kartu `eventCardMarkup` (sama dengan beranda) + 2 tab "Mendatang" / "Sudah selesai"
  (tab kedua hanya muncul kalau ada; `public-events?past=true`, 12 terbaru, status Selesai atau tanggal
  lewat, bukan draf/batal). Kolom cari, tab kategori, pengelompokan per bulan, dan fitur lebar
  "Segera berakhir" dihapus (dulu semua kegiatan muncul dua kali). Hidupkan lagi hanya kalau kegiatan
  sudah belasan per bulan (ada di riwayat git).
- Kartu: poster 4:5 utuh (`contain`); gambar yang bukan 4:5 (foto landscape) otomatis `cover`
  (`fitEventPhoto`, kelas `.is-cover`) supaya tidak ada pita kosong. Isi: kategori, judul (maks. 3–4
  baris), ikon lokasi/tanggal, harga + sisa slot, dan teks ajakan "Daftar →" / "Lihat detail →" di
  kanan bawah (tanda bisa diklik di HP). Seluruh kartu bisa diklik (stretched link di judul); ditekan
  mengecil .98; hover desktop naik 4px + border maroon + panah bergeser (mati saat reduced motion). Desktop/tablet
  3 kolom; HP: beranda kartu geser, Jadwal kartu mendatar (poster 118px di kiri, setinggi kartu,
  `cover` dari atas supaya tidak ada ruang kosong di bawah foto; poster 4:5 terpotong sisi kiri-kanan). Hover hanya di
  `@media (hover:hover)`.
- Kartu membulat + palet KB (Okt 2026, ref. Gojek, mockup disetujui user): kartu kegiatan sudut 24px
  (`--radius-round`), latar putih, foto masuk 8px dengan sudut 18px (`--radius-round-photo`); kategori = pil berwarna
  sesuai Program Family kegiatan (`events.program_key` → kelas `family-reguler/adventure/impact` di
  `eventCardMarkup`; kosong = pil maroon muda), dikirim `public-events`. Palet sekunder dari ornamen sertifikat:
  Reguler maroon `#8a150e`/`#fbe4e1`, Unique krem (teks maroon gelap `#53141d`/`#f6e6d6`; dulu hijau, ditolak user: KB tidak punya hijau), Gratis emas `#8f5d00`/`#fff0c7`
  (token `--fam-*`). Kartu Program berlatar warna bab (sudut 28px, foto inset 20px, label pil, judul + titik warna
  bab). Semua `.btn` pil. Foto non-cetakan (Program/Kisah Beranda, arsip Kisah, foto pembuka) 18px; **cetakan
  jurnal Beranda tetap bersudut 2px** (kesan foto cetak). Garis tebal di atas daftar Kegiatan Terdekat dihapus.
- Kegiatan sedikit (Okt 2026, audit UI): kalau yang tampil 1–2 kegiatan, grid dapat `.is-few` (+ `.is-one`) dari JS
  (`renderHomepageEvents`, `applyFilters` Jadwal) → ≥768px kartu mendatar besar (poster 40% kiri, `cover` dari atas):
  tablet satu kolom maks. 640px, ≥1100px dua kolom (satu kartu maks. 760px). HP tidak berubah.
- Urutan Beranda: hero → Jejak → **Kegiatan Terdekat** → Program → Tentang → Kisah (Okt 2026, dulu Terdekat setelah
  Program). Judul bab Program tidak lagi sticky berlatar krem (kotak sisa Stage 8 dihapus).
- Badge poster (`eventPhotoBadge`): label gelap "Kuota penuh" / "Ditutup" / "Selesai"; poster
  hitam-putih **hanya** untuk kuota penuh (keputusan user Okt 2026: kegiatan selesai/ditutup tetap berwarna); buka dan tutup ≤7 hari = label maroon "N hari lagi"/"Besok"/
  "Hari ini". Kegiatan ditutup/selesai tidak menampilkan sisa slot.
- Status default "Pendaftaran dibuka" tidak ditampilkan.

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
- Urutan layar sukses gratis (`#freeRegistrationConfirmation`, Okt 2026, masukan user: tombol grup terlalu ke bawah) diatur
  lewat CSS `order` (markup/JS tetap): judul → "Tempatmu sudah dikonfirmasi" → kartu kegiatan → kartu putih "Langkah
  berikutnya" (tombol Grup WhatsApp selebar kartu, kalender pil kecil, ajak teman) → kode pendaftaran → catatan email →
  link Instagram. Baris "Kegiatan" disembunyikan kalau kartu kegiatan tampil (dobel). Link grup juga ada di email konfirmasi.
- Layar sukses (gratis terkonfirmasi / bayar lunas / diterima) punya "Simpan ke
  kalender": link Google Calendar + file .ics (pengingat H-1) dari `selectedEvent`
  (`renderCalendar` di `renderOnboarding`). Cek status belum punya karena
  `payment-status` tidak mengirim tanggal kegiatan.
- Layar sukses (gratis terkonfirmasi, seleksi "applied", bayar lunas) menampilkan "Email konfirmasi
  sudah dikirim ke <email yang diketik>. … Cek folder Promosi atau Spam." (`renderEmailNote`,
  `[data-email-note]`; masukan tim Okt 2026, sekalian membuat salah ketik email ketahuan). Cadangan /
  tidak lolos tidak mendapat email, jadi catatannya disembunyikan.
- Form peserta (Okt 2026, permintaan owner) juga wajib: Usia (10–100), Akun Instagram/TikTok,
  dan "Dari mana kamu tahu kegiatan ini?" (pilihan: Instagram, TikTok, Informasi teman; database
  masih menerima kunci lama lain). Dropdown pakai gaya KB (`enhanceFormSelect` di `js/script.js`,
  meniru `enhanceSelect` admin; select asli tersembunyi tetap sumber nilai + validasi). Tampil di
  Konfirmasi, admin Detail + CSV, dan Privasi.
  Detail: "Registration profile fields" di `supabase/README.md`.
- Paket form Okt 2026: data "Ingat data saya" **tidak lagi diisi diam-diam**; muncul kartu "Daftar sebagai <nama>?" ([data-profile-
  prompt]) dengan "Pakai data ini" / "Bukan saya" (hapus simpanan). Error nomor WA ramah + contoh 081234567890 dan kolom
  bergoyang (`.is-shaking`; aturan validasi tidak berubah). Tombol Konfirmasi: spinner (`.is-loading`) lalu hijau ✓ (`.is-done`).
  Tutup ≤24 jam lagi: badge poster + status ringkasan jadi "Tutup dalam HH:MM:SS" (`data-countdown`, satu timer global).
  Daftar sukses disimpan di `localStorage kb_my_registration`; Beranda + Jadwal menampilkan "Kamu terdaftar di <kegiatan> · <hari>
  · Cek status →" sampai hari kegiatan lewat (`renderMyRegistration`, tidak dikirim ke server).
- Centang "Ingat data saya" (tanpa `name`, tidak ikut terkirim) menyimpan nama,
  WA, email, domisili, instansi, usia, akun sosmed di `localStorage` `kb_volunteer_profile` saat
  submit valid dan mengisi otomatis pendaftaran berikutnya; tidak dicentang =
  data tersimpan dihapus.

Halaman detail Kisah (`kisah-detail.html`, `js/stories.js`), gaya editorial ala Kinfolk:
- Ringkasan tampil sebagai paragraf pembuka besar; baris info "tanggal · N menit
  baca" (200 kata/menit). Drop cap sudah dihapus (user: terlalu kuno).
- Isi, pembuka, dan kutipan memakai serif **Newsreader** (di-host sendiri, hanya di
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
  (sudah dicoba, user: terlalu kaku). Okt 2026: kartu publik ikut membulat (lihat "Kartu membulat + palet KB"). Label kapital kecil (`.eyebrow`) di beranda maksimal 2
  (Jejak + Agenda berikutnya). Jangan pakai `font-style: italic` pada
  Instrument Sans/DM Sans: versi italic tidak dimuat, jadi browser memiringkan palsu.
- Gerak halus ala Aesop: `.reveal` (fade + naik 16px, .8s; di Beranda/Tentang/Program/
  Jadwal/Kisah dipersingkat jadi 7px, 220 ms oleh blok "Field-journal craft" dari Codex,
  Sep 2026) juga dipasang otomatis
  oleh JS ke `main > section:not(:first-child) > .container > *` yang di bawah
  layar pertama (bukan di halaman pendaftaran, bukan saat reduced motion, bukan
  `sr-only`/tersembunyi). Zoom foto kisah/kegiatan pelan (1.2s/.9s) hanya di
  `@media (hover:hover)` untuk kisah (halaman Kisah/Program kini zoom tipis 1.012,
  220 ms dari blok yang sama).
- Halaman Program dikelompokkan jadi 3 bab (`.program-family`): **Program Reguler, Program Unique, Program Gratis**
  (nama disamakan dengan Beranda + admin, Okt 2026; kunci database tetap). Label nomor hiasan 01/02/03 **dihapus** (Okt 2026, keputusan user: kesan template/AI):
  bab Program, alur program (jadi panah →), Program + testimoni Beranda, angka Jejak, Nilai Kami Tentang.
  Nomor hanya dipakai untuk urutan sungguhan (langkah Relawan/Kolaborasi, panduan bayar). Jangan tambah lagi.
  Kartu Program (Okt 2026, audit UI): per bab grid kartu putih (foto 3:2 di atas, tag, judul, deskripsi, meta),
  alur kegiatan dilipat di `<details class="program-flow-details">` "Lihat alur kegiatan"; bab dengan satu
  program = kartu lebar (foto kiri) di ≥961px; HP = satu baris kartu geser per bab (84%), supaya halaman tidak
  memanjang.
- Pembuka halaman satu pola (Okt 2026, audit UI): breadcrumb → teks kiri (judul + kalimat [+ catatan]) dan
  **foto cetakan jurnal** kanan (`.hero-print`: bingkai krem, miring -1°, masuk pelan sekali saat dimuat) di
  Program, Tentang (foto strip penuh di atas dihapus), Kolaborasi, Relawan, Kisah; kolom 1.1fr/.9fr, ≤960px
  bertumpuk. Judul pembuka bersama `clamp(44px, 4.6vw, 64px)` supaya tidak pecah 5 baris. Jadwal sengaja tanpa
  foto (isinya poster kegiatan), Kontak/FAQ/halaman legal juga tetap teks.
- "Living Archive" (Codex, Sep 2026, migrasi `20261012010000`): `events.program_key`
  (masyarakat_reguler / adventure_unique / impactful_action, diisi di form Kegiatan) dan
  `stories.event_id` (Kegiatan terkait di form Kisah, `on delete set null`). Data lama
  tidak diisi otomatis; halaman publik belum memakainya.
- Navigasi publik HP (≤960px, sama dengan breakpoint hamburger): **tab bar bawah + hamburger** (Okt 2026, keputusan user,
  membalik penolakan sebelumnya karena 7 menu tidak muat; mockup disetujui). Tab bar `.tab-bar` dibuat JS (`js/script.js`)
  di semua halaman ber-header kecuali `.registration-page` dan `.link-page`: Beranda · Jadwal · Program · Kisah (href absolut,
  `aria-current` dari path; kisah-detail = Kisah), ikon garis (rumah, kalender, kompas untuk Program, buku), pil krem melayang (radius 24px, `env(safe-area-inset-bottom)`), tab aktif =
  pil maroon + ikon putih. **Selalu terlihat saat scroll** (keputusan user, dulu sembunyi saat scroll ke bawah); hanya
  sembunyi saat mengetik (`body.is-typing`) dan saat menu terbuka. Kalau tim tidak setuju: revert commit tab bar
  (balik total) atau cabut tab tapi pertahankan `.nav-extra` Cek status/Relawan/FAQ di hamburger (jalan tengah). Hamburger di HP menyembunyikan 4 link itu dan mendapat `.nav-extra`
  dari JS: "Cek status pendaftaran" (paling atas), Relawan, FAQ (disembunyikan ≥961px). Footer dapat ruang bawah lewat
  `.has-tab-bar .site-footer::after`. Hero Beranda HP/tablet (tombol, strip "Berikutnya", titik slider) dinaikkan setinggi tab bar lewat `--tab-bar-space` (dulu tombol hero tertutup tab bar). Tab "Kegiatanku" sengaja **belum** dibuat (pre-launch, isinya akan kosong; pengingat
  `renderMyRegistration` sudah menutup kebutuhan); buat bareng Kartu Relawan tahap 2. Belum dicek di iPhone asli (risiko
  bertumpuk dengan bar Safari).
- Motion Beranda ala dashdigital.studio (Okt 2026, keputusan user, **Beranda dulu**; lebarkan ke halaman
  lain hanya kalau user setuju): JS menambah `html.home-motion` (hanya `.home-page`, bukan saat reduced
  motion). Judul `h2` di bawah layar pertama dipecah per kata (`.split-word`, `aria-hidden`; h2 dapat
  `aria-label` teks aslinya) lalu naik dari tirai .9s expo-out, jeda 55 ms per kata (maks. 12);
  garis atas `.kisah-section-heading` tergambar kiri→kanan
  (border jadi transparan, garis = background); `.btn` di `main` label berguling saat hover (`.btn-roll`,
  hanya `hover:hover`); header HP/tablet (≤1023px) sembunyi saat scroll ke bawah (`.is-tucked`), muncul lagi
  saat scroll ke atas. Sengaja **tidak** diambil: WebGL/three.js (berat, PageSpeed), smooth-scroll, durasi
  1,5–2,4 s. Tinggi judul sama persis dengan versi tanpa animasi (dicek).
  Blok CSS "Stage 8" (Codex, Okt 2026: sticky bab Program, Tentang dua kolom, arsip Kisah, bingkai foto
  Tentang/Kisah) **tidak boleh** mematikan motion Beranda ini (pernah terjadi, sudah dikembalikan).
  Nilai Kami di Tentang (Okt 2026, ref. gojek.io) = tiga kartu pernyataan berwarna bertumpuk (Rumah merah bata,
  Tumbuh krem, Bermakna emas; sudut 40px, kata besar kiri + kalimat kanan; HP bertumpuk dalam kartu);
  ≥1024px judul bagian tetap menempel di kiri. Selector `.about-value-sequence.value-grid` supaya menang dari
  grid 3 kolom `.value-grid` lama.
- Transisi antarhalaman (Okt 2026, ala tirai dashdigital.studio): klik link internal → JS (`js/script.js`,
  `.page-curtain`) langsung menaikkan panel maroon dari bawah (.56s) sambil logo KB putih
  (`assets/logo/logo-kita-bahagia-white.webp`) muncul pelan, lalu pindah halaman; loading terjadi di balik logo
  (dulu terasa "freeze" karena view transition baru mulai setelah halaman baru siap). `@view-transition`
  menahan bingkai tertutup itu (`old(root)` tanpa animasi) lalu halaman baru terbuka dari bawah (.85s).
  Dilewati untuk Ctrl/Cmd-klik, `target`, unduhan, link luar, dan link `#` di halaman yang sama; `pageshow`
  menurunkan tirai saat kembali (Back). Okt 2026: sisi halaman baru tidak lagi bergantung pada view transition (Chrome kadang melewatinya atau memotongnya saat halaman lambat, mis. Jadwal → tirai "kadang muncul kadang tidak"): klik menyimpan `sessionStorage kb_curtain`, `js/curtain-gate.js` (render-blocking di `<head>` semua halaman publik) memasang `html.curtain-in` (panel maroon + logo lewat `html::after`) sebelum render pertama lalu `.curtain-open` mengangkatnya .7s setelah DOM siap (cadangan 1,8 s); `::view-transition-new(root)` tanpa animasi. Tirai diam = `visibility: hidden` (dulu pinggirnya nongol merah di bawah layar HP lambat saat bar alamat Chrome menghilang). Hanya di browser dengan transisi lintas halaman (`onpagereveal`:
  Chrome/Edge/Safari 18.2+); lainnya pindah biasa. Mati saat reduced motion. Admin tidak memakainya.
  Angka Jejak beranda 2×2 di semua lebar dan menghitung naik sekali saat terlihat
  (tahun tidak); label pakai `.impact-editorial-stat > span` supaya span di dalam
  angka tidak ikut mengecil.
- Hero beranda (Okt 2026, referensi Awwwards: Rebelliously Optimistic + 1000 Whales): kata "Makna" di judul
  = pil maroon, Newsreader italic krem (`.hero-pill`), terisi dari kiri .8s setelah judul muncul. Strip
  "Berikutnya · <kegiatan> · <tgl> · <lokasi>[ · tutup N hari lagi] →" (`[data-hero-next]`, `renderHeroNext`,
  data dari fetch Kegiatan Terdekat; kegiatan pertama yang masih dibuka, kalau tidak ada yang pertama)
  melayang di baris bawah hero (absolute, jadi tidak menggeser judul): desktop kanan bawah, ≤1023px kiri
  bawah (titik slider di kanan; HP ≤767px: titik disembunyikan selama strip tampil, strip selebar baris). Tanpa kegiatan/gagal fetch = tersembunyi. Layar loading/intro sengaja
  tidak dibuat (pengunjung HP dari IG/WA, PageSpeed).
- Kedalaman scroll Beranda (Okt 2026, ref. studio-onto.com; mesin diganti ke CSS scroll-driven setelah web bank Jago
  terasa lebih mulus): `animation-timeline: scroll(root)` di 100vh pertama, tanpa JS (lerp lama dihapus). Hero turun 30vh
  lebih lambat, copy/titik/strip memudar + naik 60px (di 46vh pertama; `.hero-next` = dua animasi, fade dulu lalu
  entrance supaya entrance tetap menang); browser tanpa scroll timeline: hero diam, lembaran tetap naik; `.impact-editorial` = lembaran krem (z-index 1, sudut
  atas 28px / HP 20px, bayangan) yang naik menutupi hero. Tidak ada yang di-`scale` (ringan di HP lemah).
  Foto Jejak dan Tentang tetap bergeser ±5% (CSS scroll-driven, `scale` 1.12; Firefox/Safari lama diam).
- Loader Beranda (Okt 2026, ref. studio-onto.com, disetujui dengan syarat): `js/loader-gate.js` (render-blocking
  di `<head>` index.html, sengaja) menambah `html.loader-on` hanya kalau Beranda halaman pertama kunjungan
  (`sessionStorage kb_visit`, diisi `script.js` di setiap halaman) dan motion diizinkan. `.kb-loader`: panel maroon,
  dua bulatan logo muncul (`loader-dots.webp`), badan logo tergambar kiri→kanan (`loader-body.webp`), lalu panel
  terbuka ke atas (±1,55s); tap/tombol apa pun = skip (`loader-skip`), hanya sebelum 0,85s (sesudahnya sentuhan pertama untuk scroll dulu memutar ulang panel = efek dobel). Perangkat kuat (≥6 core, RAM ≥4 GB; `loader-portal`) tidak membuka panel ke atas: setelah logo tergambar, panel di-mask bentuk logo (`loader-mask.webp`, `mask-composite: exclude`) dan lubangnya membesar ±0,75s sampai hero terlihat "tembus lewat logo"; HP lemah (`loader-land`): logo yang sudah tergambar terbang dan mengecil ke pil "Makna" (posisi diukur JS di `loader-gate.js`, hanya transform) sementara panel memudar; pil terisi 1,3s. Kalau pil tidak terukur, tetap panel naik. Entrance hero slide 1 + pil + strip ditunda
  selama loader; kelas dilepas setelah 3,2s. Lighthouse lokal (4 run): tidak turun berarti; cek PageSpeed live.
- Tahap 1 pola Awwwards (Okt 2026, keputusan user; tahap 2 = marquee, galeri geser mendatar, foto ikut kursor,
  setelah uji coba tim): kalimat manifesto teaser Tentang di Beranda (`.ink-heading`, tidak ikut tirai per kata)
  menyala kata demi kata sesuai scroll (JS, opacity .16→1); footer Beranda terbuka di bawah `main` yang jadi
  lembaran bersudut bawah 28px (`html.footer-reveal`, footer `sticky; bottom:0`) hanya kalau tinggi footer muat
  di layar (HP: footer biasa). Wordmark "Kita Bahagia" raksasa di footer sudah dicoba dan ditolak user (jelek).
- Foto Jejak Beranda = **cetakan jurnal** (kisah utama dulu juga, diganti reel Kisah Okt 2026) (Okt 2026, mengganti block reveal ala Eleos yang
  terasa dingin): bingkai krem lewat `box-shadow` spread (crop + zoom hover tetap), miring -1°; saat terlihat
  `.journal-print.is-in` memudar masuk, naik 18px, dan miringnya mengendap dari -2,6° (.9–1,1s). Tanpa selotip
  (wrapper `overflow:hidden` akan memotongnya). `img/block-mask.png` dihapus.
- Label kapital kecil (`.eyebrow`/`.page-kicker`) yang hanya mengulang breadcrumb atau judul dihapus (Okt 2026):
  Tentang, Program, Kontak, Kolaborasi, FAQ, Relawan, Jadwal, galeri dokumentasi. Tersisa: Jejak + Agenda (Beranda),
  "Kisah" (tanpa breadcrumb), 404, nama kegiatan di Cek status. Jangan tambah label serupa.
- Hero → Jejak (ref. ONTO): judul Jejak tidak dipecah per kata; masuk dengan `scale` 2 (HP 1.6) lalu mengecil ke
  ukuran asli (view timeline, `cover 0%–45%`); kicker, paragraf, tiap angka, dan foto Jejak naik + muncul menyusul.
- Hero beranda: foto slide aktif zoom pelan 1.08→1 (7 s) dan judul muncul dengan
  wipe atas→bawah (`hero-title-in`); HP/tablet hanya teks slide pertama. Mati saat
  reduced motion.
- Program Beranda (Okt 2026, ref. gojek.io, mockup disetujui; mengganti foto menempel + tirai `.program-stage`):
  section latar krem halaman (Okt 2026, dulu maroon gelap `#2a0e13`; diganti supaya bagian gelap Beranda cuma Kisah, user: HP
  keramean), judul "Mau mulai dari yang **dekat**, yang **seru**, atau yang **berdampak**?"
  (kata = Reguler/Unique/Gratis, berwarna + garis bawah sesuai kartu yang di tengah; kartu Unique krem diberi garis tipis), lalu carousel geser `[data-program-carousel]`:
  satu kartu besar per program (sudut 48px, tinggi ikut layar `clamp(380px, 100svh - 300px, 500px)` supaya judul satu baris +
  kartu muat di laptop 1366×682 tanpa scroll; Reguler merah bata `#c23a3f`, Unique krem `#f6e6d6`, Gratis emas `#efb635`),
  isi nama + kalimat + daftar program huruf kecil tebal + tombol pil ke program.html + foto miring 1,5°. Kartu yang
  tidak di tengah redup (.55, scale .96) hanya setelah JS siap (`.is-ready`). Panah bulat (≥1024px), titik = tombol,
  panah keyboard di track. Lebar pakai container query (`cqw`) supaya scrollbar Windows tidak menggeser tengah;
  kartu terakhir diberi `margin-right` (padding akhir flex scroll tidak ikut dihitung). ≤1023px: foto di atas, snap
  `start`, tanpa panah. HP ≤767px (Okt 2026, user: kartu ketinggian): foto 16:9, nama program jadi pil kecil tanpa
  keterangannya, teks + tombol lebih kecil. CSS lama `.program-card`/`.program-grid`/`.program-stage` (±150 aturan) dihapus.
- Kisah Beranda (Okt 2026, mockup disetujui user; dulu 1 kisah besar + 2 kecil, ±1.470px di HP): latar maroon tergelap KB
  `#2a0e13` + **ambient** = salinan kecil (64px, transform Supabase) foto sampul kisah yang aktif, diburamkan, berganti pelan
  saat digeser (desktop: juga saat hover/fokus). Judul "Cerita yang dibawa pulang relawan." + tombol pil krem "Semua kisah →"
  (hover emas). Garis progres ala Story IG (tombol per kisah, emas; tersembunyi kalau semua kartu muat). Kartu editorial tanpa
  bingkai: lebar 260–320px, foto 4:3 (HP 1:1.08) sudut 18px (desktop sempat 380px 4:5, user: kegedean; ref. ukuran blog Gama Dharma), titik warna program + "Program X · tempat" (dari `stories.event_id` →
  `public-stories` list mengirim `event.program_key/location`; kosong = tanggal terbit), ringkasan sebagai kutipan Newsreader
  miring (maks. 4 baris), garis tipis, judul kecil + "N menit →". Penutup teks: "Kisah berikutnya bisa dari kamu." + "Cari
  kegiatan →". HP/tablet: kartu tidak aktif pudar .42. Snap per kartu (`scroll-snap-stop: always`); `scroll-padding` pakai
  `--container-gutter` (persen di scroll-padding dihitung dari lebar track, dulu kartu nempel ke tepi layar HP). Sengaja **tidak** playful (kisah = artikel, nada lebih dalam).
- Testimoni Beranda (Okt 2026, ref. gojek.io "open source"): tumpukan kartu miring di latar krem; judul + kalimat
  kecil + panah bulat + "n / 5" di kiri, kartu di kanan (HP bertumpuk). JS testimoni lama (autoplay 5 s, panah,
  pengumuman sr-only) tetap; `updateTestimonials` menambah `data-stack` (0 depan, 1–2 mengintip) dan `.is-thrown`
  (kartu terakhir dilempar ke kiri). Warna kartu bergilir: merah bata, emas, maroon gelap, kertas, merah muda.
  Kartu selain depan `pointer-events: none` (kartu terlempar sempat menutupi panah). CSS testimoni lama dihapus.
  HP ≤767px (Okt 2026, user: Beranda HP keramean): satu kartu datar (warna tetap bergilir, tanpa miring/tumpukan,
  tinggi = kutipan terpanjang), kalimat kecil di bawah judul disembunyikan. Nama + peran relawan ikut warna kartu (dulu abu-abu,
  tidak terbaca di kartu merah/maroon).
- "Daftar cuma 2 menit" (bingkai HP + 3 langkah, ref. bank Jago) **dicoba lalu dihapus** (Okt 2026, user: tidak efektif
  di HP dan memanjangkan Beranda). Jangan tambahkan lagi.
  Catatan: aturan `.btn` ketiga (sekitar baris 6150) sempat masih `--radius-lg` 6px, jadi "semua tombol pil" baru
  benar-benar berlaku Okt 2026 ini.
- Paket ref. Okt 2026 #3 ("geleng-geleng"): (1) **poster terbang**: klik kartu kegiatan melewati tirai; JS memberi poster
  kartu `view-transition-name: event-poster` + simpan `sessionStorage kb_poster` {slug, src}, `js/poster-handoff.js`
  (di `<head>` pendaftaran.html, sebelum render pertama) menaruh poster itu di thumbnail ringkasan dengan nama yang sama,
  tipe transisi `poster` = halaman cross-fade + latar krem (CSS `:active-view-transition-type(poster)`); Chrome/Edge/
  Safari 18.2+, lainnya pindah biasa. (2) **Kartu Relawan** di sertifikat.html (setelah data sah): kartu gradien maroon→
  merah bata→emas, miring 3D + kilau ikut kursor/kemiringan HP (Android; iOS butuh izin, dilewati), "Bagikan kartu" =
  PNG story 1080×1920 lewat `shareImageFile` (Okt 2026, mockup D disetujui user: latar maroon gelap + cahaya merah/emas,
  ID card krem miring 1,5° bertali emas, foto kegiatan, "KARTU INI MILIK" + nama + pil Newsreader "relawan Kita Bahagia",
  sobekan Lokasi/Tanggal/Relawan sejak, tombol emas kitabahagia.id/link; tinggi kartu ikut panjang nama). Pratinjau di halaman = canvas gambar yang sama
  (`drawVolunteerStory`, lebar maks. 320px, 9:16, efek miring + kilau tetap), jadi yang dilihat = yang dibagikan; kartu HTML lama dihapus. Foto + lokasi dari
  `public-certificate` (`event_photo` = foto dokumentasi pertama, kalau tidak ada poster; `event_location`). (3) **Marquee** pita frasa KB di atas Program
  Beranda **dihapus** Okt 2026 (user: Beranda HP keramean; judul Program sudah menyampaikan hal yang sama). Foto ikut kursor + galeri geser mendatar (tahap 2 Awwwards)
  sengaja tidak dibuat: daftar Kisah sudah berfoto dan carousel mendatar sudah ada di Program/testimoni/dokumentasi.
- Paket ref. Okt 2026 #2: (1) "Bagikan ke Story" di kartu "Ajak teman ikut" layar sukses: gambar 1080×1920 digambar
  di canvas (`makeStoryImage`: latar maroon gelap, kartu merah bata "Aku ikut <kegiatan>", tgl · lokasi, "Yuk, ikut juga!
  kitabahagia.id/link"; Okt 2026: poster kegiatan ikut di dalam kartu, dimuat `crossOrigin=anonymous` (Storage Supabase mengirim `Access-Control-Allow-Origin: *`; gagal/lambat 5 s = tanpa poster, kartu menyesuaikan tinggi isi); logo digambar proporsional (`drawImageAtWidth`, dulu gepeng 170×170)), HP = share sheet native
  (`navigator.share` files), lainnya unduh PNG; (2) menu aktif desktop (≥1024px) = pil krem teks maroon (masukan tim),
  HP tetap daftar hamburger; (3) 404 ramah: "Waduh, nyasar." + cetakan foto + kegiatan terdekat (`renderLinkEvents`,
  href absolut `/pendaftaran.html…`); (4) footer HP (≤640px): peta disembunyikan, tinggal link "Lihat di peta", jarak dirapatkan.
- Ref. "dekat dengan rakyat" (Okt 2026): (1) kartu kegiatan menulis "N orang udah daftar · …" kalau ≥5 (kapasitas − sisa,
  `registeredCount`; Seleksi tanpa angka); (2) layar sukses pendaftaran: konfeti kertas warna KB sekali (`celebrate` di
  `renderOnboarding`, ±2 s, mati saat reduced motion) + "Ajak teman ikut" jadi kartu merah muda dengan dua tombol pil;
  (3) `link.html` = halaman link bio IG/TikTok (`kitabahagia.id/link`, tanpa header): logo, kegiatan terdekat
  (`renderLinkEvents`, maks. 3, tersembunyi kalau kosong/gagal), tombol pil warna KB ke Jadwal/Relawan/Kisah/Kolaborasi/WA.
- Aksen judul (Okt 2026, keputusan user, anti-generik): Newsreader italic **hanya** di 3 judul Beranda (hero
  "Makna", manifesto, "Mulai dari satu kegiatan."); **stabilo** maroon (`.stabilo`, goresan tergambar sekali saat
  terlihat, `html.stabilo-motion`) hanya di Tentang "kebaikan", Relawan "hadir", Program "Ikut.". Judul lain polos.
  Maks. satu aksen per halaman; jangan tambah `<em>` di judul baru.
- Kesan premium (hasil design-dna): kata aksen `h1 em, h2 em` = Newsreader italic
  maroon (dimuat di semua halaman ber-Google Fonts; `em` netral pakai
  `font-family: inherit`); `text-wrap: balance` di heading, `pretty` di paragraf;
  token `--radius-photo` 2px, `--radius-card` 4px, `--ease`; tekstur kertas
  `img/grain.png` (4 KB) via `body::after` (bukan di pendaftaran); foto `main`
  fade saat selesai dimuat (`.img-fade`, hero dikecualikan).
- Font publik di-host sendiri (Sep 2026, PageSpeed): `fonts/*.woff2` (DM Sans, Instrument Sans,
  Newsreader normal+italic; latin + latin-ext, variable) lewat `@font-face` di awal `css/style.css`;
  HTML publik mem-preload `instrument-sans-latin` + `dm-sans-latin`, tanpa Google Fonts. Admin
  masih memakai Google Fonts (Lexend/Plus Jakarta untuk sertifikat), jadi CSP gstatic tetap.
- Peta footer = gambar statis `img/footer-map.webp` (620×320, dibuat sekali dari tile OSM +
  kredit "© OpenStreetMap contributors", titik Perpustakaan Bahagia, Jl. Kebon Pala I No. 34, Kampung Melayu; Okt 2026 dulu Kantor Kelurahan), bukan iframe
  OSM (kena 429/rate limit); zoom 15 berwarna tanpa filter (zoom 16 menampilkan ikon tempat
  ibadah; CARTO butuh API key); "Lihat di peta" ke Google Maps `maps.app.goo.gl/gG592uiAkKb6r6RB8` (semua halaman). Alamat lengkap tampil di Kontak (syarat verifikasi payment gateway: email, telepon, alamat terlihat). **Bukan** alamat rumah owner di Tomang.
- Logo header/footer semua halaman = `assets/logo/logo-kita-bahagia-320.webp` (13 KB); PNG
  2160px asli hanya untuk canvas (kalender, sertifikat). Foto Program beranda `loading="lazy"`.
- Favicon (Okt 2026): ikon tab (`favicon.ico` 16/32/48, `favicon-32/48.png`) = logo maroon transparan
  versi lama (tim Desain tidak mau kotak maroon di tab). `favicon-192.png` = logo maroon transparan
  dengan padding 12% supaya tidak terpotong lingkaran di hasil Google (dulu mepet tepi).
  `apple-touch-icon.png` tetap logo putih di kotak maroon (ikon layar HP butuh latar penuh).
  Link favicon memakai `?v=2`; kalau file favicon diganti lagi, naikkan angkanya (Chrome menyimpan
  favicon di cache terpisah yang tidak ikut Ctrl+Shift+R).
- PWA (Okt 2026, ref. Gojek/Tokopedia web): `manifest.json` (standalone, maroon `#7a1f2b`, pintasan Jadwal + Cek status) + ikon
  `assets/logo/app-icon-192/512.png` dan `app-icon-maskable-512.png` (logo putih `20.png` di atas maroon), `<link rel="manifest">`
  + `theme-color` di semua halaman publik. Tanpa service worker (sengaja: tidak ada cache offline yang bisa menahan versi lama).
  Tombol "Pasang Kita Bahagia di HP" (footer + halaman /link, `[data-install-app]`) hanya muncul saat `beforeinstallprompt`
  (Chrome/Edge/Samsung Internet Android); iPhone tetap lewat Bagikan → Tambahkan ke Layar Utama.
  Admin punya aplikasi terpisah "KB Admin" (Okt 2026, permintaan user): `admin/manifest.json` (`id`/`scope`/`start_url`
  `/admin/`, ikon sama) + `theme-color`/`apple-touch-icon` di `admin/index.html`; dipasang lewat menu browser (tanpa tombol).
  iPhone: login ulang sekali di aplikasi terpasang (penyimpanan terpisah dari Safari).
- SEO beranda: JSON-LD `WebSite` + `NGO` (nama, logo 320, email, `sameAs` IG/TikTok/LinkedIn) di
  `<head>` `index.html` + `og:site_name`. JSON-LD bukan skrip yang dijalankan, jadi aman dari CSP
  (dicek: tanpa "Refused"). Search Console sudah terverifikasi (domain), sitemap sudah dikirim.
- Foto disajikan sebagai WebP yang sudah diperkecil; berkas mentah yang tidak
  dirujuk halaman publik tidak disimpan di `img/`.
  **Jangan hapus `img/Baduy 1.webp`**: dipakai sebagai poster kegiatan di database (tidak terlihat dari grep HTML/JS;
  sempat terhapus Okt 2026 lalu dikembalikan). Cek `.vercelignore` dan data event sebelum menghapus gambar apa pun.
- Upload foto di admin dikompres di browser sebelum dikirim (`compressImage`
  di `js/admin.js`): kegiatan maks. 1200×1500, kisah maks. 1600×1600, WebP
  (JPEG di browser tanpa WebP). File sumber boleh sampai 25 MB.
- Hero beranda di HP/tablet setinggi layar (`max(560px,100svh)`). HP (≤767px)
  memakai crop potret `img/hero-*-mobile.webp` lewat `<picture>`. Slide 1
  memakai `hero-volunteer-*`; slide 2 memakai `hero-slide-2-*` dengan grade
  hangat; slide 3 memakai `hero-slide-3-*`. Foto slide 1 di-preload (`fetchpriority` high); foto slide 2–3 memakai
  `data-src`/`data-srcset` dan baru dimuat JS setelah `load` (PageSpeed HP: LCP). Okt 2026: crop HP punya versi
  540/720/900w (`srcset` + `sizes="100vw"`, preload `imagesrcset`). Build menggabungkan `curtain-gate.js` + `loader-gate.js`
  jadi `js/home-gate.js` khusus index.html (satu request render-blocking; sumber tetap terpisah).
  Investigasi PageSpeed 96→74 (6 Okt 2026): Lighthouse lokal versi 1, 3, dan 6 Okt sama-sama 80 (tanpa animasi/loader pun 80),
  jadi bukan regresi kode; penurunan live = variasi PSI (Lighthouse 13.5, TTFB/cache Cloudflare). LCP live = logo loader;
  hambatan terbesar CSS Beranda ±169 KB render-blocking. Ukur ulang 3× dan ambil median sebelum menyimpulkan. Berkas sumber mentahnya tidak
  disimpan di folder aset publik.
- Foto yang tampil dengan `object-fit: cover` di bingkai yang lebih "kotak"
  dari fotonya butuh file lebih lebar dari bingkainya: atur `sizes` ke lebar
  foto yang benar-benar dirender (contoh foto Jejak di beranda:
  `relawan-anak-960/1440/1920`, `sizes` 890px). Selalu ekspor dari file asli.
  Foto kelas lama (`hero-relawan*.webp`) masih dipakai di halaman lain.
- Midtrans sandbox/production dipilih lewat `MIDTRANS_ENV`; payload QRIS mentah
  disimpan dan QR digambar sendiri (`js/vendor/qrcode-generator.min.js`).
  QR digambar **bulat** (Okt 2026, permintaan user: kotak polos kurang playful dibanding gambar QR Midtrans):
  titik bulat 0,9 modul warna `#2a0e13`, tiga "mata" pojok membulat maroon `#7a1f2b` (`qrSvgMarkup` di layar,
  `drawRoundedQr` di poster unduhan). Dicek ZXing: terbaca di ukuran penuh sampai ±160px. Jangan kecilkan titik/pudarkan warna.
- Jendela pembayaran/seat-hold diatur per kegiatan dari admin
  (`payment_window_minutes`, pilihan 5/10/15/30 menit, 1/3/24 jam; 5 menit ditambah Okt 2026 atas
  permintaan owner, migrasi `20261016010000`); lihat "Seat-hold rules" di `supabase/README.md`.
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
  hanya muncul untuk kegiatan mode Seleksi. Email otomatis ke pendaftar (Sep 2026):
  "Kamu resmi terdaftar" saat terkonfirmasi (gratis langsung / lunas via webhook, sekali
  per pendaftaran) dan "Pendaftaranmu udah masuk" untuk Seleksi; gaya kartu sama dengan
  email sertifikat. Diterima lewat seleksi dapat "Selamat, kamu lolos seleksi!" (sekali;
  cadangan/tidak lolos tetap lewat draf WA). Detail: "Registration
  emails" di `supabase/README.md`. Bukti follow Instagram hanya untuk event gratis +
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
  Kelola Admin punya tombol **Hapus** (Super Admin; `admin-users` PATCH `delete_admin`)
  hanya untuk admin yang sudah dinonaktifkan atau undangan yang belum pernah dipakai login,
  bukan akun sendiri; menghapus user Auth (baris `admin_users` ikut terhapus).
- Admin → Pendaftar (tahap 1 "ala Linear", tampilan tetap KB): toolbar satu baris
  (cari dengan jeda 300 ms, filter langsung berlaku, Reset hanya saat ada filter,
  total, **Ekspor Excel** untuk semua kegiatan; Okt 2026 dulu CSV polos: `.xlsx` dirakit di browser oleh `js/admin-xlsx.js`
  tanpa library (ZIP tanpa kompresi): pita judul maroon + nama kegiatan, header krem menempel + filter, baris selang-seling,
  Status/Hadir berwarna, WhatsApp sebagai teks supaya 0 di depan tidak hilang, tanggal WIB; kolom Kegiatan hanya saat semua kegiatan); satu header kolom lalu baris padat tanpa
  label berulang (Pendaftar · Kegiatan+kode · Status+bayar+riwayat · Terdaftar ·
  Detail); seluruh baris membuka Detail; status = titik warna + teks; ringkasan
  seleksi satu baris; command bar "N dipilih · Terima · Cadangan · Tolak" hanya
  saat ada yang dicentang; keputusan satuan tanpa `confirm()`. Tablet menyembunyikan
  kolom tanggal; HP baris bertumpuk. Respons pencarian lama diabaikan
  (`registrationLoadSeq`). Panel Detail (tahap 2): header menempel berisi ‹ n/N ›,
  nama, status (titik) + kode, dan tombol keputusan (khusus Seleksi); isi dikelompokkan
  Seleksi → Data pendaftar → Kegiatan & pembayaran; WA hasil di footer (tersembunyi
  bila belum ada hasil). Pintasan: ← → pindah, T/C/X = Terima/Cadangan/Tolak.
- Tampilan admin "playful" (Sep 2026, keputusan user): halaman pertama setelah login =
  **Beranda** (`#home-view`): sapaan WIB + nama panggilan (klik nama untuk ganti; disimpan
  di Supabase Auth `user_metadata.nickname` per admin; kalau kosong ditebak dari email),
  4 angka yang bisa diklik (pendaftar baru 24 jam, menunggu bayar, menunggu seleksi,
  kursi terisi), "Kegiatan terdekat" (maks. 3, countdown + bar kapasitas), dan
  "Perlu ditindaklanjuti" (tandai hadir selama belum ada yang ditandai, sertifikat H+3–30,
  belum tayang, pendaftaran tutup ≤3 hari, ≥80% penuh). Angka dihitung di browser dari
  `admin-registrations?lifecycle=active` (tanpa function baru), jadi kegiatan yang sudah
  selesai tidak menampilkan kapasitas. Kegiatan/Kisah jadi kartu membulat (radius 18px,
  bayangan hangat), tombol dan label status berbentuk pil, kata aksen `h1 em` Newsreader
  italic, skeleton saat memuat, dan pesan sukses jadi toast (kecuali di layar login dan
  hasil terbit sertifikat yang masih punya email gagal: tetap inline). Daftar Pendaftar
  tetap padat ala Linear. Tahap 3: form Kegiatan/Kisah = kartu bernomor 01–06, pil
  lompat jadi hijau ✓ saat isian wajib bagian itu valid, Mode dan Status jadi pil
  (`choicePills`; `<select>` tetap sumber data, disembunyikan), "Tampilkan di website"
  jadi saklar, penghitung judul (/80) + harga "Rp150.000/Gratis", tanda "Belum disimpan"
  + konfirmasi saat meninggalkan form, dan pratinjau kartu langsung di kanan hanya di
  layar ≥1240px. Bagian di tab Sertifikat dan Kelola Admin juga jadi kartu. Semua konfirmasi
  memakai dialog sendiri `confirmAction(pesan, {title, confirmLabel, danger, requireText})`
  (`<dialog>` native, Promise), bukan `window.confirm/prompt`; hapus permanen wajib
  mengetik judul. Hanya peringatan tutup tab/refresh (`beforeunload`) yang tetap bawaan browser.
  Semua `<select>` admin (selain yang jadi pil) memakai dropdown KB `enhanceSelect`: select
  asli disembunyikan tapi tetap sumber data (nilai, event `change`, `.value` dari kode tetap
  jalan; select yang dibuat belakangan ikut otomatis). Label Program Family di admin:
  Program Reguler / Program Unique / Program Gratis (kunci database tetap).
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
- Admin → Pendaftar punya tab "Pendaftar aktif" / "Riwayat" (`lifecycle` di
  `admin-registrations`). Aktif = kegiatan belum selesai (`end_at`, atau akhir
  hari kegiatan WIB) **dan** pembayaran belum kedaluwarsa; selain itu Riwayat
  (keputusan user Sep 2026, sebelumnya 30 hari setelah kegiatan). Tandai hadir
  tetap bisa dari Riwayat (ikut filter kegiatan, bukan tab).
- Status "Kedaluwarsa" di admin tidak disimpan di database: `admin-registrations`
  menurunkannya (`payment_expired`) dari `pending_payment` + `payment_deadline`
  yang sudah lewat, sama dengan aturan pelepasan kursi. "Lunas" selalu menang.

## Rencana fitur (belum dikerjakan)

Hosting & pembayaran (keputusan user, Sep 2026):
- Domain **kitabahagia.id** (dibeli di Jagoan Hosting, Sep 2026), tanpa www
  (www dialihkan ke apex lewat Redirect Rule Cloudflare). Hosting pindah ke
  **Cloudflare Pages** (Vercel Hobby tidak boleh komersial); Vercel (Okt 2026) tidak lagi
  menyajikan situs: `vercel.json` mengalihkan semua path (+ query) secara permanen ke `kitabahagia.id`
  supaya link lama tetap jalan; 1–2 bulan kemudian project Vercel, `vercel.json`, `middleware.js` dihapus
  (`.vercelignore` dipakai `build-pages.sh`, ganti nama dulu, jangan dibuang). File Pages: build `bash scripts/build-pages.sh`
  → `dist/` (menyalin semua kecuali isi `.vercelignore`, dotfile, file Vercel;
  jadi `_headers`/`_routes.json` jangan dimasukkan ke `.vercelignore`),
  `_headers` (header + CSP, samakan dengan `vercel.json` selama dua-duanya ada),
  build juga memecah CSS per halaman (`scripts/split-css.mjs`, Okt 2026, PageSpeed): tiap HTML dapat
  `css/style.<kelas-halaman>.css` = `style.css` tanpa aturan yang mustahil cocok (butuh kelas `*-page`/
  `home-document` yang tidak ada di halaman itu, atau kelas yang tidak muncul di HTML/JS publik mana pun;
  awalan dinamis `x-${...}` dianggap ada). Urutan aturan tidak berubah; dicek: computed style semua elemen
  identik di 16 halaman × 390/820/1366. Tetap edit **`css/style.css`** saja. Kelas yang dibuat JS dari
  data tanpa awalan literal harus tetap tertulis utuh di JS supaya tidak terbuang. 302 KB → 135–190 KB.
  build juga menempelkan `?v=<commit>` ke link JS/CSS lokal di semua HTML
  (Cloudflare membuat browser menyimpan JS/CSS 4 jam; tanpa ini HTML baru bisa
  memakai `admin.js` lama setelah deploy), `functions/_middleware.js` (preview bot, dibatasi `_routes.json` ke
  `/pendaftaran(.html)` supaya kuota Functions tidak habis). Pages mengalihkan
  `x.html` → `/x`, jadi canonical/og:url/sitemap memakai URL tanpa `.html`;
  link di dalam situs tetap `.html` (tetap jalan lewat redirect). Supabase Auth:
  Site URL + Redirect URLs `https://kitabahagia.id/admin/`. Link undangan/kirim ulang akses admin memakai secret
  Edge Function `ADMIN_SITE_ORIGIN` (`admin-users`), harus `https://kitabahagia.id` (dulu masih vercel.app, Okt 2026).
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
  Okt 2026: Duitku, Tripay, DOKU (personal = payment link saja) menolak akun perorangan untuk
  "penjualan tiket event" (minta PT/CV + NIB). **iPaymu** (akun Merchant atas nama owner, verifikasi
  dikirim 6 Okt) dipasang sebagai provider kedua: `PAYMENT_PROVIDER` (`midtrans` default / `ipaymu`),
  `IPAYMU_ENV`/`IPAYMU_VA`/`IPAYMU_API_KEY`, `_shared/ipaymu.ts`, `ipaymu-webhook` (status dibaca ulang dari
  API iPaymu, callback tidak dipercaya), migrasi `20261017010000`. iPaymu baru approve kalau web sudah
  terintegrasi + bisa tes transaksi (sandbox dulu) + domain di-whitelist. Sandbox (akun sandbox milik user) **sudah dites ujung ke ujung** 7 Okt 2026: QR tampil, tahan refresh, simulasi bayar lewat sandbox.ipaymu.com/send-notify → Lunas. Setelah owner di-approve: ganti 3 secret ke kunci production owner (`IPAYMU_ENV=production`). **Production iPaymu mewajibkan IP
  statis yang di-whitelist** (menu Integrasi, kolom "IP Website"); Edge Functions Supabase tidak punya IP keluar statis. 8 Okt 2026:
  verifikasi ditolak "integrasikan website" (tes reviewer masuk ke sandbox user, bukan akun owner); CS WA bilang pengecekan IP bisa
  dinonaktifkan lewat email support@ipaymu.com, owner sudah mengirim permohonan. Kalau ditolak: jembatan/proxy ber-IP statis (VPS)
  + alamat API iPaymu dari secret. Sementara `PAYMENT_PROVIDER=midtrans` (sandbox) selama review Midtrans. Teks FAQ/Ketentuan/Privasi
  menyebut "iPaymu atau Midtrans". Detail: "iPaymu" di `supabase/README.md`. Cadangan pasti jalan: QRIS
  statis owner + konfirmasi manual (belum dibangun). Opsi jangka panjang: PT Perorangan.


Web sengaja tidak ditambah fitur baru sampai pemicunya terjadi (roadmap:
4 kegiatan/bulan, tim ± 70 orang; 24 perancang program = 6 tim × 4 orang,
tim 1–3 dan 4–6 bergantian tiap bulan, + 1 kegiatan gratis akhir bulan).
**Ingatkan user soal sertifikat otomatis** kalau topiknya muncul atau user
bilang "lanjut fitur sertifikat".

Sertifikat relawan otomatis (disepakati konsepnya, belum dibangun):
- Tahap 1 **dibangun (Sep 2026)**: "Tandai hadir"/"Batal hadir" (bulk) di admin
  Pendaftar, checkbox muncul untuk semua mode saat 1 kegiatan dipilih; hanya
  pendaftar `confirmed`, mulai hari kegiatan (WIB), 1 kegiatan per aksi;
  `registrations.attended_at/attendance_marked_by`, RPC `mark_attendance`. Panel
  Detail pendaftar juga punya tombol "Tandai hadir"/"Batal hadir" (satu orang,
  aturan sama; nonaktif sebelum hari kegiatan). Detail:
  "Attendance" di `supabase/README.md`. Okt 2026: status ketiga **Tidak hadir** (`absent_at`,
  RPC `set_attendance` present/absent/clear): command bar "Tandai hadir · Tidak hadir · Kosongkan
  tanda", ringkasan Hadir · Tidak hadir · Belum ditandai, CSV Ya/Tidak, pengingat Beranda sampai
  semua terkonfirmasi ditandai. Sertifikat tetap hanya yang Hadir.
- Tahap 2 **dibangun (Sep 2026)**: admin → tab **Sertifikat** = daftar tanda
  tangan (tabel `certificate_signers`, bucket privat `certificate-signatures`,
  Edge Function `admin-certificates`). Foto tanda tangan/stempel diubah jadi PNG
  transparan di browser (canvas, tanpa blob URL karena CSP; coretan yang
  menyentuh tepi foto, garis lurus tipis panjang (kotak/garis tanda tangan
  tercetak), bayangan tipis, dan bintik kecil dibuang otomatis), pratinjau bergaya
  kolom tanda tangan, centang izin wajib, bisa dinonaktifkan; yang nonaktif bisa
  **dihapus** (konfirmasi; ditolak kalau masih dipilih di pengaturan kegiatan;
  PDF sertifikat yang sudah terbit tidak berubah).
  Detail: "Certificate signers" di `supabase/README.md`.
- Tahap 3 **dibangun (Sep 2026)**: di tab Sertifikat, "Pengaturan per kegiatan"
  (tabel `event_certificates`, bucket privat `certificate-assets`): nomor,
  Founder/PL/mitra dari daftar tanda tangan, logo mitra, ornamen Kelopak/Balok +
  4 warna atau PNG khusus, logo KB berwarna/putih (Balok otomatis putih),
  deskripsi lanjutan. Pratinjau langsung digambar `js/certificate.js` (canvas,
  dipakai lagi saat terbit) dengan nama contoh + peringatan (nomor/PL kosong,
  deskripsi kepanjangan).
- Tahap 4 **dibangun (Sep 2026)**: bagian "Terbitkan sertifikat" di tab
  Sertifikat (Edge Function `admin-certificate-issue`, tabel `certificates`,
  bucket privat `certificates`): daftar yang hadir, nama bisa diedit +
  "Rapikan huruf kapital", terbit mulai H+3 (keputusan user Sep 2026, dulu H+7) dan hanya jika nomor/Founder/PL
  lengkap dan form sudah disimpan. PDF digambar di browser admin
  (`KBCertificate.toPdf`, JPEG dalam PDF A4), email lewat Brevo API
  (`BREVO_API_KEY`; pengirim `CERTIFICATE_EMAIL_FROM`, disarankan `halo@`;
  gaya kartu playful dengan tombol, dipilih user setelah dicoba versi polos;
  subjek "<nama depan>, sertifikat relawanmu udah jadi!"; Okt 2026: PDF juga dilampirkan di email, permintaan user, link tetap ada untuk cek keaslian), email dalam satu kali terbit dikirim berjeda min. 8 detik (`EMAIL_GAP_MS` di `runIssue`; 12 email sekaligus pernah tertahan di status "Sent" Brevo ±1 jam sebelum akhirnya Delivered semua, Okt 2026: domain baru, tunggu dulu sebelum panik), per orang ada Lihat · Terbitkan ulang (kode/link tetap) ·
  Kirim ulang email · WA. Halaman publik `sertifikat.html?k=` (noindex) +
  function `public-certificate`. Belum: link sertifikat di Cek status,
  pengumuman grup WA (manual), font Garet. Detail: "Issuing certificates" di
  `supabase/README.md`.
- **Template dari Canva (dibangun Sep 2026, keputusan user)**: di samping
  template sistem (tetap default, tidak diubah), admin bisa memilih "Template dari
  Canva" per kegiatan: tim Desain export sertifikat lengkap (ornamen, logo, nomor,
  deskripsi, tanda tangan + stempel) dengan nama dan QR dikosongkan, admin unggah
  (jadi JPEG 2000×1414), geser kotak Nama/QR di pratinjau, atur warna/perataan/
  ukuran nama, ukuran QR, dan teks di bawah QR. Nomor tetap diketik (dipakai halaman
  cek keaslian). Integrasi langsung ke Canva API sengaja tidak dibuat (Autofill butuh
  Canva Enterprise; export+upload cukup sekali per kegiatan). Ada "Unduh contoh PDF"
  di pratinjau (dua mode). Detail: "Certificate template from Canva" di
  `supabase/README.md`.
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
  bulan juga dapat; terbit **H+3** (tim pelaksana lapor absen paling lambat H+2); "Tandai hadir" dan "Terbitkan" hanya oleh
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

Dokumentasi kegiatan (usulan tim dokum, disepakati user Sep 2026, **dibangun Sep 2026**
sebelum kegiatan Oktober; migrasi `20261013010000`, `events.documentation_url` +
`documentation_photos` jsonb maks. 5 `{url, alt}` dari bucket `event-images`; renderer
`renderEventGallery` di `js/script.js`; kegiatan selesai dianggap "past" walau penuh/ditutup): foto asli tetap di Google Drive (folder
"siapa saja yang punya link: Pelihat", isinya sudah dikurasi). Form Kegiatan dapat bagian
"Dokumentasi": link folder Drive + maks. **5 foto pilihan** (dikompres di browser seperti
foto Kisah; tidak mengambil gambar langsung dari Drive). Tampil publik (siapa saja, bukan
hanya peserta) di halaman kegiatan yang sudah selesai (`pendaftaran?event=`): slide foto +
"Lihat semua foto di Drive ↗"; Kisah dengan "Kegiatan terkait" menampilkan galeri yang
sama otomatis (satu sumber data). Tampil sebagai **jurnal tempel** (Okt 2026; versi pita film + negatif ditolak user: kaku, dan wajah anak dibalik warnanya seram): cetakan foto berbingkai krem, selotip kertas maroon, miring ±1,6°; foto tengah (`.is-developed`) lurus + terangkat, lainnya agak pudar; keterangan Newsreader miring; tap foto tengah = `<dialog>` perbesar, foto lain = digeser ke tengah; panah keyboard. Link Drive ikut di email sertifikat. Tanpa foto/link =
bagian disembunyikan. Foto anak: pilih yang aman/berizin (aturan tim dokum, bukan sistem).

Dashboard dampak publik (setelah ± 6 laporan bulanan konsisten): angka total
kegiatan, relawan hadir unik, jam relawan (durasi × hadir), penerima manfaat,
lokasi, mitra, relawan yang ikut lagi; grafik per bulan. Sebagian otomatis dari
data hadir, sebagian dari bagian "Laporan dampak" di form kegiatan. Publik hanya
melihat agregat, tanpa data pribadi. Keputusan user: data kegiatan sebelum web
(sejak 2024) **tidak** diimpor per kegiatan (tidak tercatat). Dashboard berisi
angka rinci mulai Oktober 2026, ditambah satu kalimat sejarah yang bisa diedit
(mis. "Sejak 2024, Kita Bahagia telah mengadakan lebih dari 20 kegiatan di 8
kota"; angka disepakati owner, dibulatkan ke bawah).

Backup database (Sep 2026, gratis, pengganti Supabase Pro): GitHub Actions
`.github/workflows/db-backup.yml` tiap Senin 02.00 WIB, `pg_dump` schema public+auth,
dienkripsi GPG, artifact 90 hari; secret `SUPABASE_DB_URL` (Session pooler) + `BACKUP_PASSPHRASE`.
Storage tidak ikut. Supabase dijaga tetap aktif oleh monitor UptimeRobot ke `public-events`.

## Keamanan

`SUPABASE_SERVICE_ROLE_KEY` hanya di server. Jangan pernah taruh di kode
browser, log, atau commit.

CSP di `_headers` (Cloudflare) dan `vercel.json` (cadangan) sudah **enforce** (bukan Report-Only). Cloudflare Web Analytics
(beacon tanpa cookie, disebut di Privasi) diizinkan: `static.cloudflareinsights.com` di
`script-src`, `cloudflareinsights.com` di `connect-src`. Artinya: tidak ada
`<script>`/`<style>` inline, atribut `style="..."`, handler `on*=`, atau gambar
`data:`/`blob:` di HTML/CSS. Host luar baru (font, gambar, API, iframe) harus
ditambahkan ke CSP dulu. Cek dengan memuat halaman ber-header CSP di Playwright
dan cari pesan "Refused to" di console.
Bucket `instagram-proofs` tetap privat dan tidak punya policy Storage untuk
browser; jangan membuka akses anon atau menyimpan signed/public URL di database.
