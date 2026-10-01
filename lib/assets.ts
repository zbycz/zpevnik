import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Static client assets.
 *
 * They are read from disk at runtime instead of being imported as text:
 * Vercel bundles the entrypoint with rolldown, which cannot parse `.html`
 * imports, and Bun's `with { type: "text" }` imports are not supported in
 * Vercel's `Bun.serve()` routes either. `vercel.json` ships `public/**` via
 * `includeFiles` so the files sit next to the bundled server.
 */
function findPublicDir(): string {
  const here = import.meta.dir ?? process.cwd();
  const candidates = [
    join(here, "public"),
    join(here, "..", "public"),
    join(dirname(here), "public"),
    join(process.cwd(), "public"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? candidates[0];
}

const PUBLIC_DIR = findPublicDir();
const read = (name: string): string => readFileSync(join(PUBLIC_DIR, name), "utf8");

export const indexHtml = read("index.html");
export const stylesCss = read("styles.css");

/** Browser TypeScript, transpiled once at startup. */
export const clientJs = new Bun.Transpiler({ loader: "ts" }).transformSync(read("app.ts"));
