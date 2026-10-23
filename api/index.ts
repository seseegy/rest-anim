/**
 * Pintu masuk Vercel — app Hono yang sama persis dengan versi Workers
 * (src/index.ts), dibungkus handler hono/vercel.
 * Semua path diarahkan ke sini oleh rewrites di vercel.json.
 */
import { handle } from "hono/vercel";
import app from "../src/index.js";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
