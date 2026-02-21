# DailyStreaks (Simple, Fast, Auto-Update)

DailyStreaks adalah sistem ringan untuk menghasilkan kartu **GitHub commit streak** (SVG) yang bisa dipasang langsung di profile README.

## Fitur Utama
- Sederhana: 1 script Python (stdlib-only, tanpa dependency eksternal).
- Efisien: ambil event commit (`PushEvent`) dengan pagination aman + stop dini berbasis `lookback`.
- Stabil: aman dari error pagination GitHub (`HTTP 422`), sehingga workflow tidak mudah gagal.
- Cepat update: auto-run tiap 15 menit, manual trigger, dan trigger saat ada push ke branch `main` repo ini.
- Mudah dikustomisasi: username, timezone, page-limit, dan lookback-days dari repository variables.

## Struktur Proyek

```text
.
├── .github/workflows/update-streaks.yml   # Workflow auto update SVG
├── assets/github-streak.svg               # Output kartu streak untuk ditampilkan
├── examples/sample_events.json            # Contoh fixture local test
└── src/dailystreaks.py                    # Engine hitung streak + render SVG
```

## Konfigurasi Repository Variables
Buka **Settings → Secrets and variables → Actions → Variables**:
- `STREAK_USERNAME` (wajib): username GitHub target.
- `STREAK_TIMEZONE_OFFSET` (opsional, default `0`): offset UTC jam (contoh `7` untuk WIB).
- `STREAK_MAX_PAGES` (opsional, default `5`): jumlah halaman API, otomatis dibatasi ke `1..10`.
- `STREAK_LOOKBACK_DAYS` (opsional, default `120`): jendela hari untuk early-stop agar lebih efisien.

> Workflow memakai `secrets.GITHUB_TOKEN` bawaan Actions.

## Cara Pasang di Profile README GitHub
Tambahkan markdown berikut ke repo profile `<username>/<username>` Anda:

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg)
```

## Jalankan Lokal
Online mode:

```bash
python3 src/dailystreaks.py \
  --username futurisme \
  --timezone-offset 7 \
  --max-pages 5 \
  --lookback-days 120 \
  --output assets/github-streak.svg
```

Offline mode (fixture):

```bash
python3 src/dailystreaks.py \
  --username demo \
  --events-file examples/sample_events.json \
  --output assets/github-streak.svg
```

## Catatan Perilaku Streak
- Perhitungan berdasarkan hari yang punya commit dari `PushEvent`.
- `Current streak` aktif jika kontribusi terakhir ada di hari ini/kemarin.
- Jika hari ini belum commit dan terakhir > 1 hari lalu, current streak = `0`.
- Saat commit baru muncul di event feed GitHub, kartu akan ikut ter-update pada run berikutnya (maks. 15 menit, atau langsung saat push ke repo ini).
