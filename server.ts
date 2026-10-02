import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clientJs,
  publicDir,
  renderHomeHtml,
  renderShellHtml,
  stylesCss,
} from "./lib/render";
import { SONGS_DIR, createFile, getFile } from "./lib/github";
import { parseFrontmatter, renderMarkdown } from "./lib/markdown";
import { getLocalSong, listSongs, titleFromName } from "./lib/songs";
import { fetchWebpage, searchLyrics, searchWeb } from "./lib/web";

const OPENROUTER_URL = process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash";
const OPENROUTER_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? "";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
const css = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/css; charset=utf-8" } });
const js = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 500) => json({ error: message }, status);

/** Read a generated file from `public/` (present after a build); null if missing. */
function builtFile(rel: string): string | null {
  const path = join(publicDir(), rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function apiGetSongs(): Promise<Response> {
  try {
    return json({ songs: listSongs() });
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

    // Songs ship with the deployment, so this is instant. A song committed
    // after the last deploy is not on disk yet - fall back to the GitHub API.
    let song = getLocalSong(name);
    if (!song) {
      const file = await getFile(`${SONGS_DIR}/${name}`);
      const { meta, body } = parseFrontmatter(file.content);
      song = {
        name,
        meta: { ...meta, title: meta.title || titleFromName(name) },
        markdown: body,
        html: renderMarkdown(body),
      };
    }

    const sameAuthor = song.meta.author
      ? listSongs().filter((s) => s.author === song.meta.author && s.name !== name)
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
    return json(await fetchWebpage(url));
  } catch (error) {
    return fail(message(error), 502);
  }
}

async function apiSearchWeb(request: Request): Promise<Response> {
  try {
    const { query } = (await request.json()) as { query?: string };
    const q = (query ?? "").trim();
    if (!q) return fail("Chybí dotaz.", 400);
    return json(await searchWeb(q));
  } catch (error) {
    return fail(message(error), 502);
  }
}

async function apiSearchLyrics(request: Request): Promise<Response> {
  try {
    const { query } = (await request.json()) as { query?: string };
    const q = (query ?? "").trim();
    if (!q) return fail("Chybí dotaz.", 400);
    return json({ results: await searchLyrics(q) });
  } catch (error) {
    return fail(message(error), 502);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  routes: {
    // Pages and assets are pre-rendered into `public/` by `bun run build` and
    // bundled into the function via `includeFiles`, so these routes serve the
    // built files directly. Without a build they fall back to rendering.
    "/": () => html(builtFile("index.html") ?? renderHomeHtml(listSongs())),
    "/add": () => html(renderShellHtml()),
    // Songs are pre-rendered to static HTML at build time; the server only
    // serves the built page, or a shell for a song that is not deployed yet.
    "/song/:name": ({ params }) => {
      const built = builtFile(`song/${params.name}.html`);
      return built ? html(built) : html(renderShellHtml());
    },
    "/styles.css": () => css(builtFile("styles.css") ?? stylesCss()),
    "/app.js": () => js(builtFile("app.js") ?? clientJs()),
    "/songs.json": () => new Response(builtFile("songs.json") ?? JSON.stringify({ songs: listSongs() }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    "/favicon.ico": () => new Response(null, { status: 204 }),

    "/api/get-songs": { GET: () => apiGetSongs() },
    "/api/get-song": { GET: (request) => apiGetSong(request) },
    "/api/add-song": { POST: (request) => apiAddSong(request) },
    "/api/llm": { POST: (request) => apiLlm(request) },
    "/api/fetch-webpage": { POST: (request) => apiFetchWebpage(request) },
    "/api/search-web": { POST: (request) => apiSearchWeb(request) },
    "/api/search-lyrics": { POST: (request) => apiSearchLyrics(request) },

    // Unknown paths: nothing static and no API - a plain 404, no shell.
    "/*": () =>
      html(
        '<!doctype html><meta charset=utf-8><title>404</title><h1>404 – stránka nenalezena</h1><p><a href="/">Zpět na zpěvník</a></p>',
        404,
      ),
  },
  fetch() {
    return new Response("Not found", { status: 404, headers: TEXT });
  },
});

console.log(`Zpěvník běží na ${server.url} (Bun ${process.versions.bun})`);
