export interface SongMeta {
  title: string;
  author: string;
  year: string;
}

export interface SongListItem {
  /** File name on GitHub (URL-encoded), used as the song id. */
  name: string;
  title: string;
  author: string;
}

export interface Song {
  name: string;
  meta: SongMeta;
  /** Raw markdown body (without frontmatter). */
  markdown: string;
  /** Rendered HTML. */
  html: string;
}
