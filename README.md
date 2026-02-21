# DailyStreaks

DailyStreaks adalah generator kartu streak GitHub (SVG) yang ringan, rapi, dan otomatis update untuk dipasang di profile README.

## Apa yang sudah diperbaiki
- **Current streak dihitung dari histori penuh akun** (mulai dari tanggal profile dibuat), jadi tidak “reset dari 0” untuk akun lama.
- Jika kontribusi harian tersambung tanpa putus sampai hari ini/terakhir, maka itulah nilai current streak (contoh 48 hari => tampil 48).
- Data histori dibaca dari contribution calendar (GraphQL), lalu di-overlay dengan push event terbaru agar update hari ini lebih cepat terdeteksi.
- Tampilan SVG dibuat lebih adaptif untuk container GitHub (mobile/desktop) dengan `viewBox` + `max-width` responsif.

## URL gambar yang disarankan
Gunakan branch yang benar-benar menerima update workflow.

```text
https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg
```

Jika ingin pakai `work`, pastikan branch `work` juga dipush dan workflow aktif di branch itu.

---

## Struktur direktori
```text
.
├── .github/workflows/update-streaks.yml
├── assets/github-streak.svg
├── examples/sample_events.json
└── src/dailystreaks.py
```

Struktur ini sudah dijaga tetap kecil supaya sustainable dan mudah dikembangkan.

---

## Setup (step-by-step)

### 1) Variables
Buka: **Settings → Secrets and variables → Actions → Variables**

Wajib:
- `STREAK_USERNAME` = username GitHub target (contoh `futurisme`)

Opsional:
- `STREAK_TIMEZONE_OFFSET` (default `0`) — contoh `7` untuk WIB
- `STREAK_MAX_PAGES` (default `5`, dibatasi `1..10`)
- `STREAK_LOOKBACK_DAYS` (default `45`) untuk percepat deteksi push terbaru

### 2) Secrets
Buka: **Settings → Secrets and variables → Actions → Secrets**

Default-nya tidak perlu secret tambahan karena workflow memakai `secrets.GITHUB_TOKEN` bawaan Actions.

### 3) Permissions workflow
Buka: **Settings → Actions → General → Workflow permissions**
- pilih **Read and write permissions**

Ini penting agar bot Actions bisa commit perubahan `assets/github-streak.svg`.

### 4) Jalankan workflow pertama
- Buka tab **Actions**
- Pilih **Update Daily Streak Card**
- Klik **Run workflow**

### 5) Pasang ke profile README
Di repo profile (`<username>/<username>`), tambahkan:

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg)
```

---

## Cara kerja singkat
1. Ambil tanggal profile dibuat (`created_at`).
2. Ambil contribution calendar dari tanggal itu sampai hari ini (per chunk tahunan).
3. Ambil push event terbaru (REST) untuk percepat update hari ini.
4. Merge aman (`max`) lalu hitung `current streak` + `longest streak`.

---

## Jalankan lokal
Online:

```bash
python3 src/dailystreaks.py \
  --username futurisme \
  --timezone-offset 7 \
  --max-pages 5 \
  --lookback-days 45 \
  --output assets/github-streak.svg
```

Offline (fixture):

```bash
python3 src/dailystreaks.py \
  --username demo \
  --events-file examples/sample_events.json \
  --output assets/github-streak.svg
```
