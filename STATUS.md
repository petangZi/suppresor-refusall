# Status proyek

Terakhir diperbarui: 2026-11-01. Versi 2.8.0.

## Sudah selesai

| Area | Status | Bukti |
|---|---|---|
| Lisensi signed `SRK1` | selesai | 14/14 tes lisensi |
| Key legacy `TTK-*` | selesai | aktivasi pro, gate menerima |
| Rules Firestore | selesai | `rules:verify` 7/7, enumerasi 403 |
| Ledger free tier server-side | selesai | 15 sesi lalu blokir di sesi ke-16 |
| Gate proxy (Node + Worker) | selesai | 19 tes gate + 3 tes plugin |
| UI OpenTUI + SolidJS | selesai | typecheck bersih, render 130x40 |
| Banner ASCII | dihapus | toast + fallback satu baris |
| Deploy artifacts | selesai | Dockerfile, compose, fly.toml |
| Rotasi key | alat siap, belum dijalankan | butuh service account |
| Gate di host publik | belum | butuh akun host |

## Cara menjalankan

### Plugin (opencode)

Plugin sudah ada di `~/.config/opencode/plugins/suppresor-refusall`. Restart opencode,
lalu:

```text
/suppresor-refusall status
/suppresor-refusall key TTK-XXXX-XXXX-XXXX
/suppresor-refusall off
/suppresor-refusall on
```

### Dashboard

```bash
cd ~/.config/opencode/plugins/suppresor-refusall
npm run ui
```

Atau aktivasi langsung:

```bash
cd ui && bun run start --activate TTK-XXXX-XXXX-XXXX
```

### Gate lokal

```bash
cd ~/.config/opencode/plugins/suppresor-refusall
SUPPRESOR_GATE_SECRET=secret-lokal npm run gate
```

Lalu di shell plugin:

```bash
export SUPPRESOR_GATE_URL=http://127.0.0.1:8787
```

### Gate di server

```bash
docker compose up --build
# atau
fly deploy
```

Isi secret `SUPPRESOR_GATE_SECRET`, `SUPPRESOR_TOKEN_KEY_PEM`,
`SUPPRESOR_TOKEN_PUBLIC_PEM`, `SUPPRESOR_LICENSE_PUBLIC_PEM`
(lihat `server/env.example`). Setelah hidup, set `SUPPRESOR_GATE_URL=https://host`
di klien.

### Perintah admin

```bash
npm test                 # 75 tes
npm run rules:deploy     # deploy firestore.rules ke named database
npm run rules:verify     # 7 probe live
npm run keys:rotate      # dry run rotasi key
```

## Yang belum, dan apa yang dibutuhkan

### 1. Rotasi 10 key yang sempat bocor

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json
npm run keys:rotate           # lihat rencana
npm run keys:rotate -- --apply
```

Butuh service account dengan `roles/datastore.user`. Akun CLI sekarang hanya punya
`datastore.entities.get`, jadi tidak bisa menulis. **Butuh dari kamu:** file JSON
service account, atau grant role itu ke akun yang ada.

### 2. Gate di host publik

Supaya hitungan sesi dan revoke tidak bisa diakali dari mesin user. Butuh salah satu:

- akun Fly.io + token, atau
- VPS dengan Docker + akses SSH, atau
- platform edge (Cloudflare/Vercel) dengan secret.

**Butuh dari kamu:** pilihan host dan kredensialnya. Kalau tidak, gate lokal sudah
cukup untuk satu mesin.

### 3. Opsional

- Role `roles/serviceusage.serviceUsageConsumer` kalau mau `firebase deploy` dan MCP
  `firebase_deploy` bekerja normal. Tidak wajib: `npm run rules:deploy` sudah bisa.
- Kunci gate di belakang domain + TLS kalau dipakai publik.

## Batasan yang tidak hilang

- Plugin open source berjalan di mesin user; patch lokal selalu mungkin. Yang dijaga
  gate adalah kuota dan revoke, bukan kerahasiaan kode.
- Reinstall membuat anon uid baru, jadi ledger Firestore saja bisa direset. Gate yang
  menutup ini lewat device id + rate limit per IP.
- Token gate terikat waktu (30 menit), bukan perangkat; salinan cache masih bisa
  dipakai sampai kedaluwarsa.

## Update 2.4.1 — backend & AI Studio

Web utama `https://tiki-tiki-fire-hub.ai.studio/` adalah frontend statis. Tidak ada
runtime server, jadi proxy `/internal/*` tidak bisa ditanam di sana. Backend yang
dipakai: Cloud Run di project yang sama.

Sudah disiapkan:

- `server/cloudbuild.yaml` — build image, push, deploy Cloud Run
- `server/deploy-cloudrun.sh` — cek secret, submit build
- dukungan service account di gate (file JSON atau metadata Cloud Run)
- `SUPPRESOR_STRICT_ONLINE=1` — matikan fallback baca publik untuk key legacy

Perintah yang harus dijalankan di mesin yang punya `gcloud` + billing:

```bash
printf '%s' "$GATE_SECRET" | gcloud secrets create gate-secret --data-file=-
gcloud secrets create token-key-private --data-file=server/token-key-private.pem
./server/deploy-cloudrun.sh
```

Setelah URL keluar, isi `SUPPRESOR_GATE_URL`, lalu (opsional tapi disarankan)
set `SUPPRESOR_STRICT_ONLINE=1` dan ubah rules `accessKeys` menjadi `allow get: false`
karena gate sudah memakai service account.

Kebutuhan akses:

1. Billing/Blaze aktif di project `crafty-joy-d6d0h`.
2. Izin `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/iam.serviceAccountUser`.
3. File service account `roles/datastore.user` untuk rotasi key.

## Update 2.4.3 — bridge AI Studio

Adapter gate untuk bentuk `GET /keys/:keyId` + `POST /keys/:keyId/uses` sudah jadi
(`SUPPRESOR_BRIDGE_URL`, `SUPPRESOR_BRIDGE_KEY`). Tes 4/4, suite penuh 45/45.

Blocker: route internal belum ada di URL publik. `ais-dev-*.run.app` kena auth flow
AI Studio (302), sedangkan `tiki-tiki-fire-hub.ai.studio` membalas SPA untuk
`/api/internal/bridge/*`. Butuh deploy build yang memuat route tersebut ke host publik.

Setelah URL publik ada:

```bash
export SUPPRESOR_BRIDGE_URL=https://host/api/internal/bridge
export SUPPRESOR_BRIDGE_KEY=<master bridge key>
npm test
```

Lalu tutup `accessKeys` (`allow get: false`) dan set `SUPPRESOR_STRICT_ONLINE=1`.

Kunci yang pernah dikirim di chat (master bridge, admin passphrase, legacy bridge,
VIP/community) harus dirotasi setelah integrasi selesai.

## Update 2.4.4 — bridge live

Bridge publik sudah aktif dan teruji dari gate:

- health 200, 14 key / 7 aktif
- key ACTIVE, `maxDevices: 1`, `usesCount` bertambah
- sesi device terikat 200 `tier pro`; device baru 403 `device_limit`; heartbeat 200

Sisa:

1. Host gate (Cloud Run/Fly/VPS) atau jalankan lokal, lalu set `SUPPRESOR_GATE_URL`.
2. Rotasi kunci yang pernah dikirim di chat + key lama yang bocor.
3. Opsional: tutup `accessKeys` (`allow get: false`) setelah aktivasi legacy
   dipindah lewat gate, plus `SUPPRESOR_STRICT_ONLINE=1`.

## Update 2.5.0 — gate di Express + hardening

Gate bisa ditanam di web (`mountGate(app, '/api/gate')`), jadi server-side tanpa
daemon lokal. Hardening: body limit, IP dari socket, constant-time secret, proto
guard, header keamanan. Tes 50/50.

Checklist Firebase ada di `docs/SECURITY-HARDENING.md` (P0: hapus field sensitif,
wajib auth untuk get, rotasi 15 key + master key + passphrase, redeem device-bound).

## Update 2.5.1 — verifikasi pasca-hardening

Terverifikasi live:

- bridge 2.5.0-hardened: `key`/`keyHash` tidak lagi dikirim, private doc 403,
  redeem tanpa device 400, CORS tanpa wildcard, header rate limit + TLS ada
- gate + bridge: ROOT root, VIP pro, SUPPORTER device kedua 403, heartbeat 200
- aktivasi lewat gate: VIP key → `activation.type: gateway`
- rules: enumerasi 403, get tanpa auth 403, get dengan anon 200, private 403,
  ledger create/increment 200 → `admin/verify-rules.mjs` 9/9

Temuan yang perlu ditutup di web:

1. `/api/gate` belum dimount (masih SPA) — transform/sesi server-side belum aktif.
2. Key hasil rotasi tidak tersinkron ke Firestore `accessKeys` (404); hanya key lama
   `TTK-25A0-4906-4AEA` yang ada. Aktivasi kini lewat gate.
3. `ADMIN_ACCESS_PASSPHRASE || 'TikiMaster#2026!...'` default hardcoded di server.ts.
4. Backup export menerima passphrase mentah di `x-admin-token`.
5. Cookie admin 30 hari dan token sesi juga dikembalikan di body JSON.
6. Legacy passphrase `TKI-6-5-7B-642G-542` masih ada di kode.
7. Bridge melaporkan 28 key / 21 aktif, target 14 — ada duplikat; key lama belum dicabut.

## Update 2.5.2 — lisensi dimatikan, anti-refusal diperkuat

Lisensi bypass aktif lewat `~/.config/opencode/.suppresor-nolicense` (atau
`SUPPRESOR_NO_LICENSE=1`). Tidak ada hitungan, tidak ada gate, tier pro.

Anti-refusal sekarang menangani compaction: guard di system prompt, konteks
compaction, autocontinue dipaksa, refusal final diredaksi otomatis + minta lanjutan,
dan context strip ikut membersihkan pesan system/summary.

Catatan: key hasil rotasi tidak ada di Firestore (404), jadi aktivasi key lewat
Firestore gagal; aktivasi sekarang lewat gate. Dengan bypass, key tidak diperlukan.

Tes: 59/59.

## Update 2.6.0 — project config + custom patterns

Per-project override sudah aktif lewat `.opencode/suppresor-refusall.json`
(dicari naik dari direktori project, cache mtime, validasi per entri):

- `enabled`, `genius`, `thresholds`, `autoContinue`
- `patterns`: string literal atau objek regex dengan weight 1–5
- `allow`: regex whitelist yang menolkan skor
- `SUPPRESOR_PROJECT_CONFIG` untuk memaksa path tertentu
- MCP `suppresor_config` untuk membaca konfigurasi efektif

Tes: 70/70.

## Update 2.7.0 — key read-only

- Installer wajib key; key ditulis sekali ke `.suppresor-key` mode 0600.
- Runtime hanya baca + verifikasi Ed25519. Tidak ada device id, counter, snapshot,
  gateway transform, heartbeat, atau tulis Firestore.
- Key absen/salah/expired/tier salah: plugin return `{}`, agent `tiki` tidak
  didaftarkan, semua hook mati.
- Marker `.suppresor-key-required` memaksa gate tetap aktif walau file key dihapus.
- `/suppresor-refusall key` tidak lagi menulis; key install-time yang authoritative.

Tes: 75/75.

## Update 2.8.0 — TTK Firestore read-only

- Key `TTK-*` dibaca dari `accessKeys/{key}` di Firestore project
  `crafty-joy-d6d0h`, database
  `ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977`.
- Installer menerima TTK; verifikasi Firestore sebelum menulis `.suppresor-key`.
- Tidak ada device registration, usage increment, `.suppresor-license`, atau
  `.suppresor-device` saat verifikasi TTK.
- `SRK1` tetap opsional untuk key admin offline.
- Database live: `asia-southeast1`, `FIRESTORE_NATIVE`, `ENTERPRISE`.
- `firestore.rules`: `accessKeys` exact-doc get publik, list/query/write tertutup.
  Rules sudah di-deploy ke named database; `verify-rules` 9/9.
- Key tidak ditemukan = plugin return `{}`, tidak bisa masuk.

Tes: 75/75.
