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
  const response = await fetch("/api/get-songs");
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as { songs: SongListItem[] };
  songsCache = { at: Date.now(), data: data.songs ?? [] };
  return songsCache.data;
}

async function getSong(
  name: string,
): Promise<{ song: Song; sameAuthor: SongListItem[] }> {
  const response = await fetch(`/api/get-song?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { song: Song; sameAuthor: SongListItem[] };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function navigate(path: string): void {
  if (path === location.pathname + location.search) return render(path);
  history.pushState({}, "", path);
  render(path);
}

function render(path = location.pathname + location.search): void {
  closeSuggest();
  window.scrollTo({ top: 0 });
  const url = new URL(path, location.origin);
  if (url.pathname.startsWith("/song")) renderSong(url);
  else if (url.pathname.startsWith("/add")) renderAdd(url);
  else renderHome();
}

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest("a");
  if (!target) return;
  const href = target.getAttribute("href");
  if (!href || target.target || href.startsWith("http") || href.startsWith("#")) return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener("popstate", () => render());

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function showError(container: HTMLElement, error: unknown, retry?: () => void): void {
  const box = h("div", { class: "error" }, h("strong", { text: "Chyba: " }), errorMessage(error));
  if (retry) box.append(h("div", {}, h("button", { class: "ghost", onclick: retry }, "Zkusit znovu")));
  container.replaceChildren(box);
}

function songListHtml(songs: SongListItem[]): string {
  return songs
    .map(
      (song) =>
        `<li><a href="/song/${encodeURIComponent(song.name)}">${escapeHtml(song.title)}${
          song.author ? `<span class="by">${escapeHtml(song.author)}</span>` : ""
        }</a></li>`,
    )
    .join("");
}

function renderHome(): void {
  app.replaceChildren(h("p", { class: "muted", text: "Načítám písně…" }));
  getSongs()
    .then((songs) => {
      const list = songs.length
        ? `<ul class="song-list">${songListHtml(songs)}</ul>`
        : `<p class="muted">Zatím tu nejsou žádné písně. Přidej první pomocí vyhledávání.</p>`;
      app.innerHTML = `<h1>Zpěvník</h1><p class="muted">${songs.length} písní</p>${list}`;
    })
    .catch((error) => showError(app, error, () => renderHome()));
}

function renderSong(url: URL): void {
  // searchParams is already decoded; the path segment is not.
  const raw = url.searchParams.get("name") ?? url.pathname.split("/song/")[1] ?? "";
  const name = raw.includes("%") ? decodeURIComponent(raw) : raw;
  app.replaceChildren(h("p", { class: "muted", text: "Načítám píseň…" }));
  getSong(name)
    .then(({ song, sameAuthor }) => {
      const metaParts = [song.meta.author, song.meta.year].filter(Boolean).map(escapeHtml);
      const sameHtml = sameAuthor.length
        ? `<h2>Další písně od ${escapeHtml(song.meta.author)}</h2><ul class="song-list">${songListHtml(sameAuthor)}</ul>`
        : "";
      app.innerHTML = `
        <a class="back" href="/">← Domů</a>
        <h1>${escapeHtml(song.meta.title)}</h1>
        <p class="song-meta">${metaParts.join(" · ")}</p>
        <article class="song-body">${song.html}</article>
        ${sameHtml}
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
        `<a role="option" href="/song/${encodeURIComponent(song.name)}">${escapeHtml(song.title)}${
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
  navigate(first?.getAttribute("href") ?? `/add?query=${encodeURIComponent(query)}`);
});
document.addEventListener("click", (event) => {
  if (event.target === searchInput || suggestBox.contains(event.target as Node)) return;
  closeSuggest();
});

// ---------------------------------------------------------------------------
// Add song - agent harness
// ---------------------------------------------------------------------------

const MAX_STEPS = 8;

const AGENT_TOOLS = [
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
  "Máš k dispozici jediný nástroj: fetch_webpage(url), který načte obsah stránky.",
  "Nejprve zkus odhadnout vhodné URL (např. Google vyhledávání, stránky s texty písní,",
  "Wikipedii, nebo přímo web interpreta) a obsah načti. Můžeš volat nástroj vícekrát.",
  "Najdi text písně a jejího autora. Pokud text nenajdeš, vrať prázdný markdown a vysvětli proč.",
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
    return {
      title: String(data.title ?? "").trim(),
      author: String(data.author ?? "").trim(),
      year: String(data.year ?? "").trim(),
      markdown: String(data.markdown ?? "").trim(),
    };
  } catch {
    return { ...fallback, markdown: content.trim() };
  }
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

      if (message.content) logLine(ui.log, message.content);
      else logLine(ui.log, "(model nepíše text)");

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
        const args = safeJson(call.function.arguments);
        const target = String(args.url ?? "");
        logLine(ui.log, `🔧 fetch_webpage(${target})`, "log-tool");
        let toolResult: unknown;
        try {
          const toolResponse = await fetch("/api/fetch-webpage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: target }),
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
      container.replaceChildren(
        h("div", { class: "card ok" },
          h("strong", { text: "Píseň přidána. " }),
          h("a", { href: `/song/${encodeURIComponent(data.name)}` }, "Zobrazit píseň →"),
        ),
      );
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
