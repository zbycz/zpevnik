# Zpěvník

Jednoduchá aplikace bez závislostí, která běží na [Bun](https://bun.com) runtime
na Vercelu. Úvodní stránka i jednotlivé písně se **generují jako statické HTML
už při buildu** a Vercel je servíruje přímo z předgenerovaných souborů. Server
(Bun) řeší jen API a stránku `/add`, takže běžné zobrazení písně vůbec nesahá
na API.

## Co to umí

- **Domů** - statické HTML s výpisem všech písní ze složky `pisnicky/`.
  Vygeneruje se při buildu (`scripts/build.ts`), v prohlížeči se nic nedotahuje.
- **Píseň** - statické HTML (`/song/<slug>`) s textem a písněmi stejného autora.
  Data jsou navíc vložená ve stránce, takže i našeptávač a přepínání fungují
  bez API. Když píseň přidáš přes `/add` a ještě není nasazená, statická stránka
  neexistuje - server pošle prázdný shell a klient si píseň dotáhne z API
  (`GET /api/get-song`). Po dalším deployi už jede staticky.
- **Vyhledat** - našeptávač hledá v názvech/autorů z `songs.json`; když nic
  nesedí, nabídne „Přidat". To otevře `/add?query=...`, kde běží jednoduchý agent
  (OpenRouter) s jediným nástrojem `fetch_webpage`. Výsledek se zobrazí k úpravě
  a uloží se commitem do `pisnicky/`.

## Struktura

```
server.ts            Bun.serve() - API, /add a fallback pro nenasadene písně
scripts/build.ts     build step - generuje statické HTML do public/
lib/render.ts        serverové šablony (úvod, píseň, shell) + čtení public/
lib/github.ts        GitHub REST API (čtení jednoho souboru, zápis)
lib/songs.ts         čtení písní z lokální složky pisnicky/
lib/markdown.ts      frontmatter (Bun.YAML) + markdown (Bun.markdown)
lib/types.ts         sdílené typy
web/index.html       HTML shell (šablona pro statické stránky)
web/styles.css       responzivní styl, dark mode dle systému
web/app.ts           klientský TypeScript (našeptávač, agent, fallback)
scripts/seed-songs.ts ukázková data do pisnicky/
public/              generováno buildem (v gitu ignorováno)
vercel.json          bunVersion: 1.4.x, cleanUrls, buildCommand, includeFiles
```

`bun run build` vygeneruje `public/index.html`, `public/song/*.html`,
`public/songs.json`, `public/styles.css` a zbundlovaný `public/app.js`.
Vercel **Bun preset** tyhle soubory zabalí do funkce (`includeFiles`), takže
stránky servíruje `server.ts` přímo z `public/` - žádné volání API při
zobrazení. `cleanUrls` dělá hezké adresy bez `.html`.

## Proměnné prostředí (Vercel → Settings → Environment Variables)

| Proměnná | Význam |
| --- | --- |
| `GITHUB_PAT` | GitHub PAT - čte detail písně, která ještě není v nasazení (a zapisuje, když chybí `GITHUB_WRITE_PAT`). |
| `GITHUB_WRITE_PAT` | (volitelné) PAT s právem zapisovat obsah; když chybí, použije se `GITHUB_PAT`. |
| `OPENROUTER_API_KEY` | Klíč pro OpenRouter. |
| `GITHUB_OWNER` | (volitelné) výchozí `zbycz` |
| `GITHUB_REPO` | (volitelné) výchozí `zpevnik` |
| `GITHUB_SONGS_DIR` | (volitelné) výchozí `pisnicky` |
| `OPENROUTER_MODEL` | (volitelné) výchozí `deepseek/deepseek-v4.1-flash` |
| `OPENROUTER_URL` | (volitelné) výchozí `https://openrouter.ai/api/v1` |

## Lokální vývoj

```bash
bun install                 # vytvoří bun.lock (potřebné pro Bun preset na Vercelu)
bun run dev                 # build + server s --hot
bun run build               # jen vygeneruje public/
GITHUB_PAT=... OPENROUTER_API_KEY=... bun run dev
```

Ukázková data: `GITHUB_PAT=... bun run scripts/seed-songs.ts`

## Nasazení

Vercel použije **Bun framework preset** (protože je v `vercel.json` `bunVersion`,
existuje `bun.lock` a `server.ts`) a spustí `bun run build`. Vygenerovaný
`public/` se přes `includeFiles` zabalí do funkce a `server.ts` ho servíruje.
