# DailyStreaks (Simple, Fast, Auto-Update)

DailyStreaks adalah sistem ringan untuk menghasilkan kartu **GitHub commit streak** (SVG) yang bisa dipasang langsung di profile README.

## Fitur Utama
- Sederhana: hanya 1 script Python standar library (tanpa dependency eksternal).
- Efisien: ambil data event publik GitHub API dan hitung streak dari `PushEvent`.
- Aman untuk GitHub Actions: pagination di-clamp otomatis agar tidak kena error API 422.
- Otomatis: GitHub Actions jalan tiap jam + bisa manual (`workflow_dispatch`).
- Mudah dikustomisasi: username & timezone disimpan di repository variables.
- Struktur rapi: direktori jelas, file secukupnya, mudah di-maintain.

## Struktur Proyek

```text
.
├── .github/workflows/update-streaks.yml   # Workflow auto update SVG
├── assets/github-streak.svg               # Output kartu streak untuk ditampilkan
├── examples/sample_events.json            # Contoh fixture local test
└── src/dailystreaks.py                    # Engine hitung streak + render SVG
```

## Cara Pakai Cepat

### 1) Konfigurasi repository variable
Di repo ini, buka **Settings → Secrets and variables → Actions → Variables**:
- `STREAK_USERNAME`: username GitHub yang ingin dihitung.
- `STREAK_TIMEZONE_OFFSET`: offset UTC jam (contoh `7` untuk WIB). Opsional.

> Workflow menggunakan `secrets.GITHUB_TOKEN` bawaan Actions untuk rate-limit lebih baik.

### 2) Jalankan workflow
- Buka tab **Actions**.
- Jalankan workflow `Update Daily Streak Card` secara manual sekali.
- Setelah itu akan auto update tiap jam.

### 3) Pasang di profile README GitHub
Tambahkan ini di profile README (`<username>/<username>` repo):

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/DailyStreaks/work/assets/github-streak.svg)
```

> Jika default branch Anda bukan `work`, ganti segment branch di URL sesuai branch default.

## Jalankan Lokal

```bash
python3 src/dailystreaks.py \
  --username futurisme \
  --timezone-offset 7 \
  --output assets/github-streak.svg
```

Mode offline (pakai fixture):

```bash
python3 src/dailystreaks.py \
  --username demo \
  --events-file examples/sample_events.json \
  --output assets/github-streak.svg
```

## Catatan Desain
- Perhitungan streak berbasis **hari yang memiliki commit** dari `PushEvent`.
- `Current streak` aktif jika hari kontribusi terakhir adalah hari ini atau kemarin.
- Jika tidak ada kontribusi > 1 hari, current streak menjadi `0`.
- `Longest streak` dihitung dari rentang hari commit beruntun terpanjang.

## Rencana Ekspansi (opsional)
- Tema warna (light/dark/custom).
- Filter repository tertentu.
- Badges tambahan (best day, weekly streak, dsb).

