# Gate API contract

Kontrak ini dipakai kalau gate tidak membaca Firestore langsung, tapi lewat API
utama (proxy/internal endpoint) milik web kamu. Semua panggilan server-ke-server:
tidak untuk browser, tidak ada CORS, tidak ada service account di klien.

## Auth

Setiap request membawa header:

```
x-gate-secret: <SHARED_SECRET>
```

Gate mengirim nilai dari `SUPPRESOR_LICENSE_API_SECRET`. Proxy wajib menolak
request tanpa secret yang cocok (constant-time compare) dan membalas `401`.

## GET /internal/license/:keyId

`keyId` adalah id dokumen `accessKeys`, misalnya `TTK-25A0-4906-4AEA`.

Response `200`:

```json
{
  "ok": true,
  "keyId": "TTK-25A0-4906-4AEA",
  "status": "ACTIVE",
  "tier": "pro",
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "daysRemaining": 431,
  "maxDevices": 5,
  "displayName": "Kunci Resmi Admin"
}
```

Aturan:

- `status` wajib `ACTIVE` untuk dianggap valid. Nilai lain (`REVOKED`, `EXPIRED`,
  `SUSPENDED`) ditolak gate.
- `expiresAt` opsional; kalau ada dan sudah lewat, gate menolak.
- `daysRemaining` opsional; kalau `<= 0`, gate menolak.
- `maxDevices` opsional, default 5.
- Jangan pernah mengembalikan field `key`, `keyHash`, atau data pembayaran.
- Key tidak ditemukan: `404 {"ok":false,"error":"not_found"}`.
- Key ada tapi tidak aktif: `200 {"ok":false,"error":"inactive","status":"REVOKED"}`.

## Opsional: pemakaian free tier di API kamu

Kalau kamu mau counter free tier ikut tersimpan di database web utama, tambahkan:

### POST /internal/usage/consume

```json
{ "deviceId": "a1b2...64hex", "keyId": null }
```

Response `200`:

```json
{ "ok": true, "uses": 4, "limit": 15, "allowed": true }
```

- `deviceId` divalidasi `^[a-f0-9]{32,64}$`.
- Naikkan counter atomik (`FieldValue.increment(1)` / transaksi SQL), jangan
  baca-lalu-tulis.
- `allowed=false` saat `uses > limit`.
- Idempotency: kalau request membawa `Idempotency-Key`, pakai itu untuk mencegah
  double count saat retry.

### POST /internal/usage/heartbeat

```json
{ "deviceId": "a1b2...", "keyId": null }
```

Response `200`:

```json
{ "ok": true, "allowed": true, "uses": 4, "limit": 15, "revoked": false }
```

## POST /internal/revoke

Dipanggil gate saat admin melakukan revoke, kalau kamu ingin revoke tercatat di web:

```json
{ "keyId": "TTK-...", "deviceId": null, "reason": "chargeback" }
```

Response `200 {"ok":true}`.

## Yang tidak boleh dilakukan proxy

- Menerima `tier`, `uses`, atau `allowed` dari klien lalu meneruskannya.
- Menyimpan shared secret di bundle frontend.
- Mencatat raw key atau context percakapan ke log plaintext.
- Membuka endpoint internal ke publik tanpa secret/IP allowlist.

## Konfigurasi gate

```bash
export SUPPRESOR_LICENSE_API=https://app.example.com
export SUPPRESOR_LICENSE_API_SECRET=...
```

Urutan resolusi key legacy: registry admin → API (`/internal/license`) → Firestore
(`get` publik). Kalau API mengembalikan `404`, gate tidak mencoba Firestore, supaya
key yang sudah dihapus tidak “hidup lagi” dari cache lama.

## Hosting: AI Studio bukan backend

`https://tiki-tiki-fire-hub.ai.studio/` adalah frontend statis + konfigurasi Firebase.
Tidak ada runtime server di sana, jadi tidak bisa menambahkan `/internal/license` di
aplikasi itu sendiri. Pilihan backend:

| Opsi | Cocok kalau | Catatan |
|---|---|---|
| **Cloud Run** (project `crafty-joy-d6d0h`) | punya billing aktif | satu project, service account otomatis, admin SDK gratis akses Firestore |
| Cloud Functions | ingin event-driven | butuh Blaze, cold start lebih terasa |
| Fly/VPS | tidak mau billing Google | harus pegang service account sendiri |

### Cloud Run

```bash
# sekali: aktifkan API + billing di console, lalu buat secret
printf '%s' "$GATE_SECRET" | gcloud secrets create gate-secret --data-file=-
gcloud secrets create token-key-private --data-file=server/token-key-private.pem

# deploy
./server/deploy-cloudrun.sh
```

Setelah URL keluar:

```bash
export SUPPRESOR_GATE_URL=https://suppresor-gate-xxxx.run.app
curl -s $SUPPRESOR_GATE_URL/healthz
```

Di Cloud Run, gate memakai service account default untuk membaca Firestore lewat
metadata server (tidak perlu file JSON). Kalau memakai VPS, isi
`GOOGLE_APPLICATION_CREDENTIALS` ke file service account.

### Setelah backend hidup: kunci akses publik

Dengan gate bisa membaca `accessKeys` memakai service account, aturan Firestore bisa
ditutup total:

```
allow get: false;   // di match /accessKeys
```

Lalu di plugin:

```bash
export SUPPRESOR_STRICT_ONLINE=1
```

Efeknya:

- key legacy `TTK-*` hanya bisa diaktivasi saat gate hidup (tidak ada fallback baca publik),
- key signed `SRK1` tetap bisa aktivasi offline,
- enumerasi dan pembuatan key palsu tetap mati.

Tanpa gate, biarkan `allow get: true` seperti sekarang supaya aktivasi legacy tetap
jalan.

## Mode bridge untuk gate

Gate sudah punya adapter. Set:

```bash
export SUPPRESOR_LICENSE_API=https://api.domain-kamu.com
export SUPPRESOR_LICENSE_API_SECRET=shared-secret
export SUPPRESOR_USAGE_API=1
```

Perilaku:

| Endpoint gate | Bridge yang dipanggil | Kalau bridge gagal |
|---|---|---|
| `/v1/session` + key | `GET /internal/license/:keyId` | jatuh ke registry lokal lalu Firestore |
| `/v1/session` tanpa key | `POST /internal/usage/consume` | hitungan lokal gate |
| `/v1/heartbeat` | `POST /internal/usage/heartbeat` | revoke lokal saja |
| `/v1/admin/revoke` | `POST /internal/revoke` | dicatat di gate saja |

`404` dari `/internal/license` langsung menjadi `bad_license`; gate tidak mencoba
sumber lain supaya key yang sudah dihapus tidak hidup lagi dari cache.

Test adapter: `node --test tests/gate-bridge.test.mjs` → 5/5 (license, 404,
usage limit, revoke, heartbeat revocation).

## Implementasi siap pakai (Express)

Folder `bridge/` berisi router Express + adapter Firestore:

- `bridge/gate-router.mjs` — route, secret check, validasi payload
- `bridge/firestore-store.mjs` — `accessKeys`, `gateUsage`, `gateRevoked`
- `bridge/test.mjs` — e2e router + gate (5/5)

Mount di `/api`, set `GATE_BRIDGE_SECRET`, lalu arahkan gate ke
`https://host/api`. Detail di `bridge/README.md`.

## Mode bridge AI Studio (`/api/internal/bridge`)

Bentuk API yang dipakai web utama:

```bash
export SUPPRESOR_BRIDGE_URL=https://host/api/internal/bridge
export SUPPRESOR_BRIDGE_KEY=<master bridge key>
```

| Gate memanggil | Endpoint | Header |
|---|---|---|
| validasi key | `GET /keys/:keyId` | `x-internal-api-key` |
| catat pemakaian | `POST /keys/:keyId/uses` `{count,deviceId,deviceName}` | `x-internal-api-key` |
| heartbeat | `GET /keys/:keyId` (cek `status`) | `x-internal-api-key` |

Field yang dibaca: `status`, `tier` (atau `permissions` berisi `ROOT`/`SUPER_ADMIN`),
`maxDevices`, `maxUses`/`quota`, `uses`, `daysRemaining`, `expiresAt`.
`daysRemaining: -1` dianggap permanen. `maxUses` terlampaui → `403 quota_exceeded`.

Urutan resolusi: AI Studio bridge → license API generik → registry admin → Firestore.

Catatan: endpoint internal ini belum ada di deployment publik
(`tiki-tiki-fire-hub.ai.studio` membalas SPA, sedangkan `ais-dev-*.run.app` di balik
auth flow AI Studio). Gate baru bisa memakainya setelah build yang memuat route
internal di-deploy ke URL publik.

### Verifikasi live (2026-10-29)

```
GET  /api/internal/bridge/health                200 OPERATIONAL
GET  /api/internal/bridge/keys/TTK-25A0-...     200 ACTIVE, maxDevices 1, usesCount naik
POST /api/internal/bridge/keys/TTK-25A0-.../uses 200 usesCount 1
gate + bridge, device terikat                    200 tier pro, uses 2
gate + bridge, device baru                       403 device_limit
gate + bridge, heartbeat                         200
```

Bentuk respons nyata memakai `usesCount`, `tier: SUPPORTER`, `maxUses: null`
(unlimited), `maxDevices: 1`. Adapter menormalkan semuanya.
