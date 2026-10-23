/**
 * rest-anim sebagai server Node biasa (VPS / Termux / mesin lokal).
 *
 * App Hono yang sama persis dengan versi Workers & Vercel (src/index.ts) —
 * hanya transportnya yang diganti @hono/node-server.
 * Env proses diteruskan sebagai bindings Hono, jadi UPSTREAM_BASE_URL
 * dan PORT dibaca dari environment seperti biasa.
 *
 * Jalan:  npm run start        (PORT bawaan 8787)
 */
import { serve } from "@hono/node-server";
import app from "./index.ts";

const port = Number(process.env.PORT ?? 8787);

serve(
  {
    fetch: (req: Request) => app.fetch(req, process.env),
    port,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`rest-anim (node) jalan di http://0.0.0.0:${info.port}`);
  },
);
