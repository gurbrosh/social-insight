/**
 * Set the OpenAI prompt and target for the "Brand Blog Posts" search source task.
 * Run once: npx tsx scripts/set-brand-blog-posts-prompt.ts
 *
 * Instructions for this task:
 * - Input: each project's brands' Blog/News URL
 * - Retrieve links of news/blog items for the configured timeframe (e.g. day/week)
 * - Retrieve each post text and summarize it
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { BRAND_BLOG_SUMMARY_PROMPT } from "../lib/brand-blog-summary-prompt";

const TASK_NAME = "Brand Blog Posts";
const TARGET_BRAND_BLOG_NEWS = "BrandBlogNews";

async function main() {
  const task = await prisma.searchSourceTask.findFirst({
    where: { name: TASK_NAME, deleted_at: null },
  });

  if (!task) {
    console.log(
      `Task "${TASK_NAME}" not found. Create it in Admin > Search Sources > Custom Tasks, then run this script again.`
    );
    process.exit(0);
    return;
  }

  await prisma.searchSourceTask.updateMany({
    where: { name: TASK_NAME, deleted_at: null },
    data: {
      openai_prompt_text: BRAND_BLOG_SUMMARY_PROMPT,
      target: TARGET_BRAND_BLOG_NEWS,
    },
  });

  console.log(
    `Updated task "${TASK_NAME}": set openai_prompt_text and target="${TARGET_BRAND_BLOG_NEWS}".`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
