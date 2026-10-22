/**
 * Vercel serverless catch-all for /api/*
 * Static HTML is served from /public (copied from site/ at build).
 */
import { handleApi } from "../server.mjs";

export default async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const rawUrl = req.url || "/";
    const url = new URL(rawUrl, `${proto}://${host}`);

    // Normalize catch-all paths to /api/...
    if (!url.pathname.startsWith("/api/")) {
      const segments = req.query?.path;
      const parts = Array.isArray(segments)
        ? segments
        : segments
          ? [segments]
          : [];
      url.pathname = "/api/" + parts.map(encodeURIComponent).join("/");
    }

    await handleApi(req, res, url);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: err.message || "Server error" }));
  }
}
