interface SongMeta {
  title: string;
  author: string;
  year: string;
}

interface SongListItem {
  name: string;
  title: string;
  author: string;
}

interface Song {
  name: string;
  meta: SongMeta;
  markdown: string;
  html: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning?: string | null;
  reasoning_details?: { text?: string }[];
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface SongDraft {
  title: string;
  author: string;
  year: string;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;
const searchInput = document.getElementById("search") as HTMLInputElement;
const suggestBox = document.getElementById("suggest")!;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function h(
  tag: string,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pretty-print JSON answers (and fenced JSON) so the log is readable. */
function prettyContent(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  if (!candidate.startsWith("{")) return content;
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return content;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

let songsCache: { at: number; data: SongListItem[] } | null = null;

async function getSongs(force = false): Promise<SongListItem[]> {
  if (!force && songsCache && Date.now() - songsCache.at < 60_000) return songsCache.data;
  // Generated at build time and served statically (no API call).
  const response = await fetch("/songs.json");
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as { songs: SongListItem[] };
  songsCache = { at: Date.now(), data: data.songs ?? [] };
  return songsCache.data;
}

interface SongData {
  song: Song;
  sameAuthor: SongListItem[];
  /** GitHub edit URL, present on the API fallback response. */
  editUrl?: string;
}

/** Read the data embedded in a static song page, if present. */
function embeddedSong(): SongData | null {
  const el = document.getElementById("song-data");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as SongData;
  } catch {
    return null;
  }
}

/**
 * A song's static page carries its data inline. A song added after the last
 * deploy has no static page yet, so the API is used as a fallback.
 */
async function getSongFromApi(name: string): Promise<SongData> {
  const response = await fetch(`/api/get-song?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as SongData;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Pages are rendered statically at build time. The client only needs to act on
 * `/add` (the agent) and on a song page that has no static HTML yet (served as
 * an empty shell by the function) - then it renders from the API.
 */
function render(): void {
  closeSuggest();
  const url = new URL(location.href);
  if (url.pathname.startsWith("/add")) renderAdd(url);
  else if (url.pathname.startsWith("/song")) renderSong(url);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function showError(container: HTMLElement, error: unknown, retry?: () => void): void {
  const box = h("div", { class: "error" }, h("strong", { text: "Chyba: " }), errorMessage(error));
  if (retry) box.append(h("div", {}, h("button", { class: "ghost", onclick: retry }, "Zkusit znovu")));
  container.replaceChildren(box);
}

function songHref(name: string): string {
  return `/song/${encodeURIComponent(name.replace(/\.(md|markdown)$/i, ""))}`;
}

function songListHtml(songs: SongListItem[]): string {
  return songs
    .map(
      (song) =>
        `<li><a href="${songHref(song.name)}">${escapeHtml(song.title)}${
          song.author ? `<span class="by">${escapeHtml(song.author)}</span>` : ""
        }</a></li>`,
    )
    .join("");
}

function renderSong(url: URL): void {
  // Static song pages carry their data inline, so the page is already correct.
  if (embeddedSong()) return;

  // No static page (a song added after the last deploy): render from the API.
  let name = url.searchParams.get("name") ?? url.pathname.split("/song/")[1] ?? "";
  name = name.includes("%") ? decodeURIComponent(name) : name;
  name = name.replace(/\.html$/i, "");
  if (name && !/\.(md|markdown)$/i.test(name)) name += ".md";
  app.replaceChildren(h("p", { class: "muted", text: "Načítám píseň…" }));
  getSongFromApi(name)
    .then(({ song, sameAuthor, editUrl }) => {
      const metaParts = [song.meta.author, song.meta.year].filter(Boolean).map(escapeHtml);
      const sameHtml = sameAuthor.length
        ? `<h2>Další písně od ${escapeHtml(song.meta.author)}</h2><ul class="song-list">${songListHtml(sameAuthor)}</ul>`
        : "";
      const editHtml = editUrl
        ? `<p class="song-actions"><a class="edit-link" href="${editUrl}" target="_blank" rel="noopener">✏️ Upravit na GitHubu</a></p>`
        : "";
      app.innerHTML = `
        <a class="back" href="/">← Domů</a>
        <h1>${escapeHtml(song.meta.title)}</h1>
        <p class="song-meta">${metaParts.join(" · ")}</p>
        <article class="song-body">${song.html}</article>
        ${sameHtml}
        ${editHtml}
      `;
    })
    .catch((error) => showError(app, error, () => renderSong(url)));
}

// ---------------------------------------------------------------------------
// Search + autosuggest
// ---------------------------------------------------------------------------

let suggestTimer = 0;

function closeSuggest(): void {
  suggestBox.hidden = true;
  suggestBox.replaceChildren();
}

async function updateSuggest(value: string): Promise<void> {
  const query = value.trim();
  if (!query) return closeSuggest();

  let songs: SongListItem[] = [];
  try {
    songs = await getSongs();
  } catch {
    // ignore - still offer to add
  }
  const needle = normalize(query);
  const matches = songs
    .filter((song) => normalize(song.title).includes(needle) || normalize(song.author).includes(needle))
    .slice(0, 6);
  const addHref = `/add?query=${encodeURIComponent(query)}`;

  suggestBox.innerHTML = [
    ...matches.map(
      (song) =>
        `<a role="option" data-song href="${songHref(song.name)}">${escapeHtml(song.title)}${
          song.author ? ` <span class="muted">· ${escapeHtml(song.author)}</span>` : ""
        }</a>`,
    ),
    `<a role="option" class="suggest-add" href="${addHref}">➕ Přidat „${escapeHtml(query)}“</a>`,
  ].join("");
  suggestBox.hidden = false;
}

searchInput.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(() => void updateSuggest(searchInput.value), 150);
});
searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) void updateSuggest(searchInput.value);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSuggest();
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  const first = suggestBox.querySelector<HTMLAnchorElement>("a[data-song]");
  location.href = first?.getAttribute("href") ?? `/add?query=${encodeURIComponent(query)}`;
});
document.addEventListener("click", (event) => {
  if (event.target === searchInput || suggestBox.contains(event.target as Node)) return;
  closeSuggest();
});

// ---------------------------------------------------------------------------
// Add song - agent harness
// ---------------------------------------------------------------------------

const MAX_STEPS = 10;

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_lyrics",
      description:
        "Vyhledá text písně v databázi textů (LRCLIB). Vrací seznam skladeb včetně plného textu. Zkus to jako první.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Název písně, ideálně i s autorem, např. 'Touha Daniel Landa'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Vyhledá na webu (bez API klíče) a vrátí seznam odkazů s popisky.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Vyhledávací dotaz" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_webpage",
      description: "Načte webovou stránku a vrátí její textový obsah (bez HTML značek).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolutní URL začínající http:// nebo https://" },
        },
        required: ["url"],
      },
    },
  },
];

const SYSTEM_PROMPT = [
  "Jsi agent, který pomáhá plnit český zpěvník.",
  "Máš tři nástroje: search_lyrics(query) - databáze textů písní (zkus první),",
  "search_web(query) - obecné vyhledávání na webu, fetch_webpage(url) - načtení stránky.",
  "Postup: nejdřív search_lyrics s názvem písně a autorem; pokud nenajdeš, použij search_web",
  "a pak fetch_webpage na vhodný odkaz. Můžeš volat nástroje vícekrát.",
  "Najdi text písně a jejího autora. Pokud text nenajdeš, vrať prázdný markdown a vysvětli proč.",
  "Do markdownu dej POUZE text písně - bez nadpisu s názvem a bez řádku s autorem,",
  "ty už jsou zvlášť v polích title a author.",
  "Až budeš hotový, odpověz POUZE jedním JSON objektem bez okolního textu a bez code fence,",
  've tvaru: {"title": "Název písně", "author": "Autor", "year": "rok nebo prázdný řetězec",',
  '"markdown": "text písně v markdownu"}.',
].join(" ");

function parseDraft(content: string): SongDraft {
  const fallback: SongDraft = { title: "", author: "", year: "", markdown: "" };
  const match = /\{[\s\S]*\}/.exec(content);
  if (!match) return { ...fallback, markdown: content.trim() };
  try {
    const data = JSON.parse(match[0]) as Partial<SongDraft>;
    const title = String(data.title ?? "").trim();
    const author = String(data.author ?? "").trim();
    return {
      title,
      author,
      year: String(data.year ?? "").trim(),
      markdown: stripHeadings(String(data.markdown ?? "").trim(), title, author),
    };
  } catch {
    return { ...fallback, markdown: content.trim() };
  }
}

/**
 * Remove a leading "# Title" heading and "**Author** (album: …)" line from the
 * body - the title/author/year live in the frontmatter, not in the lyrics text.
 */
function stripHeadings(markdown: string, title: string, author: string): string {
  const lines = markdown.split("\n");
  const dropBlank = () => {
    while (lines.length && !lines[0].trim()) lines.shift();
  };

  dropBlank();
  const heading = /^#\s+(.+)$/.exec(lines[0]?.trim() ?? "");
  if (heading && (!title || normalize(heading[1]) === normalize(title))) {
    lines.shift();
    dropBlank();
  }

  const bold = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(lines[0]?.trim() ?? "");
  if (bold) {
    const name = bold[1].trim();
    const rest = bold[2].trim();
    const restIsMeta = rest === "" || /^[*_(].*[*_)]$/.test(rest);
    if (restIsMeta && (!author || normalize(name) === normalize(author))) {
      lines.shift();
      dropBlank();
    }
  }
  return lines.join("\n").trim();
}

function renderAdd(url: URL): void {
  const query = (url.searchParams.get("query") ?? "").trim();
  if (!query) {
    app.innerHTML = `<h1>Přidat píseň</h1><p class="muted">Zadej název písně do vyhledávání v hlavičce.</p>`;
    return;
  }

  const log = h("div", { class: "agent-log" });
  const status = h("p", { class: "muted", text: "Agent hledá text písně…" });
  const result = h("div");
  const stop = h(
    "button",
    { class: "ghost", onclick: () => controller.abort() },
    "Zastavit",
  ) as HTMLButtonElement;

  app.replaceChildren(
    h("a", { class: "back", href: "/" }, "← Domů"),
    h("h1", {}, "Hledám: ", h("em", { text: query })),
    status,
    stop,
    log,
    result,
  );

  const controller = new AbortController();
  void runAgent(query, { log, status, result, stop, controller });
}

interface AgentUi {
  log: HTMLElement;
  status: HTMLElement;
  result: HTMLElement;
  stop: HTMLButtonElement;
  controller: AbortController;
}

function logLine(log: HTMLElement, text: string, className = ""): void {
  log.append(h("div", { class: `log-line ${className}`.trim(), text }));
  log.scrollTop = log.scrollHeight;
}

async function runAgent(query: string, ui: AgentUi): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Najdi a připrav píseň: "${query}"` },
  ];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (ui.controller.signal.aborted) throw new Error("Zastaveno.");
      ui.status.textContent = `Agent přemýšlí… (krok ${step}/${MAX_STEPS})`;
      logLine(ui.log, `▶ krok ${step}`);

      const response = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tools: AGENT_TOOLS, tool_choice: "auto" }),
        signal: ui.controller.signal,
      });
      if (!response.ok) throw new Error(await readError(response));

      const data = (await response.json()) as {
        choices?: { message?: ChatMessage; finish_reason?: string }[];
      };
      const choice = data.choices?.[0];
      const message = choice?.message;
      if (!message) throw new Error("Model nevrátil odpověď.");

      // Keep only the fields the API understands (drop provider-specific extras).
      const assistant: ChatMessage = { role: "assistant", content: message.content ?? null };
      if (message.tool_calls) assistant.tool_calls = message.tool_calls;
      messages.push(assistant);

      const reasoning = (message.reasoning ?? "")
        || (message.reasoning_details ?? []).map((d) => d.text ?? "").join("\n");
      if (reasoning.trim()) {
        logLine(ui.log, `💭 ${reasoning.trim()}`, "log-think");
      }
      if (message.content) logLine(ui.log, prettyContent(message.content));
      else if (!reasoning.trim()) logLine(ui.log, "(model nepíše text)");

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const draft = parseDraft(message.content ?? "");
        ui.status.remove();
        ui.stop.remove();
        logLine(ui.log, "✔ hotovo", "log-tool");
        showDraftForm(draft, ui.result);
        return;
      }

      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        const args = safeJson(call.function?.arguments ?? "{}");
        const { endpoint, log, body } = toolRequest(name, args);
        logLine(ui.log, log, "log-tool");
        let toolResult: unknown;
        try {
          const toolResponse = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ui.controller.signal,
          });
          toolResult = toolResponse.ok
            ? await toolResponse.json()
            : { error: await readError(toolResponse) };
        } catch (error) {
          toolResult = { error: errorMessage(error) };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult).slice(0, 24_000),
        });
      }
    }
    throw new Error(`Agent nedokončil úlohu za ${MAX_STEPS} kroků.`);
  } catch (error) {
    ui.status.remove();
    ui.stop.remove();
    logLine(ui.log, `✖ ${errorMessage(error)}`, "log-err");
    ui.result.append(
      h("div", { class: "error" }, "Nepodařilo se získat píseň: ", errorMessage(error)),
    );
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Map an agent tool call to its backend endpoint, log line, and request body. */
function toolRequest(
  name: string,
  args: Record<string, unknown>,
): { endpoint: string; log: string; body: Record<string, unknown> } {
  switch (name) {
    case "search_lyrics": {
      const query = String(args.query ?? "");
      return { endpoint: "/api/search-lyrics", log: `🔧 search_lyrics(${query})`, body: { query } };
    }
    case "search_web": {
      const query = String(args.query ?? "");
      return { endpoint: "/api/search-web", log: `🔧 search_web(${query})`, body: { query } };
    }
    default: {
      const url = String(args.url ?? "");
      return { endpoint: "/api/fetch-webpage", log: `🔧 fetch_webpage(${url})`, body: { url } };
    }
  }
}

function showDraftForm(draft: SongDraft, container: HTMLElement): void {
  const title = h("input", { value: draft.title, placeholder: "Název" }) as HTMLInputElement;
  const author = h("input", { value: draft.author, placeholder: "Autor" }) as HTMLInputElement;
  const year = h("input", { value: draft.year, placeholder: "Rok" }) as HTMLInputElement;
  const markdown = h("textarea", {}) as HTMLTextAreaElement;
  markdown.value = draft.markdown;
  const submit = h("button", {}, "Přidat do zpěvníku") as HTMLButtonElement;
  const info = h("p", { class: "muted" });

  const field = (label: string, input: HTMLElement) =>
    h("label", { style: "display:block;margin:.5rem 0" }, h("span", { class: "muted", text: label }), h("div", {}, input));

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    info.textContent = "Commituji na GitHub…";
    try {
      const response = await fetch("/api/add-song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.value,
          author: author.value,
          year: year.value,
          markdown: markdown.value,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = (await response.json()) as { name: string; title: string };
      songsCache = null;
      info.textContent = "Hotovo, otevírám píseň…";
      // The song page is not built yet, so it renders live from the API.
      location.href = songHref(data.name);
    } catch (error) {
      submit.disabled = false;
      info.textContent = "";
      container.append(h("div", { class: "error" }, errorMessage(error)));
    }
  });

  container.replaceChildren(
    h("div", { class: "card" },
      h("h2", { style: "margin-top:0" }, "Návrh písně"),
      h("p", { class: "muted" }, "Zkontroluj a uprav, pak ulož. Uloží se jako markdown s frontmatterem."),
      field("Název", title),
      field("Autor", author),
      field("Rok", year),
      field("Text (markdown)", markdown),
      h("div", { style: "margin-top:.75rem;display:flex;gap:.5rem;align-items:center" }, submit, info),
    ),
  );
}

// ---------------------------------------------------------------------------

render();
