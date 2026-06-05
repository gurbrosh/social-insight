/**
 * Enrich brands linked to a project with Blog/News URL via OpenAI.
 * Uses the same instruction as the brand search (blog, newsroom, press page).
 *
 * Usage:
 *   npx tsx scripts/enrich-project-brands-blog-news.ts
 *   PROJECT_NAME=test12 npx tsx scripts/enrich-project-brands-blog-news.ts
 *
 * Requires: OPENAI_API_KEY, DATABASE_URL (or .env)
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { findBlogNewsUrl } from "../lib/brand-directory/blog-news-url";
import { updateBrand } from "../lib/brand-directory/brand-service";

const PROJECT_NAME = process.env.PROJECT_NAME || "test12";

async function main() {
  console.log(`\n📰 Enriching Blog/News URLs for brands in project "${PROJECT_NAME}"\n`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is not set. Set it in .env or environment.");
    process.exit(1);
  }

  const allProjects = await prisma.project.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true },
  });
  const project = allProjects.find((p) => p.name.toLowerCase() === PROJECT_NAME.toLowerCase());

  if (!project) {
    console.error(`❌ Project "${PROJECT_NAME}" not found.`);
    process.exit(1);
  }

  const projectBrands = await prisma.projectBrand.findMany({
    where: {
      project_id: project.id,
      brand_id: { not: null },
      deleted_at: null,
    },
    include: {
      brand: {
        where: { deleted_at: null },
        select: {
          id: true,
          brand_name: true,
          company_name: true,
          website_url: true,
          blog_news_url: true,
        },
      },
    },
  });

  const brands = projectBrands
    .map((pb) => pb.brand)
    .filter((b): b is NonNullable<typeof b> => b != null);

  if (brands.length === 0) {
    console.log(`No brands linked to project "${PROJECT_NAME}" (need ProjectBrand.brand_id set).`);
    process.exit(0);
  }

  console.log(`Found ${brands.length} brand(s):\n`);

  for (const brand of brands) {
    console.log(`  • ${brand.brand_name} (${brand.company_name})`);
    console.log(`    Current blog_news_url: ${brand.blog_news_url ?? "(none)"}`);

    const url = await findBlogNewsUrl(
      brand.brand_name,
      brand.company_name,
      brand.website_url ?? undefined
    );

    if (url) {
      await updateBrand(brand.id, { blog_news_url: url });
      console.log(`    ✅ Set blog_news_url: ${url}`);
    } else {
      console.log(`    ⏭️  No blog/news URL found (skipping update)`);
    }

    console.log("");
  }

  console.log("Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
