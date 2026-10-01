/**
 * Adds a few traditional songs to the `pisnicky/` folder on GitHub.
 * Run with: GITHUB_PAT=... bun run scripts/seed-songs.ts
 */
import { SONGS_DIR, createFile, getFile } from "../lib/github";

interface Seed {
  name: string;
  title: string;
  author: string;
  year: string;
  markdown: string;
}

const songs: Seed[] = [
  {
    name: "skakal-pes.md",
    title: "Skákal pes",
    author: "Lidová",
    year: "",
    markdown: [
      "Skákal pes přes oves,",
      "přes zelenou louku,",
      "šel za ním myslivec,",
      "péro na klobouku.",
      "",
      "Pejsku náš, co děláš?",
      "Že ty nic nevíš?",
      "Skákal pes přes oves,",
      "přes zelenou louku.",
    ].join("\n"),
  },
  {
    name: "ja-mam-kone.md",
    title: "Já mám koně",
    author: "Lidová",
    year: "",
    markdown: [
      "Já mám koně, vraný koně,",
      "to jsou koně mí,",
      "když je zapřáhnu do kočáru,",
      "jedou jako lví.",
      "",
      "Já mám koně, vraný koně,",
      "ty mně dobře jdou,",
      "když jim dám já oves z ruky,",
      "hlasitě řehtají.",
    ].join("\n"),
  },
  {
    name: "kdyz-jsem-ja-slouzil.md",
    title: "Když jsem já sloužil",
    author: "Lidová",
    year: "",
    markdown: [
      "Když jsem já sloužil to první léto,",
      "vysloužil jsem si kuřátko za to.",
      "A to kuře krákoře",
      "běhá po dvoře,",
      "má panímáma husy, já je pasu.",
      "",
      "Když jsem já sloužil to druhé léto,",
      "vysloužil jsem si kachničku za to.",
      "A ta kačka bláto tlačká,",
      "a to kuře krákoře",
      "běhá po dvoře,",
      "má panímáma husy, já je pasu.",
    ].join("\n"),
  },
];

for (const song of songs) {
  const path = `${SONGS_DIR}/${song.name}`;
  try {
    await getFile(path);
    console.log(`skip    ${path} (už existuje)`);
    continue;
  } catch {
    // does not exist yet
  }
  const frontmatter = [
    "---",
    `title: ${JSON.stringify(song.title)}`,
    `author: ${JSON.stringify(song.author)}`,
    `year: ${JSON.stringify(song.year)}`,
    "---",
    "",
  ].join("\n");
  await createFile(path, `${frontmatter}${song.markdown}\n`, `Seed: ${song.title}`);
  console.log(`created ${path}`);
}
