/**
 * rest-anim — REST API anime (versi MENTAH / passthrough).
 *
 * Semua endpoint meneruskan respons upstream AnimeIn APA ADANYA
 * (byte-per-byte, status HTTP ikut diteruskan) supaya mudah di-debug.
 * Belum ada transformasi/penyeragaman amplop — itu tahap berikutnya.
 *
 * Upstream : https://xyz-api.animein.net/3/2  (API aplikasi AnimeIn)
 * Request ke upstream menyalin PERSIS pola handler repo animeruu:
 *   - Header: User-Agent "RE Android/1.0.0", Connection Keep-Alive, gzip
 *   - Mode tamu: id_user=0 & key_client=null (di endpoint yang memintanya)
 *   - explore: selalu 4 parameter (keyword, genre_in, sort, page), page dari 0
 *   - episode: page=0 & search='' ; stream: TANPA parameter sama sekali
 *
 * Header debug di setiap respons:
 *   X-Upstream-Status  status HTTP dari upstream
 *   X-Upstream-Ms      latensi upstream (ms)
 *   X-Upstream-Path    path upstream yang ditembak (tanpa query)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

const UPSTREAM_DEFAULT = "https://xyz-api.animein.net/3/2";

type Bindings = {
  /** Timpa base upstream (untuk debug/pengujian); bawaan UPSTREAM_DEFAULT. */
  UPSTREAM_BASE_URL?: string;
};

const APP_HEADERS: Record<string, string> = {
  "User-Agent": "RE Android/1.0.0",
  Connection: "Keep-Alive",
  "Accept-Encoding": "gzip",
};

const TAMU: Record<string, string> = { id_user: "0", key_client: "null" };

const HARI = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

/** Nama hari (Indonesia, huruf besar) untuk tanggal tertentu di zona Asia/Jakarta. */
function hariJakarta(d = new Date()): string {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    weekday: "short",
  }).format(d); // Sun, Mon, ...
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return HARI[idx >= 0 ? idx : 1];
}

type Params = Record<string, string>;

/** Tembak upstream dan teruskan responsnya mentah-mentah + header debug. */
async function passthrough(base: string, path: string, params: Params): Promise<Response> {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);

  const t0 = Date.now();
  let up: Response;
  try {
    up = await fetch(url.toString(), { headers: APP_HEADERS });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: "upstream tidak terjangkau",
        detail: err instanceof Error ? err.message : String(err),
        upstream_path: path,
      },
      { status: 502 },
    );
  }
  const body = await up.arrayBuffer();
  const ms = Date.now() - t0;

  return new Response(body, {
    status: up.status,
    headers: {
      "Content-Type": up.headers.get("Content-Type") ?? "application/json; charset=utf-8",
      "X-Upstream-Status": String(up.status),
      "X-Upstream-Ms": String(ms),
      "X-Upstream-Path": path,
    },
  });
}

const app = new Hono<{ Bindings: Bindings }>();

const baseOf = (c: { env: Bindings }) => c.env.UPSTREAM_BASE_URL ?? UPSTREAM_DEFAULT;

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "rest-anim",
    version: "0.1.0-raw",
    mode: "passthrough mentah (respons upstream apa adanya)",
    upstream: UPSTREAM_DEFAULT,
    endpoints: [
      "GET /api/health",
      "GET /api/home?day=KAMIS",
      "GET /api/schedule?day=KAMIS",
      "GET /api/search?keyword=naruto&genre=&sort=views&page=0",
      "GET /api/anime/:id",
      "GET /api/anime/:id/episodes?page=0&search=",
      "GET /api/episode/:id/stream",
    ],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, upstream: baseOf(c) }));

/** Beranda: today/hot/new/fyp/popular/slider/trailer (per hari). */
app.get("/api/home", (c) => {
  const day = (c.req.query("day") || hariJakarta()).toUpperCase();
  return passthrough(baseOf(c), "/home/data", {
    ...TAMU,
    limit: "20",
    setup_fyp_flag: "Y",
    day,
  });
});

/** Jadwal tayang per hari. */
app.get("/api/schedule", (c) => {
  const day = (c.req.query("day") || hariJakarta()).toUpperCase();
  return passthrough(baseOf(c), "/schedule/data", { day });
});

/** Browse + pencarian. Keempat parameter WAJIB ada (page mulai 0). */
app.get("/api/search", (c) => {
  return passthrough(baseOf(c), "/explore/movie", {
    keyword: c.req.query("keyword") ?? "",
    genre_in: c.req.query("genre") ?? "",
    sort: c.req.query("sort") ?? "views",
    page: c.req.query("page") ?? "0",
  });
});

/** Detail anime (data.movie + episode pertama + season). */
app.get("/api/anime/:id", (c) => {
  return passthrough(baseOf(c), `/movie/detail/${c.req.param("id")}`, { ...TAMU });
});

/** Daftar episode (data.episode). Hanya bermakna untuk type SERIES. */
app.get("/api/anime/:id/episodes", (c) => {
  return passthrough(baseOf(c), `/movie/episode/${c.req.param("id")}`, {
    ...TAMU,
    page: c.req.query("page") ?? "0",
    search: c.req.query("search") ?? "",
  });
});

/** Server stream satu episode. Upstream dipanggil TANPA parameter. */
app.get("/api/episode/:id/stream", (c) => {
  return passthrough(baseOf(c), `/episode/streamnew/${c.req.param("id")}`, {});
});

app.notFound((c) => c.json({ ok: false, error: "route tidak ditemukan" }, 404));

export default app;
