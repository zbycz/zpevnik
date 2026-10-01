/**
 * Web access helpers.
 *
 * Vercel Functions run from datacenter IPs, so search engines and lyric sites
 * frequently answer with CAPTCHAs / 403s. Three strategies are used:
 *   1. A purpose-built, free, no-token lyrics API (LRCLIB) - no scraping at all.
 *   2. Search via Bing / DuckDuckGo HTML, which still serve datacenter IPs.
 *   3. A readable-page proxy (r.jina.ai) as a fallback for pages that block us.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BOT_UA = "ZpevnikBot/1.0 (+https://github.com/zbycz/zpevnik)";
const JINA_READER = "https://r.jina.ai/";

export interface PageResult {
  url: string;
  title: string;
  text: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface LyricsResult {
  artist: string;
  track: string;
  album: string;
  lyrics: string;
}

/** Fetch a URL with a timeout; returns the raw response (no redirect/status checks). */
async function get(
  url: string,
  { timeoutMs = 15_000, ua = BROWSER_UA, accept }: { timeoutMs?: number; ua?: string; accept?: string } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": ua,
        Accept: accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "cs,sk;q=0.9,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Pages that returned a bot check / empty shell instead of content. */
function looksBlocked(text: string): boolean {
  const sample = text.slice(0, 4000).toLowerCase();
  return (
    sample.includes("captcha") ||
    sample.includes("unusual traffic") ||
    sample.includes("complete the following challenge") ||
    sample.includes("making sure you're not a bot") ||
    sample.includes("přetížená") ||
    sample.includes("nejsem robot") ||
    sample.includes("ověř, že nejsi robot") ||
    sample.includes("enable javascript and cookies to continue") ||
    text.trim().length < 300
  );
}

// ---------------------------------------------------------------------------
// Page fetching
// ---------------------------------------------------------------------------

/** Fetch a page and return readable text, falling back to a reader proxy. */
export async function fetchWebpage(url: string): Promise<PageResult> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Povoleny jsou jen adresy http/https.");
  }

  let directError = "";
  try {
    const res = await get(target.href);
    if (res.ok) {
      const raw = await res.text();
      const text = htmlToText(raw).slice(0, 20_000);
      if (!looksBlocked(text)) {
        return { url: res.url || target.href, title: extractTitle(raw) || target.href, text };
      }
      directError = "stránka vrátila bot-check nebo prázdný obsah";
    } else {
      directError = `HTTP ${res.status}`;
    }
  } catch (error) {
    directError = message(error);
  }

  // Fallback: r.jina.ai renders the page server-side (free, no key for basic use).
  try {
    const res = await get(`${JINA_READER}${target.href}`, { timeoutMs: 30_000, ua: BOT_UA });
    if (res.ok) {
      const body = await res.text();
      const parsed = parseJina(body, target.href);
      if (parsed.text && !looksBlocked(parsed.text)) return parsed;
      throw new Error("proxy také vrátil bot-check");
    }
    throw new Error(`proxy HTTP ${res.status}`);
  } catch (error) {
    throw new Error(`Stránku nelze načíst (${directError}; ${message(error)}).`);
  }
}

/** r.jina.ai returns "Title: ...", "URL Source: ...", "Markdown Content:" then the body. */
function parseJina(body: string, fallbackUrl: string): PageResult {
  const titleMatch = /^Title:\s*(.*)$/m.exec(body);
  const urlMatch = /^URL Source:\s*(.*)$/m.exec(body);
  const marker = body.indexOf("Markdown Content:");
  const text = (marker >= 0 ? body.slice(marker + "Markdown Content:".length) : body).trim();
  return {
    url: urlMatch?.[1]?.trim() || fallbackUrl,
    title: titleMatch?.[1]?.trim() || fallbackUrl,
    text: text.slice(0, 20_000),
  };
}

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

/** Search the web without an API key. Returns results from the first engine that answers. */
export async function searchWeb(query: string): Promise<{ engine: string; results: SearchResult[] }> {
  const errors: string[] = [];

  const engines: { name: string; run: () => Promise<SearchResult[]> }[] = [
    { name: "bing", run: () => searchBing(query) },
    { name: "duckduckgo", run: () => searchDuckDuckGo(query) },
    { name: "jina", run: () => searchViaJina(query) },
  ];

  // Engines occasionally rate-limit a single request; retry the whole chain once.
  for (let pass = 0; pass < 2; pass++) {
    for (const engine of engines) {
      try {
        const results = await engine.run();
        if (results.length > 0) return { engine: engine.name, results: results.slice(0, 8) };
      } catch (error) {
        errors.push(`${engine.name}: ${message(error)}`);
      }
    }
    if (pass === 0) await sleep(700);
  }
  throw new Error(`Vyhledávání selhalo (${errors.join("; ")}).`);
}

async function searchBing(query: string): Promise<SearchResult[]> {
  const res = await get(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=cs`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  const results: SearchResult[] = [];
  for (const block of raw.split(/<li class="b_algo"/).slice(1)) {
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    results.push({
      url: decodeBingUrl(decodeEntities(link[1])),
      title: clean(link[2]),
      snippet: clean(snippet?.[1] ?? ""),
    });
  }
  return results;
}

/** Bing wraps results in /ck/a?...&u=a1<base64url>; unwrap it to the real URL. */
function decodeBingUrl(href: string): string {
  try {
    const u = new URL(href).searchParams.get("u");
    if (!u || !u.startsWith("a1")) return href;
    const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf8") || href;
  } catch {
    return href;
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const res = await get(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  if (looksBlocked(raw)) throw new Error("bot-check");
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]+class=['"]result-link['"][^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  const snippets = [...raw.matchAll(snippetRe)].map((m) => clean(m[1]));
  let i = 0;
  for (const m of raw.matchAll(linkRe)) {
    results.push({ url: decodeEntities(m[1]), title: clean(m[2]), snippet: snippets[i++] ?? "" });
  }
  return results;
}

async function searchViaJina(query: string): Promise<SearchResult[]> {
  const res = await get(`${JINA_READER}https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    timeoutMs: 30_000,
    ua: BOT_UA,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const m of body.matchAll(linkRe)) {
    const url = m[2];
    if (/bing\.com|microsoft\.com|go\.microsoft/.test(url)) continue;
    results.push({ title: m[1].trim(), url, snippet: "" });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Lyrics search (LRCLIB - free, no token)
// ---------------------------------------------------------------------------

/** Search a purpose-built lyrics database; avoids scraping lyric sites entirely. */
export async function searchLyrics(query: string): Promise<LyricsResult[]> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await get(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
        timeoutMs: 15_000,
        ua: BOT_UA,
        accept: "application/json",
      });
      if (res.status === 503) {
        lastError = "LRCLIB je zaneprázdněný";
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return [];
      return data
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .filter((item) => typeof item.plainLyrics === "string" && (item.plainLyrics as string).trim())
        .slice(0, 5)
        .map((item) => ({
          artist: str(item.artistName),
          track: str(item.trackName),
          album: str(item.albumName),
          lyrics: (item.plainLyrics as string).trim().slice(0, 6000),
        }));
    } catch (error) {
      lastError = message(error);
      await sleep(500);
    }
  }
  throw new Error(`Hledání textu selhalo (${lastError}).`);
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
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

function clean(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
