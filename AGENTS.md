# AGENTS.md

## What this is

A Czech songbook (zpěvník) served by a single Bun `Bun.serve()` server, deployed to
Vercel with the **Bun framework preset** (`bunVersion` in `vercel.json` + `bun.lock` +
`server.ts`). There is **no build step**: TypeScript runs directly on Bun.

## Commands

```bash
bun install                       # creates/updates bun.lock (required by the Vercel preset)
bun run dev                       # local server (bun --hot)
bun run typecheck                 # tsc --noEmit
GITHUB_PAT=... bun run scripts/seed-songs.ts   # add demo songs to pisnicky/
```

## Architecture

- `server.ts` - all routes. API handlers plus the SPA shell. Client TS is served at
  `/app.js` via `Bun.Transpiler` (transpiled once at startup), HTML/CSS via text imports.
- `lib/github.ts` - GitHub REST (tree, contents read, contents write). `GITHUB_API_URL`
  can override the API base (used for local mocking / GH Enterprise).
- `lib/markdown.ts` - frontmatter via `Bun.YAML`, rendering via `Bun.markdown`.
- `public/app.ts` - browser code: router, song view, search autosuggest, and the
  in-browser agent harness for `/add`.
- Songs live in `pisnicky/` on the default branch. Frontmatter: `title`, `author`, `year`.

## Environment variables

`GITHUB_PAT` (read), `GITHUB_WRITE_PAT` (write, falls back to `GITHUB_PAT`),
`OPENROUTER_API_KEY`. Optional: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_SONGS_DIR`,
`OPENROUTER_MODEL`, `OPENROUTER_URL`, `GITHUB_API_URL`.

## Gotchas

- Do not remove `bun.lock`; the Vercel Bun preset requires it. `bun install` deletes an
  empty lockfile, so `package.json` intentionally has dev-only deps (`@types/bun`,
  `typescript`) to keep the lockfile non-empty.
- The agent runs in the browser and orchestrates `/api/llm` + `/api/fetch-webpage`; the
  final answer must be a JSON object which the UI turns into an editable draft before
  `POST /api/add-song`.
