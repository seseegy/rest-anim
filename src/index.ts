/**
 * rest-anim — REST API anime (versi POLISH).
 *
 * Amplop respons seragam di semua endpoint:
 *   sukses : { ok: true, data, pagination? }
 *   gagal  : { ok: false, error: { message, upstream_status? } }
 * Data di dalam `data` adalah isi `data` upstream apa adanya (tanpa
 * amplop {status,error,data} milik upstream).
 *
 * Upstream : https://xyz-api.animein.net/3/2  (API aplikasi AnimeIn)
 * Request ke upstream menyalin PERSIS pola handler repo animeruu:
 *   - Header: User-Agent "RE Android/1.0.0", Connection Keep-Alive, gzip
 *   - Mode tamu: id_user=0 & key_client=null (di endpoint yang memintanya)
 *   - explore: selalu 4 parameter (keyword, genre_in, sort, page), page dari 0
 *   - episode: page=0 & search='' ; stream: TANPA parameter sama sekali
 *
 * Pagination (terukur dari upstream):
 *   - explore/search : 60 item per halaman, page mulai 0
 *   - daftar episode : 30 item per halaman, page mulai 0
 *   Upstream tidak memberi total; has_next = halaman terisi penuh.
 *
 * Ketahanan: upstream di belakang Cloudflare kadang melempar tantangan
 * 403 probabilistik ke egress datacenter — percobaan 403 diulang s/d 3x.
 *
 * Header debug di setiap respons:
 *   X-Upstream-Status / X-Upstream-Ms / X-Upstream-Path / X-Upstream-Attempts
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type UpResult = {
  status: number;
  text: string;
  ms: number;
  attempts: number;
  path: string;
};

/** Tembak upstream (dengan retry saat 403), kembalikan badan mentahnya. */
async function fetchUpstream(base: string, path: string, params: Params): Promise<UpResult> {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);

  const t0 = Date.now();
  let status = 0;
  let text = "";
  let attempts = 0;
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(400 * i);
    attempts++;
    try {
      const up = await fetch(url.toString(), { headers: APP_HEADERS });
      status = up.status;
      text = await up.text();
    } catch (err) {
      lastErr = err;
      status = 0;
      continue;
    }
    if (status !== 403) break;
  }
  if (status === 0) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  return { status, text, ms: Date.now() - t0, attempts, path };
}

function debugHeaders(r: UpResult): Record<string, string> {
  return {
    "X-Upstream-Status": String(r.status),
    "X-Upstream-Ms": String(r.ms),
    "X-Upstream-Path": r.path,
    "X-Upstream-Attempts": String(r.attempts),
  };
}

type Ctx = { env?: Bindings; json: (v: unknown, s?: number, h?: Record<string, string>) => Response };

/** Jalankan satu panggilan upstream lalu bentuk amplop bersihnya. */
async function respond<T>(
  c: Ctx,
  path: string,
  params: Params,
  shape: (upstreamData: unknown) => { data: T; pagination?: Pagination },
): Promise<Response> {
  let r: UpResult;
  try {
    r = await fetchUpstream(baseOf(c), path, params);
  } catch (err) {
    return c.json(
      { ok: false, error: { message: "upstream tidak terjangkau", detail: err instanceof Error ? err.message : String(err) } },
      502,
    );
  }
  const headers = debugHeaders(r);
  if (r.status !== 200) {
    return c.json(
      { ok: false, error: { message: `upstream menjawab ${r.status}`, upstream_status: r.status } },
      502,
      headers,
    );
  }
  let parsed: { data?: unknown } | null = null;
  try {
    parsed = JSON.parse(r.text) as { data?: unknown };
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== "object" || !("data" in parsed)) {
    return c.json(
      { ok: false, error: { message: "respons upstream bukan JSON yang dikenal", upstream_status: r.status } },
      502,
      headers,
    );
  }
  const { data, pagination } = shape(parsed.data);
  return c.json(pagination ? { ok: true, data, pagination } : { ok: true, data }, 200, headers);
}

type Pagination = {
  page: number;
  per_page: number;
  count: number;
  has_next: boolean;
  next_page: number | null;
  prev_page: number | null;
};

function pagination(page: number, perPage: number, count: number): Pagination {
  const hasNext = count >= perPage;
  return {
    page,
    per_page: perPage,
    count,
    has_next: hasNext,
    next_page: hasNext ? page + 1 : null,
    prev_page: page > 0 ? page - 1 : null,
  };
}

/** Ambil ?page= sebagai bilangan >= 0; selain itu null (→ 400). */
function parsePage(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const app = new Hono<{ Bindings: Bindings }>();

const baseOf = (c: { env?: Bindings }) => c.env?.UPSTREAM_BASE_URL ?? UPSTREAM_DEFAULT;

app.use("*", cors());

app.get("/", (c) =>
  c.json({
    name: "rest-anim",
    version: "1.0.0",
    mode: "polished (amplop bersih + pagination)",
    upstream: UPSTREAM_DEFAULT,
    endpoints: [
      "GET /api/health",
      "GET /api/home?day=KAMIS",
      "GET /api/schedule?day=KAMIS",
      "GET /api/search?keyword=naruto&genre=&sort=views&page=0",
      "GET /api/anime/:id",
      "GET /api/anime/:id/episodes?page=0&search=",
      "GET /api/episode/:id/stream",
      "GET /api/image?url=<url CDN animein.net>",
      "GET /api/poster?title=<judul anime> (Kitsu)",
    ],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, upstream: baseOf(c) }));

/** Beranda: today/hot/new/fyp/popular/slider/trailer (per hari). */
app.get("/api/home", (c) => {
  const day = (c.req.query("day") || hariJakarta()).toUpperCase();
  return respond(c, "/home/data", { ...TAMU, limit: "20", setup_fyp_flag: "Y", day }, (data) => ({ data }));
});

/** Jadwal tayang per hari → daftar anime. */
app.get("/api/schedule", (c) => {
  const day = (c.req.query("day") || hariJakarta()).toUpperCase();
  return respond(c, "/schedule/data", { day }, (data) => {
    const movies = (data as { movie?: unknown[] } | null)?.movie ?? [];
    return { data: movies };
  });
});

/** Browse + pencarian. 60 item/halaman, page mulai 0. */
app.get("/api/search", (c) => {
  const page = parsePage(c.req.query("page"));
  if (page === null) return c.json({ ok: false, error: { message: "page harus bilangan >= 0" } }, 400);
  return respond(
    c,
    "/explore/movie",
    {
      keyword: c.req.query("keyword") ?? "",
      genre_in: c.req.query("genre") ?? "",
      sort: c.req.query("sort") ?? "views",
      page: String(page),
    },
    (data) => {
      const movies = (data as { movie?: unknown[] } | null)?.movie ?? [];
      return { data: movies, pagination: pagination(page, 60, movies.length) };
    },
  );
});

/** Detail anime (data.movie + episode pertama + season). */
app.get("/api/anime/:id", (c) => {
  return respond(c, `/movie/detail/${c.req.param("id")}`, { ...TAMU }, (data) => ({ data }));
});

/** Daftar episode. 30 item/halaman; hanya bermakna untuk type SERIES. */
app.get("/api/anime/:id/episodes", (c) => {
  const page = parsePage(c.req.query("page"));
  if (page === null) return c.json({ ok: false, error: { message: "page harus bilangan >= 0" } }, 400);
  return respond(
    c,
    `/movie/episode/${c.req.param("id")}`,
    { ...TAMU, page: String(page), search: c.req.query("search") ?? "" },
    (data) => {
      const episodes = (data as { episode?: unknown[] } | null)?.episode ?? [];
      return { data: episodes, pagination: pagination(page, 30, episodes.length) };
    },
  );
});

/** Server stream satu episode. Upstream dipanggil TANPA parameter. */
app.get("/api/episode/:id/stream", (c) => {
  return respond(c, `/episode/streamnew/${c.req.param("id")}`, {}, (data) => ({ data }));
});

/**
 * Proxy gambar dari CDN AnimeIn — browser langsung ke CDN itu kena
 * tantangan Cloudflare, jadi gambar dilewatkan egress kita yang lolos.
 * Hanya host *.animein.net (https) yang diizinkan. Cache publik 24 jam.
 */
app.get("/api/image", async (c) => {
  const raw = c.req.query("url");
  if (!raw) return c.json({ ok: false, error: { message: "parameter url wajib ada" } }, 400);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return c.json({ ok: false, error: { message: "url tidak valid" } }, 400);
  }
  if (u.protocol !== "https:" || !(u.hostname === "animein.net" || u.hostname.endsWith(".animein.net"))) {
    return c.json({ ok: false, error: { message: "host tidak diizinkan (hanya *.animein.net)" } }, 400);
  }
  const t0 = Date.now();
  let status = 0;
  let buf: ArrayBuffer | null = null;
  let ct = "image/jpeg";
  let attempts = 0;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(400 * i);
    attempts++;
    try {
      const up = await fetch(u.toString(), { headers: APP_HEADERS });
      status = up.status;
      if (status === 200) {
        buf = await up.arrayBuffer();
        ct = up.headers.get("Content-Type") ?? ct;
        break;
      }
    } catch {
      status = 0;
    }
    if (status !== 403 && status !== 0) break;
  }
  const headers = {
    "X-Upstream-Status": String(status),
    "X-Upstream-Ms": String(Date.now() - t0),
    "X-Upstream-Path": u.pathname,
    "X-Upstream-Attempts": String(attempts),
  };
  if (!buf) {
    return c.json(
      { ok: false, error: { message: `CDN gambar menjawab ${status}`, upstream_status: status } },
      502,
      headers,
    );
  }
  return new Response(buf, {
    status: 200,
    headers: { ...headers, "Content-Type": ct, "Cache-Control": "public, max-age=86400" },
  });
});

/* ------------------------------------------------------------------ */
/* Poster & metadata dari Kitsu (basis data anime, tanpa API key).     */
/* CDN AnimeIn menolak request server, jadi poster diambil dari Kitsu  */
/* yang memang ramah server: media.kitsu.app.                          */
/* ------------------------------------------------------------------ */

const KITSU_BASE = "https://kitsu.io/api/edge";

type KitsuAnime = {
  id: string;
  attributes: {
    canonicalTitle?: string;
    titles?: Record<string, string>;
    abbreviatedTitles?: string[];
    subtype?: string;
    status?: string;
    averageRating?: string | null;
    episodeCount?: number | null;
    synopsis?: string | null;
    posterImage?: Record<string, string> | null;
    coverImage?: Record<string, string> | null;
  };
};

const normTitle = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * GET /api/poster?title=<judul>
 * Cari anime di Kitsu berdasarkan judul; utamakan yang judulnya persis
 * sama (canonical/alias), selain itu hasil teratas yang berposter.
 * Balas: poster, cover, rating, jumlah episode, sinopsis — siap pakai
 * sebagai pengganti poster AnimeIn. Cache publik 24 jam.
 */
app.get("/api/poster", async (c) => {
  const title = (c.req.query("title") ?? "").trim();
  if (!title) return c.json({ ok: false, error: { message: "parameter title wajib ada" } }, 400);
  const url = `${KITSU_BASE}/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=5`;
  let list: KitsuAnime[] = [];
  try {
    const res = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
    if (!res.ok) {
      return c.json({ ok: false, error: { message: `Kitsu menjawab ${res.status}`, upstream_status: res.status } }, 502);
    }
    const body = (await res.json()) as { data?: KitsuAnime[] };
    list = body.data ?? [];
  } catch (err) {
    return c.json(
      { ok: false, error: { message: "Kitsu tidak terjangkau", detail: err instanceof Error ? err.message : String(err) } },
      502,
    );
  }
  const wanted = normTitle(title);
  const namesOf = (a: KitsuAnime) =>
    [a.attributes.canonicalTitle ?? "", ...Object.values(a.attributes.titles ?? {}), ...(a.attributes.abbreviatedTitles ?? [])].map(normTitle);
  const pick =
    list.find((a) => namesOf(a).includes(wanted)) ??
    list.find((a) => a.attributes.posterImage) ??
    list[0];
  if (!pick) return c.json({ ok: false, error: { message: "tidak ketemu di Kitsu", title } }, 404);
  const at = pick.attributes;
  const img = (m?: Record<string, string> | null) => m?.large ?? m?.original ?? m?.medium ?? null;
  return c.json(
    {
      ok: true,
      data: {
        kitsu_id: pick.id,
        title: at.canonicalTitle ?? title,
        match: namesOf(pick).includes(wanted) ? "exact" : "closest",
        subtype: at.subtype ?? null,
        status: at.status ?? null,
        rating: at.averageRating ? Number(at.averageRating) : null,
        episodes: at.episodeCount ?? null,
        synopsis: at.synopsis ?? null,
        poster: img(at.posterImage),
        cover: img(at.coverImage),
      },
    },
    200,
    { "Cache-Control": "public, max-age=86400" },
  );
});

app.notFound((c) => c.json({ ok: false, error: { message: "route tidak ditemukan" } }, 404));

export default app;
