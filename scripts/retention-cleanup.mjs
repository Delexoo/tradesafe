/**
 * Retention cleanup for security tables.
 * Usage: node scripts/retention-cleanup.mjs [--apply]
 * Default is dry-run.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runRetentionCleanup, RETENTION_DAYS } from "../lib/retention.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await runRetentionCleanup(admin, { dryRun: !apply });
console.log(JSON.stringify({ retentionDays: RETENTION_DAYS, apply, result }, null, 2));
