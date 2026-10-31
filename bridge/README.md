# Gate bridge untuk web utama (Express)

Web `tiki-tiki-fire-hub.ai.studio` sudah full-stack Express + React. Bridge ini
menambah tiga route internal supaya gate bisa validasi key dan hitung kuota tanpa
memakai endpoint publik.

## Pasang di server web

```js
import admin from 'firebase-admin';                    // instance yang sudah ada
import { createGateRouter } from './bridge/gate-router.mjs';
import { createFirestoreStore } from './bridge/firestore-store.mjs';

app.use('/api', createGateRouter({
  secret: process.env.GATE_BRIDGE_SECRET,
  store: createFirestoreStore(admin.firestore()),
}));
```

Salin folder `bridge/` ke repo web (butuh `express` yang sudah ada), lalu set
`GATE_BRIDGE_SECRET` di environment server dan di gate.

Route yang terbentuk:

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/internal/license/:keyId` | baca status key dari `accessKeys` |
| POST | `/api/internal/usage/consume` | naikkan counter di `gateUsage/{deviceId}` |
| POST | `/api/internal/usage/heartbeat` | cek revoked + counter |
| POST | `/api/internal/revoke` | tulis `gateRevoked/{keyId}` |

Semua wajib header `x-gate-secret`. Tanpa secret: `503`. Secret salah: `401`.

## Test lokal

```bash
cd bridge && npm install
node test.mjs     # 5/5: license, unknown, usage limit, revoke, heartbeat
```

Test menjalankan Express router + gate sungguhan, jadi yang diuji adalah jalur
produksi, bukan mock di dalam gate.

## Konfigurasi gate

```bash
export SUPPRESOR_LICENSE_API=https://tiki-tiki-fire-hub.ai.studio/api
export SUPPRESOR_LICENSE_API_SECRET=<GATE_BRIDGE_SECRET>
export SUPPRESOR_USAGE_API=1
```

Gate memanggil `/api/internal/...` dan memakai hasilnya sebagai otoritas. Kalau
bridge mati, gate jatuh ke registry lokal/Firestore.

## Catatan keamanan

- Jangan pakai `/api/access-keys/redeem` sebagai validator. Endpoint itu membuat user
  baru setiap panggilan, membalas `key`, `keyHash`, dan session token, serta mengikat
  device dari user-agent.
- Endpoint internal hanya untuk server-ke-server; jangan expose ke browser.
- `gateUsage` dan `gateRevoked` ditulis dengan Admin SDK, jadi tidak terpengaruh rules.

## Mode AI Studio (`/api/internal/bridge`)

Kalau route internal sudah ada di server (bentuk `GET /keys/:keyId`,
`POST /keys/:keyId/uses`, header `x-internal-api-key`), gate tidak perlu router di
atas:

```bash
export SUPPRESOR_BRIDGE_URL=https://host/api/internal/bridge
export SUPPRESOR_BRIDGE_KEY=<master bridge key>
```

Router di folder ini tetap berguna kalau mau bentuk kontrak sendiri
(`/internal/license`, `/internal/usage/*`).
