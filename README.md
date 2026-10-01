# Zpěvník

Jednoduchá aplikace bez závislostí, která běží na [Bun](https://bun.com) runtime
na Vercelu. TypeScript se nijak nekompiluje - Bun ho spouští přímo (server i klient).

## Co to umí

- **Domů** - vypíše písně ze složky `pisnicky/` v tomto repozitáři (živě přes GitHub API).
- **Píseň** - po kliknutí zobrazí markdown. Z frontmatteru (`title`, `author`, `year`)
  se vezme název, autor a rok. Dole jsou písně stejného autora.
- **Vyhledat** - našeptávač hledá v názvech/autorů; když nic nesedí, nabídne
  „Přidat". To otevře `/add?query=...`, kde běží jednoduchý agent (OpenRouter)
  s jediným nástrojem `fetch_webpage`. Výsledek se zobrazí k úpravě a uloží se
  commitem do `pisnicky/`.

## Struktura

```
server.ts            Bun.serve() - routy, API a servírování klienta
lib/github.ts        GitHub REST API (strom, čtení, zápis)
lib/markdown.ts      frontmatter (Bun.YAML) + markdown (Bun.markdown)
lib/types.ts         sdílené typy
public/index.html    HTML shell
public/styles.css    responzivní styl, dark mode dle systému
public/app.ts        klientský TypeScript (routing, našeptávač, agent)
scripts/seed-songs.ts ukázková data do pisnicky/
vercel.json          bunVersion: 1.4.x
```

Klient se servíruje přes `Bun.Transpiler` v `/app.js` (za běhu, bez build kroku).

## Proměnné prostředí (Vercel → Settings → Environment Variables)

| Proměnná | Význam |
| --- | --- |
| `GITHUB_PAT` | GitHub PAT pro čtení obsahu repa. |
| `GITHUB_WRITE_PAT` | (volitelné) PAT s právem zapisovat obsah; když chybí, použije se `GITHUB_PAT`. |
| `OPENROUTER_API_KEY` | Klíč pro OpenRouter. |
| `GITHUB_OWNER` | (volitelné) výchozí `zbycz` |
| `GITHUB_REPO` | (volitelné) výchozí `zpevnik` |
| `GITHUB_SONGS_DIR` | (volitelné) výchozí `pisnicky` |
| `OPENROUTER_MODEL` | (volitelné) výchozí `xiaomi/mimo-v2.6-pro` |
| `OPENROUTER_URL` | (volitelné) výchozí `https://openrouter.ai/api/v1` |

## Lokální vývoj

```bash
bun install                 # vytvoří bun.lock (potřebné pro Bun preset na Vercelu)
GITHUB_PAT=... OPENROUTER_API_KEY=... bun run dev
```

Ukázková data: `GITHUB_PAT=... bun run scripts/seed-songs.ts`

## Nasazení

Vercel použije **Bun framework preset** (protože je v `vercel.json` `bunVersion`,
existuje `bun.lock` a `server.ts`). Všechny požadavky jdou na jeden `Bun.serve()`.