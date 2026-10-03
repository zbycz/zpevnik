import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SONGS_DIR, githubEditUrl } from "./github";
import type { Song, SongListItem } from "./types";

/**
 * Server-side rendering shared by the build step (`scripts/build.ts`, which
 * writes static HTML) and the Bun server (the `/add` shell and the API
 * fallback for a song that is not deployed yet).
 */

/** Directory with the client sources (HTML shell, CSS, browser TS). */
export function webDir(): string {
  const here = import.meta.dir ?? process.cwd();
  const candidates = [
    join(here, "web"),
    join(here, "..", "web"),
    join(process.cwd(), "web"),
    join(dirname(here), "..", "web"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? candidates[0];
}

export function readWebFile(name: string): string {
  return readFileSync(join(webDir(), name), "utf8");
}

/** Directory with the generated static site (`scripts/build.ts` output). */
export function publicDir(): string {
  const here = import.meta.dir ?? process.cwd();
  const candidates = [
    join(here, "public"),
    join(here, "..", "public"),
    join(process.cwd(), "public"),
    join(dirname(here), "..", "public"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? candidates[0];
}

function builtFile(rel: string): string | null {
  const path = join(publicDir(), rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Generated stylesheet if a build ran, otherwise the source. */
export function stylesCss(): string {
  return builtFile("styles.css") ?? readWebFile("styles.css");
}

/** Built client bundle if a build ran, otherwise transpiled at startup. */
export function clientJs(): string {
  return (
    builtFile("app.js") ??
    new Bun.Transpiler({ loader: "ts" }).transformSync(readWebFile("app.ts"))
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute URL path of a song's static page (matches `cleanUrls`). */
export function songPath(name: string): string {
  return `/song/${encodeURIComponent(name.replace(/\.(md|markdown)$/i, ""))}`;
}

function songListHtml(songs: SongListItem[]): string {
  return songs
    .map(
      (song) =>
        `<li><a href="${songPath(song.name)}">${escapeHtml(song.title)}${
          song.author ? `<span class="by">${escapeHtml(song.author)}</span>` : ""
        }</a></li>`,
    )
    .join("");
}

function layout(title: string, body: string): string {
  const html = readWebFile("index.html");
  return html
    .replace("<title>Zpěvník</title>", `<title>${escapeHtml(title)}</title>`)
    .replace('<main id="app" aria-live="polite"></main>', `<main id="app" aria-live="polite">${body}</main>`);
}

/** Home page with the full song list (static, no API call). */
export function renderHomeHtml(songs: SongListItem[]): string {
  const list = songs.length
    ? `<ul class="song-list">${songListHtml(songs)}</ul>`
    : `<p class="muted">Zatím tu nejsou žádné písně. Přidej první pomocí vyhledávání.</p>`;
  const body = `<h1>Zpěvník</h1><p class="muted">${songs.length} písní</p>${list}`;
  return layout("Zpěvník", body);
}

/** A song's static page. */
export function renderSongHtml(song: Song, sameAuthor: SongListItem[]): string {
  const meta = [song.meta.author, song.meta.year].filter(Boolean).map(escapeHtml).join(" · ");
  const same = sameAuthor.length
    ? `<h2>Další písně od ${escapeHtml(song.meta.author)}</h2><ul class="song-list">${songListHtml(sameAuthor)}</ul>`
    : "";
  const data = JSON.stringify({ song, sameAuthor }).replace(/</g, "\\u003c");
  const editUrl = githubEditUrl(`${SONGS_DIR}/${song.name}`);
  const body = `
        <a class="back" href="/">← Domů</a>
        <h1>${escapeHtml(song.meta.title)}</h1>
        <p class="song-meta">${meta}</p>
        <p class="song-actions"><a class="edit-link" href="${editUrl}" target="_blank" rel="noopener">✏️ Upravit na GitHubu</a></p>
        <article class="song-body">${song.html}</article>
        ${same}
        <script type="application/json" id="song-data">${data}</script>
      `;
  return layout(`${song.meta.title} – Zpěvník`, body);
}

/** Client-side shell without content, for `/add` and other SPA routes. */
export function renderShellHtml(): string {
  return layout("Zpěvník", "");
}
