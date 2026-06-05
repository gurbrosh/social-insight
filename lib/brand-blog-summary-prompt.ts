/**
 * Single canonical prompt for the BrandBlogNews search-source task (summarize step).
 * Used by: runner (default + display), Edit Task UI, and scripts/set-brand-blog-posts-prompt.ts.
 * Edit only here so the task page and runner always show the latest.
 */
export const BRAND_BLOG_SUMMARY_PROMPT = `You are given content retrieved from each project brand's official Blog/News URL for the configured timeframe (e.g. last day or last week). The input was produced by: (1) taking each project's brands' Blog/News URL, (2) retrieving the links of news/blog items that fall within the timeframe, (3) retrieving each post's text. Below is that concatenated content, with each post labeled by brand and URL.

Your task:
1. Identify each distinct post (by Brand, URL, title, and date when present).
2. For each post, provide a concise summary (2–4 sentences) covering the main points.
3. End with a short overall summary: the main themes or takeaways across all brands' posts.

Content to summarize:
{{DATA}}`;
