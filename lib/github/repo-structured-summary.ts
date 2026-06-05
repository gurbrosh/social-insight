import { formatDistanceToNowStrict } from "date-fns/formatDistanceToNowStrict";
import { fetchReadmeMarkdown, githubFetchJson, parseGithubLinkLastPage } from "./github-client";
import type { GithubRepoDetailResponse } from "./types";

const DESC_MAX_LEN = 12_000;

function isReadmeBadgeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("![")) return true;
  if (t.startsWith("[![")) return true;
  if (t.startsWith("<img")) return true;
  if (t.startsWith("[<img")) return true;
  return false;
}

/**
 * Title: first **bold** line after H1 if present, else first H1 text.
 * Description: body after first horizontal rule if present; else first prose block after H1 (skipping badges).
 */
export function parseReadmeForTitleAndDescription(readme: string): {
  title: string | null;
  description: string | null;
} {
  const lines = readme.replace(/\r\n/g, "\n").split("\n");
  let h1: string | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+)$/);
    if (m) {
      h1 = m[1].trim();
      i += 1;
      break;
    }
  }
  if (!h1) {
    return { title: null, description: null };
  }

  while (i < lines.length && lines[i].trim() === "") {
    i += 1;
  }

  let title = h1;
  const bold = lines[i]?.match(/^\*\*(.+?)\*\*\s*$/);
  if (bold) {
    title = bold[1].trim();
    i += 1;
  }

  let descStart = -1;
  for (let j = i; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === "---" || t === "***") {
      descStart = j + 1;
      break;
    }
    if (/^##\s/.test(t)) {
      break;
    }
  }

  if (descStart >= 0) {
    while (descStart < lines.length && lines[descStart].trim() === "") {
      descStart += 1;
    }
    const buf: string[] = [];
    for (let j = descStart; j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^##\s/.test(t)) {
        break;
      }
      if (t === "---" || t === "***") {
        break;
      }
      if (t === "") {
        if (buf.length > 0) {
          buf.push("\n\n");
        }
        continue;
      }
      if (isReadmeBadgeLine(lines[j])) {
        continue;
      }
      buf.push(t);
    }
    let description = buf
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ +/g, " ")
      .trim();
    if (description.length > DESC_MAX_LEN) {
      description = `${description.slice(0, DESC_MAX_LEN).trim()}…`;
    }
    return { title, description: description || null };
  }

  while (i < lines.length && (lines[i].trim() === "" || isReadmeBadgeLine(lines[i]))) {
    i += 1;
  }

  const buf: string[] = [];
  for (let j = i; j < lines.length; j++) {
    const line = lines[j];
    const t = line.trim();
    if (/^##\s/.test(t)) {
      break;
    }
    if (/^#+\s/.test(t)) {
      break;
    }
    if (t === "" && buf.length > 0) {
      break;
    }
    if (t !== "" && !isReadmeBadgeLine(line)) {
      buf.push(t);
    }
  }
  let description = buf.join(" ").replace(/\s+/g, " ").trim();
  if (description.length > DESC_MAX_LEN) {
    description = `${description.slice(0, DESC_MAX_LEN).trim()}…`;
  }
  return { title, description: description || null };
}

/**
 * Total item count for GitHub paginated list APIs (contributors, releases, deployments).
 * Uses `Link: rel="last"` so we need at most **two** HTTP requests instead of up to 30 sequential
 * pages × 400ms delay each (previously very slow for busy repos).
 */
async function countPaginatedList(
  basePath: string,
  ctx: { keyword: string; endpoint: string }
): Promise<number> {
  try {
    const { data, link } = await githubFetchJson<unknown[]>(`${basePath}?per_page=100&page=1`, {
      keyword: ctx.keyword,
      page: 1,
      endpoint: ctx.endpoint,
    });
    if (!Array.isArray(data)) return 0;
    if (data.length === 0) return 0;
    if (data.length < 100) return data.length;

    const lastPage = parseGithubLinkLastPage(link);
    if (lastPage == null || lastPage <= 1) {
      return data.length;
    }

    const { data: lastData } = await githubFetchJson<unknown[]>(
      `${basePath}?per_page=100&page=${lastPage}`,
      {
        keyword: ctx.keyword,
        page: lastPage,
        endpoint: ctx.endpoint,
      }
    );
    if (!Array.isArray(lastData)) return (lastPage - 1) * 100;
    return (lastPage - 1) * 100 + lastData.length;
  } catch {
    return 0;
  }
}

function formatStructuredSummary(input: {
  projectName: string;
  about: string | null;
  title: string;
  description: string | null;
  keywords: string[];
  stars: number;
  forks: number;
  releases: number;
  deployments: number;
  contributers: number;
  sinceRelative: string;
}): string {
  const kw = input.keywords.length ? input.keywords.join(" ") : "";
  return [
    `project name: ${input.projectName}`,
    `About: ${input.about ?? ""}`,
    `Title: ${input.title}`,
    `Description: ${input.description ?? ""}`,
    `Keywords: ${kw}`,
    `Stars: ${input.stars}`,
    `forks: ${input.forks}`,
    `releases: ${input.releases}`,
    `deployments: ${input.deployments}`,
    `contributers: ${input.contributers}`,
    `since ${input.sinceRelative}`,
  ].join("\n");
}

/** Machine-readable mirror of the structured summary (stored on Post.extraJson.github). */
export type GithubRepoStructuredExtraJson = {
  source: "github_repo";
  repo_full_name: string;
  repo_id: number;
  owner_login: string;
  topics: string[];
  license: string | null;
  default_branch: string | null;
  open_issues_count: number | null;
  releases_count: number;
  deployments_count: number;
  contributors_count: number;
  readme_title: string | null;
  readme_description_excerpt: string | null;
  about: string | null;
  since_iso: string;
  since_relative: string;
};

export type BuildGithubRepoStructuredSummaryResult = {
  text: string;
  extra: GithubRepoStructuredExtraJson;
};

/**
 * GET /repos + README + counts — returns formatted text plus structured fields for Post.extraJson.
 */
export async function buildGithubRepoStructuredSummaryWithMeta(args: {
  owner: string;
  repo: string;
  keyword: string;
  detail: GithubRepoDetailResponse;
}): Promise<BuildGithubRepoStructuredSummaryResult> {
  const { owner, repo, keyword, detail } = args;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const ctxReadme = { keyword, page: 0, endpoint: "readme" as const };

  // Sequential (not Promise.all): parallel bursts 4+ REST calls per repo and exhausts
  // `x-ratelimit-remaining` quickly, causing 403 + long waits during enrichment.
  // README text: raw.githubusercontent.com first (no REST quota), then REST /readme fallback.
  const readme = await fetchReadmeMarkdown({
    owner,
    repo,
    defaultBranch: detail.default_branch?.trim() || "main",
    ctx: ctxReadme,
  });
  const releases = await countPaginatedList(`${base}/releases`, { keyword, endpoint: "releases" });
  const deployments = await countPaginatedList(`${base}/deployments`, {
    keyword,
    endpoint: "deployments",
  });
  const contributers = await countPaginatedList(`${base}/contributors`, {
    keyword,
    endpoint: "contributors",
  });

  const parsed = readme
    ? parseReadmeForTitleAndDescription(readme)
    : { title: null, description: null };
  const title = parsed.title?.trim() || detail.name;
  const description =
    parsed.description?.trim() || (detail.description?.trim() ? detail.description.trim() : "");

  const sinceRelative = formatDistanceToNowStrict(new Date(detail.created_at), {
    addSuffix: true,
  });

  const license =
    detail.license?.spdx_id && detail.license.spdx_id !== "NOASSERTION"
      ? detail.license.spdx_id
      : (detail.license?.name ?? null);

  const ownerLogin = detail.owner?.login ?? owner;

  const extra: GithubRepoStructuredExtraJson = {
    source: "github_repo",
    repo_full_name: detail.full_name,
    repo_id: detail.id,
    owner_login: ownerLogin,
    topics: [...(detail.topics ?? [])],
    license,
    default_branch: detail.default_branch ?? null,
    open_issues_count: detail.open_issues_count ?? null,
    releases_count: releases,
    deployments_count: deployments,
    contributors_count: contributers,
    readme_title: title,
    readme_description_excerpt: description || null,
    about: detail.description?.trim() ?? null,
    since_iso: detail.created_at,
    since_relative: sinceRelative,
  };

  const text = formatStructuredSummary({
    projectName: detail.name,
    about: detail.description?.trim() ?? null,
    title,
    description: description || null,
    keywords: detail.topics ?? [],
    stars: detail.stargazers_count ?? 0,
    forks: detail.forks_count ?? 0,
    releases,
    deployments,
    contributers,
    sinceRelative,
  });

  return { text, extra };
}

/**
 * Builds the multi-line summary used for GithubSignal.body after GET /repos + README + counts.
 */
export async function buildGithubRepoStructuredSummary(args: {
  owner: string;
  repo: string;
  keyword: string;
  detail: GithubRepoDetailResponse;
}): Promise<string> {
  const { text } = await buildGithubRepoStructuredSummaryWithMeta(args);
  return text;
}
