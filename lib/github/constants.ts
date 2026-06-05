/**
 * Stored on every GithubSignal row. Search terms are not tracked per row — identity is
 * `(source, signal_type, external_id)` so the same repo/file match is one row across all keywords.
 */
export const GITHUB_SIGNAL_KEYWORD_GLOBAL = "__global__";
