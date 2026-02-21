# DailyStreaks (Simple, Fast, Auto-Update)

DailyStreaks adalah sistem ringan untuk menghasilkan kartu **GitHub streak** (SVG) dan memasangnya di profile README.

## Update Utama (Agar Tidak Mulai dari 0)
Sekarang streak **tidak mulai dari nol** untuk akun lama:
- Sistem mengambil baseline histori kontribusi sejak **tanggal profile dibuat** (account `created_at`) via GitHub GraphQL contribution calendar.
- Lalu baseline itu di-overlay dengan **push event terbaru** supaya update hari ini lebih cepat terdeteksi.
- Hasilnya: histori lama kebaca, dan commit/push baru bisa masuk tampilan lebih cepat.

## Kenapa URL `.../work/assets/github-streak.svg` bisa gagal?
Penyebab umum:
1. Workflow update berjalan di `main`, tapi URL menunjuk `work`.
2. Branch URL tidak berisi file SVG terbaru.

Gunakan URL canonical ini:

```text
https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg
```

Jika ingin pakai `work`, pastikan branch `work` juga menerima update workflow/commit.

---

## Fitur Utama
- Ringan: 1 script Python stdlib-only.
- Canggih tapi efisien:
  - histori kontribusi dari profile creation date,
  - fetch recent push events untuk percepat deteksi hari ini,
  - pagination aman (`1..10`) + graceful 422 handling.
- Auto update cepat:
  - schedule tiap 5 menit,
  - manual trigger,
  - trigger saat ada push ke `main`/`work`.
- Commit hanya saat SVG berubah (hemat CI run & rapi).

## Struktur Proyek

```text
.
├── .github/workflows/update-streaks.yml
├── assets/github-streak.svg
├── examples/sample_events.json
└── src/dailystreaks.py
```

---

## Setup Detail (Variables + Secrets)

### 1) Variables
Settings → Secrets and variables → Actions → **Variables**

Wajib:
- `STREAK_USERNAME` → username GitHub target (contoh: `futurisme`)

Opsional:
- `STREAK_TIMEZONE_OFFSET` (default `0`) → contoh `7` (WIB)
- `STREAK_MAX_PAGES` (default `5`, dibatasi `1..10`)
- `STREAK_LOOKBACK_DAYS` (default `45`) untuk push-event lookback cepat

### 2) Secrets
Settings → Secrets and variables → Actions → **Secrets**

Untuk mode default, Anda **tidak wajib** membuat secret tambahan.
Workflow memakai `secrets.GITHUB_TOKEN` bawaan GitHub Actions.

Opsional (hanya jika perlu token custom):
- `GH_PAT` (fine-grained PAT)

### 3) Workflow Permission (WAJIB)
Settings → Actions → General → Workflow permissions:
- Pilih **Read and write permissions**

Agar `github-actions[bot]` bisa commit `assets/github-streak.svg`.

### 4) Jalankan Pertama Kali
- Buka tab Actions
- Pilih `Update Daily Streak Card`
- Klik `Run workflow`

### 5) Pasang di Profile README
Tambahkan:

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg)
```

---

## Catatan Perilaku Streak
- `Current streak` aktif jika kontribusi terakhir ada di hari ini/kemarin.
- Jika hari ini belum ada kontribusi dan terakhir > 1 hari lalu, current streak jadi `0`.
- Jika baru push/commit dan belum muncul di contribution calendar, overlay recent push event membantu percepatan update.

## Jalankan Lokal
Online mode:

```bash
python3 src/dailystreaks.py \
  --username futurisme \
  --timezone-offset 7 \
  --max-pages 5 \
  --lookback-days 45 \
  --output assets/github-streak.svg
```

Offline mode (fixture):

```bash
python3 src/dailystreaks.py \
  --username demo \
  --events-file examples/sample_events.json \
  --output assets/github-streak.svg
```
