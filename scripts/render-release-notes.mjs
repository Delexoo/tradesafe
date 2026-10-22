import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = path.join(root, "brain", "log.json");
const outPath = path.join(root, "brain", "releases.json");

const log = JSON.parse(fs.readFileSync(logPath, "utf8"));
const repo = String(log.repo || "tradesafe");
const product = String(log.product || "TradeSafe");

for (const update of log.updates) checkUpdate(update);

const releases = {
  product,
  repo,
  updates: log.updates.map((update) => ({
    version: update.version,
    date: update.date,
    title: update.title,
    tag: `v${update.version}`,
    sections: update.sections,
  })),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(releases, null, 2)}\n`);
console.log(
  `Release notes rendered for ${product}: ${releases.updates.map((u) => u.version).join(", ")}.`,
);

function checkUpdate(update) {
  if (!Array.isArray(update.sections) || update.sections.length === 0) {
    throw new Error(`${update.version} needs sections.`);
  }
  let count = 0;
  for (const section of update.sections) {
    if (section.notes) {
      throw new Error(
        `${update.version} ${section.heading} uses notes. Use added and fixes.`,
      );
    }
    for (const key of ["added", "fixes"]) {
      const notes = section[key];
      if (notes == null) continue;
      if (
        !Array.isArray(notes) ||
        notes.some((note) => typeof note !== "string" || !note.trim())
      ) {
        throw new Error(
          `${update.version} ${section.heading} has a bad ${key} list.`,
        );
      }
      count += notes.length;
    }
    if (!section.added?.length && !section.fixes?.length) {
      throw new Error(
        `${update.version} ${section.heading} has no added or fixes.`,
      );
    }
  }
  if (count === 0) throw new Error(`${update.version} has no notes.`);
}
