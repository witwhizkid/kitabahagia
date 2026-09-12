# Kita Bahagia — Multi-page Website

Website komunitas sosial Kita Bahagia dengan halaman terpisah untuk setiap menu utama.

## Struktur

- `index.html` — Beranda
- `tentang.html` — Tentang Kami
- `program.html` — Program & Kegiatan
- `jadwal.html` — Jadwal Kegiatan dan filter kategori
- `relawan.html` — Gabung Jadi Relawan
- `kolaborasi.html` — Kolaborasi
- `kontak.html` — Kontak
- `galeri.html` — ga ada isinya ini udeh
- `css/style.css` — seluruh styling
- `js/script.js` — interaksi dan konfigurasi kontak
- `img/` — foto dokumentasi serta hero versi WebP

## Bagian yang paling sering diedit

1. Kontak dan sosial media: edit `SITE_CONFIG` di `js/script.js`.
2. Agenda: edit kartu kegiatan di `jadwal.html`, termasuk kategori, tanggal, kuota, dan `data-event-name`.
3. Foto hero: gunakan berkas `hero-*.webp`; JPG/JPEG sumber tetap disimpan sebagai cadangan.

## Menjalankan

Buka folder ini di VS Code lalu gunakan Live Server. Tidak membutuhkan backend.
