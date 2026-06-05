import type { Prisma } from "@prisma/client";
import { GITHUB_SIGNAL_KEYWORD_GLOBAL } from "./constants";
import type { GithubCodeSearchItem, GithubRepoSearchItem } from "./types";

const SOURCE = "github";

export function externalIdRepo(item: GithubRepoSearchItem): string {
  return `repo:${item.id}`;
}

export function externalIdCode(item: GithubCodeSearchItem): string {
  const path = item.path.replace(/:/g, "_");
  const sha = item.sha?.trim() || "unknown";
  return `code:${item.repository.id}:${sha}:${path}`;
}

export function normalizeRepoItem(
  item: GithubRepoSearchItem,
  _keyword: string
): Prisma.GithubSignalCreateManyInput {
  const publishedAt = new Date(item.updated_at);
  return {
    source: SOURCE,
    keyword: GITHUB_SIGNAL_KEYWORD_GLOBAL,
    signal_type: "repo",
    external_id: externalIdRepo(item),
    repo_full_name: item.full_name,
    repo_id: item.id,
    repo_url: item.html_url,
    title: item.name,
    body: item.description,
    file_path: null,
    file_url: null,
    author: item.owner?.login ?? null,
    stars: item.stargazers_count,
    forks: item.forks_count,
    language: item.language,
    event_type: null,
    published_at: publishedAt,
    published_at_unix: Math.floor(publishedAt.getTime() / 1000),
    license: null,
    default_branch: null,
    open_issues_count: null,
    topics_json: item.topics?.length ? JSON.stringify(item.topics) : null,
    raw_payload: item as unknown as Prisma.InputJsonValue,
  };
}

export function normalizeCodeItem(
  item: GithubCodeSearchItem,
  _keyword: string
): Prisma.GithubSignalCreateManyInput {
  const publishedAt = new Date();
  const snippet =
    item.text_matches
      ?.map((m) => m.fragment)
      .filter(Boolean)
      .join("\n") ?? null;
  return {
    source: SOURCE,
    keyword: GITHUB_SIGNAL_KEYWORD_GLOBAL,
    signal_type: "code",
    external_id: externalIdCode(item),
    repo_full_name: item.repository.full_name,
    repo_id: item.repository.id,
    repo_url: item.repository.html_url,
    title: item.name,
    body: snippet,
    file_path: item.path,
    file_url: item.html_url,
    author: null,
    stars: null,
    forks: null,
    language: null,
    event_type: null,
    published_at: publishedAt,
    published_at_unix: Math.floor(publishedAt.getTime() / 1000),
    license: null,
    default_branch: null,
    open_issues_count: null,
    topics_json: null,
    raw_payload: item as unknown as Prisma.InputJsonValue,
  };
}
