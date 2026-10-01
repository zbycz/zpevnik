const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

/** Repository that holds the songbook. */
export const OWNER = process.env.GITHUB_OWNER ?? "zbycz";
export const REPO = process.env.GITHUB_REPO ?? "zpevnik";
/** Directory (in the repo) that contains the songs. */
export const SONGS_DIR = process.env.GITHUB_SONGS_DIR ?? "pisnicky";

function firstToken(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

/** Token used for reading (can be read-only). */
export function githubToken(): string {
  const token = firstToken(["GITHUB_PAT", "GITHUB_TOKEN", "GH_PAT"]);
  if (!token) throw new Error("Chybí GitHub token (GITHUB_PAT).");
  return token;
}

/** Token used for writing. Falls back to the read token. */
export function githubWriteToken(): string {
  const token = firstToken(["GITHUB_WRITE_PAT", "GITHUB_PAT", "GITHUB_TOKEN", "GH_PAT"]);
  if (!token) throw new Error("Chybí GitHub token pro zápis (GITHUB_WRITE_PAT).");
  return token;
}

function headers(token = githubToken()): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "zpevnik",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}

export interface RepoTree {
  entries: TreeEntry[];
  truncated: boolean;
}

/** Return the whole repository tree for a branch (default: the repo default branch). */
export async function getRepoTree(branch?: string): Promise<RepoTree> {
  const ref = branch ?? (await getDefaultBranch());
  const res = await fetch(
    `${API}/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`GitHub tree ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { tree: TreeEntry[]; truncated: boolean };
  return { entries: data.tree ?? [], truncated: Boolean(data.truncated) };
}

export async function getDefaultBranch(): Promise<string> {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}`, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub repo ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

export interface RepoFile {
  /** Raw file content (decoded from base64). */
  content: string;
  sha: string;
}

/** Fetch a single file from the repository. */
export async function getFile(path: string, branch?: string): Promise<RepoFile> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const res = await fetch(
    `${API}/repos/${OWNER}/${REPO}/contents/${encodePath(path)}${ref}`,
    { headers: headers() },
  );
  if (res.status === 404) throw new Error(`Soubor "${path}" nebyl nalezen.`);
  if (!res.ok) throw new Error(`GitHub contents ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: string; sha: string };
  return { content: decodeBase64(data.content), sha: data.sha };
}

/** Create a new file. Throws if it already exists. */
export async function createFile(
  path: string,
  content: string,
  message: string,
): Promise<{ sha: string }> {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${encodePath(path)}`, {
    method: "PUT",
    headers: { ...headers(githubWriteToken()), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: encodeBase64(content) }),
  });
  if (!res.ok) throw new Error(`GitHub create ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s/g, "");
  return new TextDecoder().decode(
    Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)),
  );
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
