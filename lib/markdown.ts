import type { SongMeta } from "./types";

export interface ParsedMarkdown {
  meta: SongMeta;
  body: string;
}

/**
 * Split a markdown document into YAML frontmatter and body.
 * Uses Bun's built-in YAML parser when the frontmatter is a mapping.
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: { title: "", author: "", year: "" }, body: normalized };

  const body = normalized.slice(match[0].length);
  const meta: SongMeta = { title: "", author: "", year: "" };

  try {
    const yaml = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(
      match[1],
    );
    if (yaml && typeof yaml === "object") {
      const record = yaml as Record<string, unknown>;
      meta.title = str(record.title);
      meta.author = str(record.author);
      meta.year = str(record.year ?? record.rok ?? record.issued ?? record.date);
    }
  } catch {
    // Not valid YAML - keep empty metadata, still render the body.
  }

  return { meta, body };
}

/**
 * Render markdown to HTML with Bun's built-in renderer.
 * Single line breaks are kept (lyrics are written one line per row).
 */
export function renderMarkdown(markdown: string): string {
  const withHardBreaks = markdown.replace(/([^\n])\n(?!\n)/g, "$1  \n");
  return (Bun as unknown as { markdown: { html(s: string): string } }).markdown.html(
    withHardBreaks,
  );
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}
