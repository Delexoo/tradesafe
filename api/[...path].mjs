/**
 * Vercel serverless catch-all for /api/*
 */
import { handleApi } from "../server.mjs";

export default async function handler(req, res) {
  req._pendingCookies = [];
  try {
    const host = req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url || "/", `${proto}://${host}`);

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
    const cookies = req._pendingCookies || [];
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    res.statusCode = Number(err.status) || 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: err.message || "Server error" }));
  }
}
