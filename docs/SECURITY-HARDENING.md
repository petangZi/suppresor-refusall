# Hardening: gate server-side + Firebase

## 1. Gate tanpa proses lokal

Mount gate langsung di Express web utama. Tidak ada daemon, tidak ada port lokal.

```js
import { mountGate } from './server/gate-express.mjs';

mountGate(app, '/api/gate');
```

Lalu plugin cukup:

```bash
export SUPPRESOR_GATE_URL=https://tiki-tiki-fire-hub.ai.studio/api/gate
export SUPPRESOR_BRIDGE_URL=https://tiki-tiki-fire-hub.ai.studio/api/internal/bridge
export SUPPRESOR_BRIDGE_KEY=<master bridge key>
```

Secret gate (`SUPPRESOR_GATE_SECRET`) wajib ada di environment server. Tanpa itu
endpoint admin mati (`admin_disabled`).

## 2. Anti-RCE / anti-abuse yang sudah aktif

| Lapisan | Perilaku |
|---|---|
| Body limit | 1 MB (`SUPPRESOR_GATE_MAX_BODY`), `express.json({limit})` menolak sebelum parse |
| Total payload transform | 200k karakter (`SUPPRESOR_GATE_MAX_TOTAL_CHARS`), maks 80 item, 40k/item |
| Method | hanya route yang terdaftar; sisanya 404 |
| Secret admin | `crypto.timingSafeEqual`, panjang harus sama |
| Rate limit | 240 req/menit per device token, 60 sesi/jam per IP |
| IP asli | diambil dari socket (`x-gate-ip`), `x-forwarded-for` diabaikan kecuali `SUPPRESOR_GATE_TRUST_PROXY=1` |
| Header | `nosniff`, `no-referrer`, `no-store` |
| Proto pollution | container jalan dengan `--disable-proto=throw` |
| Eksekusi | tidak ada `eval`, `Function`, `child_process`, atau dynamic import dari input |
| Container | non-root `gate`, read-only source, healthcheck |
| Timeout | 4s ke bridge/Firestore, 2s healthz |

Yang tidak dilakukan gate: menyimpan atau mengeksekusi kode dari klien, menulis file
dari input, menjalankan shell, atau memuat modul berdasarkan nama dari request.

## 3. Firebase: supaya API/key tidak bocor lagi

Kondisi terukur 2026-10-29:

```
POST documents:runQuery accessKeys  403
GET  documents/accessKeys/<key>     200 (tanpa auth)
create/update/delete                403
```

Artinya enumerasi sudah mati, tapi siapa pun yang tahu satu key bisa membaca dokumen
itu tanpa login. Kalau dokumen berisi `key`/`keyHash`, data itu ikut terbaca.

### P0 — wajib

1. **Hapus field sensitif dari dokumen yang bisa dibaca klien.** Pindahkan `key`,
   `keyHash`, `supporterEmail`, dan catatan pembayaran ke
   `accessKeysPrivate/{keyId}` yang rules-nya `allow read, write: if false`.
2. **Wajibkan auth untuk get.** Ganti di `firestore.rules`:

   ```
   match /accessKeys/{keyId} {
     allow get: if request.auth != null;   // plugin memakai anonymous auth
     allow list: if false;
     allow create, update, delete: if false;
   }
   ```

   Plugin sudah punya `ensureAnonAuth()`, jadi aktivasi tetap jalan. Kalau nanti
   aktivasi dipindah ke gate, ganti menjadi `if false`.

3. **Rotasi 15 key + master bridge key + admin passphrase + legacy bridge key.**
   Semua yang pernah muncul di chat atau di respons API dianggap bocor.
4. **Bridge jangan mengembalikan `key` dan `keyHash`.** Cukup `status`, `tier`,
   `expiresAt`, `daysRemaining`, `maxDevices`, `usesCount`.
5. **Redeem wajib device-bound.** `POST /api/access-keys/redeem` sekarang menerima
   key tanpa `deviceId`, membuat user baru tiap panggilan, dan membalas `keyHash`.
   Wajibkan `deviceId`, batasi 5 redeem/menit/IP, maks 3 redeem per key, dan jangan
   balikan `key`/`keyHash`.

### P1 — penting

6. **Admin auth.** Passphrase `GODSCRIPTOR_MASTER_SECURE_2026` sudah terekspos:
   ganti, simpan sebagai hash (argon2/scrypt), rate limit login, cookie
   `HttpOnly; Secure; SameSite=Strict`, TTL pendek, rotasi sesi.
7. **Rate limit endpoint publik** (`redeem`, `login`, `chat/completions`) per IP dan
   per akun; log penolakan.
8. **Audit log**: catat redeem, generate, revoke, login admin (tanpa key mentah).
9. **Budget alert + Cloud Audit Logs + backup Firestore harian.**
10. **Jangan log body** yang memuat key; scrub `authorization`, `x-internal-api-key`,
    `x-gate-secret`.

### P2 — opsional

11. **App Check** (reCAPTCHA Enterprise) untuk web. Catatan: enforcement App Check
    akan memblokir klien non-web seperti plugin (REST), jadi aktifkan hanya untuk
    Auth/Firestore web, atau sediakan endpoint server untuk plugin.
12. **API key restriction** HTTP referrer untuk key web; plugin memakai jalur server
    (gate), jadi tidak butuh API key browser.
13. **CORS** internal route: jangan `*`; tidak perlu CORS untuk server-to-server.

## 4. Verifikasi setelah perubahan

```bash
node admin/verify-rules.mjs        # 7/7
node --test tests/gate-express.test.mjs tests/gate-express-ip.test.mjs
```
