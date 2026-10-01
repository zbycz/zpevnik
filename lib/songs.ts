import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SONGS_DIR } from "./github";
import { parseFrontmatter, renderMarkdown } from "./markdown";
import type { Song, SongListItem } from "./types";

/**
 * Songs are read from the local `pisnicky/` directory that ships with the
 * deployment (`includeFiles` in `vercel.json`). This makes the list, detail,
 * and search instant instead of round-tripping to the GitHub API. The API is
 * only kept as a fallback for a song committed after the current deployment.
 */
let cachedDir: string | null = null;

function songsDir(): string {
  if (cachedDir) return cachedDir;
  const here = import.meta.dir ?? process.cwd();
  const candidates = [
    join(here, SONGS_DIR),
    join(here, "..", SONGS_DIR),
    join(process.cwd(), SONGS_DIR),
    join(dirname(here), "..", SONGS_DIR),
  ];
  cachedDir = candidates.find((dir) => existsSync(dir)) ?? candidates[0];
  return cachedDir;
}

export function titleFromName(name: string): string {
  return name
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/** File-name slug used for a song's static page (no `.md` extension). */
export function songSlug(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function isSongFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/** List all songs with title/author from their frontmatter, sorted by title. */
export function listSongs(): SongListItem[] {
  let files: string[];
  try {
    files = readdirSync(songsDir()).filter(isSongFile);
  } catch {
    return [];
  }

  const songs = files.map((name): SongListItem => {
    try {
      const raw = readFileSync(join(songsDir(), name), "utf8");
      const { meta } = parseFrontmatter(raw);
      return { name, title: meta.title || titleFromName(name), author: meta.author };
    } catch {
      return { name, title: titleFromName(name), author: "" };
    }
  });

  songs.sort((a, b) => a.title.localeCompare(b.title, "cs"));
  return songs;
}

/** Read a single song from disk; returns null when the file is not present. */
export function getLocalSong(name: string): Song | null {
  const path = join(songsDir(), name);
  if (!isSongFile(name) || !existsSync(path)) return null;

  const raw = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    name,
    meta: { ...meta, title: meta.title || titleFromName(name) },
    markdown: body,
    html: renderMarkdown(body),
  };
}
