import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLocalSong, listSongs, songSlug } from "../lib/songs";
import { readWebFile, renderHomeHtml, renderSongHtml, webDir } from "../lib/render";

/**
 * Build step (run by Vercel via `bun run build`): turns `pisnicky/*.md` and the
 * client sources in `web/` into a static site in `public/`. Vercel's Bun preset
 * bundles `public/` into the function (`includeFiles`), so `server.ts` serves the
 * pre-rendered pages directly instead of calling the API at view time.
 */
const PUBLIC_DIR = join(webDir(), "..", "public");

rmSync(PUBLIC_DIR, { recursive: true, force: true });
mkdirSync(join(PUBLIC_DIR, "song"), { recursive: true });

writeFileSync(join(PUBLIC_DIR, "index.html"), renderHomeHtml(listSongs()));
writeFileSync(join(PUBLIC_DIR, "styles.css"), readWebFile("styles.css"));
writeFileSync(join(PUBLIC_DIR, "songs.json"), JSON.stringify({ songs: listSongs() }));

const build = await Bun.build({
  entrypoints: [join(webDir(), "app.ts")],
  target: "browser",
  outdir: PUBLIC_DIR,
  naming: "app.js",
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  throw new Error("Nepodařilo se sestavit klientský JavaScript.");
}

let count = 0;
for (const song of listSongs()) {
  const detail = getLocalSong(song.name);
  if (!detail) continue;
  const sameAuthor = detail.meta.author
    ? listSongs().filter((s) => s.author === detail.meta.author && s.name !== song.name)
    : [];
  const file = `${songSlug(song.name)}.html`;
  writeFileSync(join(PUBLIC_DIR, "song", file), renderSongHtml(detail, sameAuthor));
  count++;
}

console.log(`Vygenerováno ${count} stránek písní + úvodní stránka do public/.`);
