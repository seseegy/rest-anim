# rest-anim

REST API anime — **versi mentah (passthrough)** untuk keperluan debug.
Semua endpoint meneruskan respons upstream **AnimeIn**
(`https://xyz-api.animein.net/3/2`, API aplikasi AnimeIn) apa adanya:
badan respons byte-per-byte dan status HTTP diteruskan, tanpa transformasi.

Satu codebase Hono, tiga rumah: **Cloudflare Workers** (`src/index.ts` via wrangler),
**Vercel** (`api/index.ts` + `vercel.json`), dan **Node biasa** (`src/server.ts`,
untuk VPS/Termux). Kode + rute identik di ketiganya; yang beda cuma transport.

**Catatan egress (hasil uji 23 Okt 2026):** upstream di belakang Cloudflare
menilai egress per request secara probabilistik. Workers kena blokir keras 403
("you have been blocked"). Vercel (region fungsi **sin1**, Node 22) kebanyakan
lolos, sesekali kena tantangan JS 403 ("Just a moment...") — karena itu
passthrough kini **mengulang sampai 3x bila ditolak 403** (terlihat di header
`X-Upstream-Attempts`). Production yang terbukti mengalirkan data:
**https://rest-anim.vercel.app** (keenam endpoint 200, ukuran cocok dengan
tangkapan live Termux). Varian Node tetap tersedia untuk VPS/Termux.

## Endpoint

| Rute | Upstream | Catatan |
|---|---|---|
| `GET /` | — | indeks + daftar endpoint |
| `GET /api/health` | — | cek hidup |
| `GET /api/home?day=KAMIS` | `/3/2/home/data` | day bawaan: hari ini (Asia/Jakarta) |
| `GET /api/schedule?day=KAMIS` | `/3/2/schedule/data` | |
| `GET /api/search?keyword=naruto&genre=&sort=views&page=0` | `/3/2/explore/movie` | page mulai 0 |
| `GET /api/anime/:id` | `/3/2/movie/detail/:id` | |
| `GET /api/anime/:id/episodes?page=0&search=` | `/3/2/movie/episode/:id` | daftar di `data.episode`; hanya SERIES |
| `GET /api/episode/:id/stream` | `/3/2/episode/streamnew/:id` | upstream tanpa parameter |

## Header debug

Setiap respons passthrough membawa:

- `X-Upstream-Status` — status HTTP dari upstream
- `X-Upstream-Ms` — latensi upstream (ms)
- `X-Upstream-Path` — path upstream yang ditembak

Kalau upstream menjawab 403 + HTML, itu tanda egress diblokir Cloudflare
(blokir berbasis IP di sisi upstream) — badan HTML-nya diteruskan apa adanya
supaya kelihatan di browser/curl.

## Cara request ke upstream (persis pola animeruu)

- Header: `User-Agent: RE Android/1.0.0`, `Connection: Keep-Alive`, `Accept-Encoding: gzip`
- Mode tamu: `id_user=0&key_client=null` pada endpoint yang memintanya
- explore selalu 4 parameter (`keyword`, `genre_in`, `sort`, `page`)
- stream tanpa parameter sama sekali

## Deploy (Cloudflare Workers)

Cara Git (dashboard Cloudflare): Workers & Pages → Create → Connect to Git →
pilih repo `rest-anim` → production branch `main` → Deploy.
Build command: kosongkan / `npm install`; deploy command bawaan `npx wrangler deploy`.

Cara CLI (butuh API token Cloudflare):

```bash
npm install
npx wrangler login   # atau CLOUDFLARE_API_TOKEN
npm run deploy
```

## Jalan sebagai server Node (VPS / Termux)

Syarat: Node.js ≥ 20 (Termux: `pkg install nodejs git`).

```bash
git clone https://github.com/seseegy/rest-anim
cd rest-anim
npm install
npm run start          # PORT bawaan 8787 → http://0.0.0.0:8787
```

Port lain / timpa upstream (debug): `PORT=8080 npm run start` atau
`UPSTREAM_BASE_URL=https://contoh.lain/3/2 npm run start`.

Di VPS, bungkus dengan systemd/pm2 supaya hidup terus; di Termux cukup
jalankan di sesi tmux. API lalu dijangkau di `http://<ip-mesin>:8787/api/home`.

## Pengembangan lokal

```bash
npm install
npm run dev        # wrangler dev
npm run typecheck
```
