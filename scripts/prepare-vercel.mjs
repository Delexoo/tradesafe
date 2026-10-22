import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const pub = path.join(root, "public");

fs.rmSync(pub, { recursive: true, force: true });
fs.cpSync(site, pub, { recursive: true });
// Avoid nested vercel config confusing the deploy
const nested = path.join(pub, "vercel.json");
if (fs.existsSync(nested)) fs.unlinkSync(nested);

console.log("Prepared public/ from site/ for Vercel static hosting.");
