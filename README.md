# rest-anim

REST API anime — **versi mentah (passthrough)** untuk keperluan debug.
Semua endpoint meneruskan respons upstream **AnimeIn**
(`https://xyz-api.animein.net/3/2`, API aplikasi AnimeIn) apa adanya:
badan respons byte-per-byte dan status HTTP diteruskan, tanpa transformasi.

Dibangun di atas Cloudflare Workers + Hono (pola yang sama dengan rest-tempmail).

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

## Pengembangan lokal

```bash
npm install
npm run dev        # wrangler dev
npm run typecheck
```
