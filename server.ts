import { clientJs, indexHtml, stylesCss } from "./lib/assets";
import { SONGS_DIR, createFile, getFile, getRepoTree } from "./lib/github";
import { parseFrontmatter, renderMarkdown } from "./lib/markdown";
import type { Song, SongListItem } from "./lib/types";

const OPENROUTER_URL = process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2.6-pro";
const OPENROUTER_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const html = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const css = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/css; charset=utf-8" } });
const js = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 500) => json({ error: message }, status);

// ---------------------------------------------------------------------------
// Song catalog
// ---------------------------------------------------------------------------

interface CatalogEntry extends SongListItem {
  path: string;
}

let catalog: { at: number; data: CatalogEntry[] } | null = null;
const CATALOG_TTL = 60_000;

/** Map with a bounded number of concurrent tasks. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function titleFromName(name: string): string {
  return name
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/** List songs with metadata (title/author from frontmatter), cached briefly. */
async function getCatalog(): Promise<CatalogEntry[]> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.data;

  const { entries } = await getRepoTree();
  const prefix = `${SONGS_DIR}/`;
  const files = entries.filter(
    (e) =>
      e.type === "blob" &&
      e.path.startsWith(prefix) &&
      !e.path.slice(prefix.length).includes("/") &&
      /\.(md|markdown)$/i.test(e.path),
  );

  const data = await mapLimit(files, 8, async (entry): Promise<CatalogEntry> => {
    const name = entry.path.slice(prefix.length);
    try {
      const file = await getFile(entry.path);
      const { meta } = parseFrontmatter(file.content);
      return { name, path: entry.path, title: meta.title || titleFromName(name), author: meta.author };
    } catch {
      return { name, path: entry.path, title: titleFromName(name), author: "" };
    }
  });

  data.sort((a, b) => a.title.localeCompare(b.title, "cs"));
  catalog = { at: Date.now(), data };
  return data;
}

function publicList(entries: CatalogEntry[]): SongListItem[] {
  return entries.map(({ name, title, author }) => ({ name, title, author }));
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function apiGetSongs(): Promise<Response> {
  try {
    return json({ songs: publicList(await getCatalog()) });
  } catch (error) {
    return fail(message(error));
  }
}

async function apiGetSong(request: Request): Promise<Response> {
  try {
    const name = new URL(request.url).searchParams.get("name") ?? "";
    if (!name || name.includes("/") || name.includes("..")) {
      return fail("Neplatný název souboru.", 400);
    }
    const file = await getFile(`${SONGS_DIR}/${name}`);
    const { meta, body } = parseFrontmatter(file.content);
    const song: Song = {
      name,
      meta: { ...meta, title: meta.title || titleFromName(name) },
      markdown: body,
      html: renderMarkdown(body),
    };
    const sameAuthor = song.meta.author
      ? publicList(
          (await getCatalog()).filter(
            (s) => s.author === song.meta.author && s.name !== name,
          ),
        )
      : [];
    return json({ song, sameAuthor });
  } catch (error) {
    return fail(message(error), 404);
  }
}

interface AddSongBody {
  name?: string;
  title?: string;
  author?: string;
  year?: string | number;
  markdown?: string;
}

function slugify(value: string): string {
  const map: Record<string, string> = {
    á: "a", ä: "a", â: "a", à: "a", č: "c", ć: "c", ď: "d", é: "e", ě: "e",
    ë: "e", è: "e", í: "i", ï: "i", ĺ: "l", ľ: "l", ň: "n", ó: "o", ö: "o",
    ô: "o", ř: "r", ŕ: "r", š: "s", ś: "s", ť: "t", ú: "u", ů: "u", ü: "u",
    ý: "y", ž: "z", ź: "z", ą: "a", ę: "e", ł: "l", ń: "n", ż: "z",
  };
  return value
    .toLowerCase()
    .replace(/[áäâàčćďéěëèíïĺľňóöôřŕšťúůüýžźąęłńśż]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function yamlString(value: string): string {
  return JSON.stringify(value); // a JSON string is a valid YAML double-quoted scalar
}

async function apiAddSong(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as AddSongBody;
    const title = (body.title ?? "").trim();
    const markdown = (body.markdown ?? "").trim();
    if (!title) return fail("Chybí název písně.", 400);
    if (!markdown) return fail("Chybí text písně (markdown).", 400);

    const base = slugify(body.name || title) || "pisen";
    const frontmatter = [
      "---",
      `title: ${yamlString(title)}`,
      `author: ${yamlString((body.author ?? "").trim())}`,
      `year: ${yamlString(String(body.year ?? "").trim())}`,
      "---",
      "",
    ].join("\n");
    const content = `${frontmatter}${markdown}\n`;

    // Create the file, adding a numeric suffix if the name is already taken.
    for (let attempt = 0; attempt < 25; attempt++) {
      const name = attempt === 0 ? `${base}.md` : `${base}-${attempt + 1}.md`;
      try {
        const { sha } = await createFile(
          `${SONGS_DIR}/${name}`,
          content,
          `Přidat píseň: ${title}`,
        );
        catalog = null;
        return json({ name, sha, title });
      } catch (error) {
        if (!/ 422| 409/.test(message(error))) throw error;
      }
    }
    return fail("Nepodařilo se vytvořit soubor (kolize názvů).", 409);
  } catch (error) {
    return fail(message(error));
  }
}

interface LlmBody {
  messages?: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
}

async function apiLlm(request: Request): Promise<Response> {
  if (!OPENROUTER_KEY) return fail("Chybí OPENROUTER_API_KEY.", 500);
  try {
    const body = (await request.json()) as LlmBody;
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: body.messages ?? [],
        tools: body.tools,
        tool_choice: body.tool_choice ?? (body.tools ? "auto" : undefined),
      }),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return fail(message(error));
  }
}

async function apiFetchWebpage(request: Request): Promise<Response> {
  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url) return fail("Chybí url.", 400);
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return fail("Neplatná URL.", 400);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return fail("Povoleny jsou jen adresy http/https.", 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(target.href, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ZpevnikBot/1.0; +https://github.com/zbycz/zpevnik)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return fail(`Stránku nelze načíst (HTTP ${res.status}).`, 502);

    const raw = await res.text();
    const title = extractTitle(raw) || target.href;
    const text = htmlToText(raw).slice(0, 20_000);
    return json({ url: res.url || target.href, title, text });
  } catch (error) {
    return fail(message(error), 502);
  }
}

function extractTitle(htmlText: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(htmlText);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function htmlToText(htmlText: string): string {
  return decodeEntities(
    htmlText
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
    mdash: "—", ndash: "–", laquo: "«", raquo: "»", copy: "©", reg: "®",
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  routes: {
    "/": () => html(indexHtml),
    "/styles.css": () => css(stylesCss),
    "/app.js": () => js(clientJs),
    "/favicon.ico": () => new Response(null, { status: 204 }),

    "/api/get-songs": { GET: () => apiGetSongs() },
    "/api/get-song": { GET: (request) => apiGetSong(request) },
    "/api/add-song": { POST: (request) => apiAddSong(request) },
    "/api/llm": { POST: (request) => apiLlm(request) },
    "/api/fetch-webpage": { POST: (request) => apiFetchWebpage(request) },

    // Client-side routes (SPA): everything else renders the shell.
    "/*": () => html(indexHtml),
  },
  fetch() {
    return new Response("Not found", { status: 404, headers: TEXT });
  },
});

console.log(`Zpěvník běží na ${server.url} (Bun ${process.versions.bun})`);
