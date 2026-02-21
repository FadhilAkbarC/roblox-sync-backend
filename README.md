# DailyStreaks (Simple, Fast, Auto-Update)

DailyStreaks adalah sistem ringan untuk menghasilkan kartu **GitHub commit streak** (SVG) dari commit logs (`PushEvent`) dan menampilkannya di profile README.

## Kenapa URL `.../work/assets/github-streak.svg` bisa gagal?
Kasus paling umum:
1. File terbaru dipush ke branch `main`, tapi URL masih menunjuk branch `work`.
2. Branch `work` tidak punya file `assets/github-streak.svg` versi terbaru.
3. Workflow berjalan di `main`, jadi output terus diperbarui di `main`, bukan di branch lain.

✅ **URL yang benar (direkomendasikan):**

```text
https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg
```

> Jika Anda memang ingin pakai branch lain, ganti `main` sesuai branch target dan pastikan workflow/commit juga ke branch itu.

---

## Fitur Utama
- Sederhana: 1 script Python (stdlib-only, tanpa dependency eksternal).
- Efisien: pagination aman, stop dini berbasis `lookback_days`, tanpa loop berlebih.
- Stabil: aman dari error pagination GitHub (`HTTP 422`).
- Cepat update: scheduler tiap 15 menit + manual trigger + trigger push `main`.
- Mudah dikustomisasi: semua parameter penting lewat repo variables.

## Struktur Proyek

```text
.
├── .github/workflows/update-streaks.yml   # Workflow auto update SVG
├── assets/github-streak.svg               # Output kartu streak
├── examples/sample_events.json            # Fixture local test
└── src/dailystreaks.py                    # Engine hitung streak + render SVG
```

---

## Setup Lengkap (Detail)

### 1) Repo Variables (wajib & opsional)
Buka: **Settings → Secrets and variables → Actions → Variables**

Isi berikut:
- `STREAK_USERNAME` (**wajib**): username GitHub target.
  - Contoh: `futurisme`
- `STREAK_TIMEZONE_OFFSET` (opsional, default `0`): offset UTC jam.
  - Contoh: `7` untuk WIB
- `STREAK_MAX_PAGES` (opsional, default `5`): jumlah page API (otomatis dibatasi `1..10`).
- `STREAK_LOOKBACK_DAYS` (opsional, default `120`): jendela histori hari untuk efisiensi.

### 2) Repo Secrets
Buka: **Settings → Secrets and variables → Actions → Secrets**

Untuk setup default, **tidak perlu membuat secret tambahan**.
Workflow sudah memakai `secrets.GITHUB_TOKEN` bawaan GitHub Actions secara otomatis.

Opsional (kalau mau custom token sendiri):
- `GH_PAT` (fine-grained token, minimal read public data).
- Namun untuk kasus ini biasanya tidak diperlukan.

### 3) Permissions Workflow
Di repo: **Settings → Actions → General → Workflow permissions**
- Pilih **Read and write permissions**

Ini penting agar step commit SVG bisa push hasil update otomatis.

### 4) Jalankan Workflow Pertama Kali
- Buka tab **Actions**
- Pilih workflow: `Update Daily Streak Card`
- Klik **Run workflow**
- Setelah sukses, file `assets/github-streak.svg` akan ter-update.

### 5) Pasang di Profile README
Tambahkan ke repo profile (`<username>/<username>`):

```md
![DailyStreaks](https://raw.githubusercontent.com/futurisme/DailyStreaks/main/assets/github-streak.svg)
```

---

## Troubleshooting

### A. Gambar tidak muncul / 404
- Pastikan URL branch benar (`main`, bukan `work` jika file update ada di `main`).
- Cek langsung URL raw di browser.
- Pastikan file `assets/github-streak.svg` memang ada di branch tersebut.

### B. Angka streak belum berubah setelah commit baru
- GitHub Events punya delay singkat sebelum event terlihat.
- Tunggu run scheduler berikutnya (maks 15 menit), atau jalankan manual workflow.

### C. Workflow gagal commit
- Pastikan Workflow permissions = **Read and write**.
- Pastikan tidak ada branch protection yang memblokir push dari `github-actions[bot]`.

### D. Hari ini belum commit
- Ini normal: jika kontribusi terakhir > 1 hari, `current streak` akan jadi `0`.
- Begitu commit baru terdeteksi, kartu update otomatis pada run berikutnya.

---

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
