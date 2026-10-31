# Firebase — yang harus diperbaiki

Konteks project dan urutan perbaikan untuk `suppresor-refusall`. Ditulis dari hasil
audit langsung ke database produksi pada 2026-10-24.

## Konteks project

| Item | Nilai |
|---|---|
| Project ID | `crafty-joy-d6d0h` |
| Firestore database | `ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977` (named, **bukan** `(default)`) |
| File rules | `firestore.rules` |
| Target deploy | `firebase.json` (sudah diarahkan ke named database) |
| Kredensial klien | `firestore-access.json`, `firestore.env`, `.env.firestore` (Web API key + config, bukan service account) |
| Kredensial admin | tidak ada di repo; `admin/license-private.pem` dan `server/token-key-private.pem` hanya untuk signing lisensi/token |
| Akun CLI saat ini | `aketayaza@gmail.com` — bisa `projects:list`, **tidak bisa** deploy rules |

Aplikasi memakai **named database**. Deploy rules ke `(default)` tidak melindungi
database ini. `firebase.json` versi lama tidak menyebut `database`, jadi kemungkinan
besar deploy sebelumnya masuk ke database default — itulah sebabnya rules yang
"sudah ada di repo" tidak pernah aktif di database yang dipakai.

## P0 — Tutup enumerasi `accessKeys`

**Status: SELESAI (2026-10-24), ruleset final `f828d8a6-d8a6-43dd-bea9-9e9b6a42a9a9`.**
Riwayat singkat: ruleset pertama berisi rules lisensi saja. Setelah itu Console
mem-publish ruleset aplikasi (11k karakter, koleksi supportSubmissions/polls/votes
dan lain-lain). Ruleset aplikasi itu punya **dua** blok `accessKeys`; blok kedua
`allow read, write: if true`, sehingga enumerasi terbuka lagi **dan** siapa pun bisa
membuat key palsu (`create 200`). Ruleset final menggabungkan aturan aplikasi dengan
aturan lisensi: blok duplikat dihapus, `users` menerima dua bentuk dokumen (profil
aplikasi dan ledger lisensi), dan `accessKeys` hanya boleh `get` tanpa auth.

Verifikasi ulang kapan saja dengan `node admin/verify-rules.mjs` (7/7 cek).

```
release: projects/crafty-joy-d6d0h/releases/cloud.firestore/ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977
ruleset: projects/crafty-joy-d6d0h/rulesets/dd75a799-622b-4864-8705-a5db2d4d6675
```

Hasil verifikasi langsung setelah publish:

| Request | Hasil |
|---|---|
| `runQuery` accessKeys | 403 |
| `get` accessKeys/TTK-25A0-4906-4AEA | 200 |
| `list` accessKeys | 403 |
| create/update/delete | 403 |
| `runQuery` users | 403 |

Catatan IAM: akun `aketayaza@gmail.com` **punya** `firebaserules.rulesets.create`,
`firebaserules.rulesets.list`, `firebaserules.releases.update`, `datastore.*`, dan
`resourcemanager.projects.getIamPolicy`. Yang **tidak** ada hanya
`serviceusage.services.use`, dan itulah yang membuat `firebase deploy` gagal di
preflight "ensuring required API firestore.googleapis.com is enabled" — bukan
kegagalan izin rules. Deploy dilakukan lewat Firebase Rules API memakai izin yang
sudah ada, jadi tidak perlu menunggu grant IAM.

Kalau mau `firebase deploy --only firestore:rules` juga jalan (dan MCP
`firebase_deploy` bisa dipakai), tambahkan satu role saja:

```bash
gcloud projects add-iam-policy-binding crafty-joy-d6d0h \
  --member=user:aketayaza@gmail.com \
  --role=roles/serviceusage.serviceUsageConsumer
```

Tanpa `gcloud`: Console → IAM & Admin → grant **Service Usage Consumer** ke akun itu.

**Bukti sebelum perbaikan**

```
POST .../documents:runQuery  body: from accessKeys, limit 1     -> 200, isi dokumen
GET  .../documents/accessKeys/TTK-25A0-4906-4AEA                -> 200, tanpa auth
POST .../documents/users:runQuery                                -> 403
POST .../documents/x?documentId=y  (create)                      -> 403
```

Artinya: seluruh dokumen `accessKeys` bisa dienumerasi tanpa login, dan setiap
dokumen menyimpan field `key` berisi kunci mentah. Sepuluh key terbaca, termasuk
`TTK-25A0-4906-4AEA`. Koleksi `users` dan semua operasi tulis tetap `403`, jadi ini
kebocoran kunci lisensi (read-only), bukan akses penuh ke database.

**Siapa pun yang membaca file ini harus menganggap semua `TTK-*` sudah bocor.**

### Langkah

1. `firebase.json` sudah diperbaiki ke bentuk multi-database:

   ```json
   {
     "firestore": [
       {
         "database": "ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977",
         "rules": "firestore.rules"
       }
     ]
   }
   ```

2. Deploy dari akun dengan role **Owner** atau **Firebase Admin** pada project:

   ```bash
   firebase deploy --only firestore:rules --project crafty-joy-d6d0h
   ```

   Error yang muncul dari akun sekarang:

   ```
   403 Caller does not have required permission to use project crafty-joy-d6d0h.
   Grant the caller roles/serviceusage.serviceUsageConsumer
   ```

   Itu masalah IAM akun, bukan aturan. Tambahkan role
   `roles/serviceusage.serviceUsageConsumer` (plus `roles/firebaserules.admin`
   atau `roles/firebase.admin`) ke akun tersebut, atau deploy dari akun lain.

3. Alternatif tanpa CLI: Firebase Console → Firestore Database → **pilih named
   database** di dropdown (bukan `(default)`) → tab **Rules** → tempel isi
   `firestore.rules` → **Publish**.

4. Verifikasi setelah publish. Empat request ini harus menghasilkan
   `403, 200, 403, 403`:

   ```bash
   DB=ai-studio-tikitikifirehub-2c738d85-fa44-4fe8-9139-9a025f0ef977
   P=crafty-joy-d6d0h
   B="https://firestore.googleapis.com/v1/projects/$P/databases/$DB/documents"

   # 1. enumerasi harus mati
   curl -s -o /dev/null -w 'runQuery:%{http_code}\n' -X POST "$B:runQuery" \
     -H 'content-type: application/json' \
     -d '{"structuredQuery":{"from":[{"collectionId":"accessKeys"}],"limit":1}}'

   # 2. get satu key harus tetap hidup (key id = kredensial)
   curl -s -o /dev/null -w 'get:%{http_code}\n' "$B/accessKeys/TTK-25A0-4906-4AEA"

   # 3. list harus mati
   curl -s -o /dev/null -w 'list:%{http_code}\n' "$B/accessKeys?pageSize=5"

   # 4. tulis harus mati
   curl -s -o /dev/null -w 'write:%{http_code}\n' -X POST "$B/x?documentId=y" \
     -H 'content-type: application/json' -d '{"fields":{"a":{"stringValue":"1"}}}'
   ```

   `get` sengaja dibiarkan tanpa auth: dokumen key hanya bisa dibaca kalau id-nya
   sudah diketahui, dan id itulah kredensialnya. Yang ditutup adalah enumerasi
   (`list`/query) dan seluruh operasi tulis.

### Kenapa rules-nya begini

| Aturan | Alasan |
|---|---|
| `allow get: if true` pada `accessKeys` | Cek lisensi = membaca satu dokumen dengan id key. Tanpa ini, plugin butuh Anonymous Auth yang sekarang dimatikan |
| `allow list: if false` | Menutup enumerasi; inilah lubang yang ditemukan |
| create/delete `false`, update hanya `devices/uses/lastUseAt` | Klien tidak boleh membuat, menghapus, atau menurunkan counter |
| `users` hanya dokumen milik sendiri, `uses` naik | Ledger free tier tidak bisa direset |
| collection lain ditutup | Tidak ada koleksi tak sengaja terbuka |

## P1 — Rotasi key dan buang `key` mentah

Script: `admin/rotate-keys.mjs` (dry run default).

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/service-account.json
node admin/rotate-keys.mjs                 # lihat rencana, tidak menulis
node admin/rotate-keys.mjs --apply         # buat key baru, set lama REVOKED, hapus field key
node admin/rotate-keys.mjs --apply --delete-old   # hapus dokumen lama, bukan REVOKED
```

Yang dilakukan: untuk setiap dokumen `status: ACTIVE`, script membuat key baru
`TTK-XXXX-XXXX-XXXX`, menyalin metadata, menghitung ulang `keyHash`
(sha256 dari key mentah — sudah diverifikasi cocok dengan dokumen lama), menulis
`maskedKey`/`rotatedFrom`, lalu mencabut dokumen lama dan menghapus field `key`.

Service account butuh `roles/datastore.user` pada project. Key baru dicetak sekali
ke stdout; distribusikan manual, jangan disimpan di repo.

Setelah rotasi, hapus juga field `key` dari dokumen lama yang mungkin tersisa dan
pastikan tidak ada kode yang membaca `key` (grep `fields.key`).

## P2 — Auth, counter, dan operasi

1. **Anonymous Auth masih mati.** Sign-up anon mengembalikan
   `ADMIN_ONLY_OPERATION`. Selama mati, jalur ledger Firestore (counter free tier
   server-side) tidak akan pernah jalan; plugin akan pakai jalur lokal atau gate.
   Kalau mau ledger Firestore hidup: Firebase Console → Authentication →
   Sign-in method → Anonymous → Enable. Kalau tidak, biarkan mati dan andalkan gate.
2. **Gate sebagai sumber kebenaran.** Deploy `server/gate.mjs` ke host yang punya
   akses keluar stabil, set `SUPPRESOR_GATE_URL`, dan isi `SUPPRESOR_GATE_SECRET`.
   Gate memvalidasi key legacy lewat registry admin atau baca Firestore (cache 5
   menit), jadi tidak bergantung pada Anonymous Auth.
3. **Budget alert.** Set budget + alert di Google Cloud Billing untuk project ini;
   endpoint publik `transform` bisa dipanggil siapa pun yang punya token.
4. **Backup.** Aktifkan export harian Firestore ke bucket; rotasi key tidak bisa
   dibatalkan.

## Checklist

- [x] `firebase.json` memakai named database (sudah di repo)
- [x] Rules di-publish ke database `ai-studio-tikitikifirehub-...`, bukan `(default)`
- [x] `runQuery accessKeys` → 403
- [x] `get accessKeys/<key>` → 200
- [x] `list accessKeys` → 403
- [x] create/update/delete → 403
- [ ] Semua `TTK-*` lama dirotasi, field `key` dihapus
- [x] `create accessKeys` → 403 (key palsu ditolak)
- [x] `admin/verify-rules.mjs` → 7/7
- [ ] Key baru didistribusikan ke pemiliknya
- [ ] Anonymous Auth diputuskan: dinyalakan atau tetap mati
- [ ] Gate di-deploy dan `SUPPRESOR_GATE_URL` diset
- [ ] Budget alert aktif

## Rollback

Console → Firestore → Rules → tab **History** → pilih versi sebelumnya → **Restore**.
Jangan rollback ke rules yang membolehkan `list` pada `accessKeys`.
