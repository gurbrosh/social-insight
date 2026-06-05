/**
 * Hacker News Algolia search_by_date hit (subset; API may add fields).
 */
export type AlgoliaHit = {
  objectID: string;
  created_at?: string;
  created_at_i?: number;
  _tags?: string[];
  author?: string;
  title?: string;
  url?: string;
  comment_text?: string;
  story_title?: string;
  story_url?: string;
  story_id?: number;
  parent_id?: number;
  story_text?: string;
  points?: number;
  num_comments?: number;
};

export type AlgoliaSearchByDateResponse = {
  hits: AlgoliaHit[];
  nbPages: number;
  page: number;
  params?: string;
};

export type HnFirebaseItem = {
  id?: number;
  type?: string;
  title?: string;
  text?: string;
  url?: string;
  /** Top-level comment ids (stories) or reply ids (comments); HN-ranked order for direct children of a story. */
  kids?: number[];
  parent?: number;
  score?: number;
  descendants?: number;
  by?: string;
  time?: number;
  deleted?: boolean;
  dead?: boolean;
} | null;
