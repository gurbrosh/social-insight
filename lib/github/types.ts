/** GitHub REST search/repositories item (subset). */
export type GithubRepoSearchItem = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  owner: { login: string; id: number };
};

export type GithubRepoSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GithubRepoSearchItem[];
};

/** GitHub REST search/code item (subset). */
export type GithubCodeSearchItem = {
  name: string;
  path: string;
  sha: string;
  html_url: string;
  git_url?: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    description: string | null;
    fork: boolean;
  };
  text_matches?: { fragment?: string }[];
};

export type GithubCodeSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GithubCodeSearchItem[];
};

export type GithubRepoDetailResponse = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  created_at: string;
  license: { name: string; spdx_id: string } | null;
  open_issues_count: number;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  /** Present on GET /repos — used for Post author fields. */
  owner?: { login: string; id: number };
};
