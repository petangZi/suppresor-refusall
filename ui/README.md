# suppresor-ui

Dashboard terminal untuk Suppresor Refusall. Dibangun dengan OpenTUI, SolidJS, dan
TypeScript. Tidak ada banner ASCII: semua status tampil sebagai panel, meter, chip,
dan dialog.

## Prasyarat

- Bun 1.2+ (renderer OpenTUI memakai preload Solid)
- Terminal truecolor, minimal 100x30 (di bawah 104 kolom layout menumpuk vertikal)

## Install

```bash
cd ui
bun install
```

`@opentui/solid` menarik `babel-preset-solid`, dan pada sebagian instalasi paket itu
terpasang kosong. Script `postinstall` di `scripts/ensure-babel-solid.mjs` menarik
ulang tarball resmi kalau `index.js` tidak ada.

Kalau memakai npm, pakai `npm install --legacy-peer-deps` karena peer dependency
`solid-js` dipatok ketat.

## Jalankan

```bash
bun run start
bun run start --activate TTK-XXXX-XXXX-XXXX   # aktivasi lalu buka dashboard
```

## Keybind

| Key | Aksi |
|---|---|
| `F2` | buka dialog aktivasi |
| `r` | baca ulang state dan probe gateway |
| `g` | probe gateway saja |
| `q` / `Esc` | keluar |
| `Enter` | submit key di dialog |
| `Esc` | tutup dialog |

## Sumber data

Dashboard hanya membaca, tidak menambah pemakaian:

- `~/.config/opencode/.suppresor-license` — snapshot tier, origin, counter
- `~/.config/opencode/.suppresor-uses` — shadow counter
- `~/.config/opencode/.suppresor-gate-token.json` — token gate (tier, TTL, limit)
- `~/.config/opencode/.suppresor-device` — device id
- `GET {gate}/healthz` — status gateway

Aktivasi memanggil `license.activateDevice()` dari plugin, jadi perilakunya sama
dengan `/suppresor-refusall key <KEY>`.

## Struktur

```
ui/
  src/index.tsx   dashboard + dialog + keybind
  src/status.ts   pembacaan state, probe gateway, aktivasi
  src/theme.ts    palet dan teks
  scripts/ensure-babel-solid.mjs
```
