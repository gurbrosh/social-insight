/**
 * Find and update blog/news URLs for specific brands by name.
 * Uses findBlogNewsUrl (OpenAI → validate → SerpAPI fallback).
 *
 * Usage:
 *   npx tsx scripts/find-blog-news-urls-for-brands.ts
 *
 * Requires: OPENAI_API_KEY, DATABASE_URL. Optional: SERPAPI_KEY for fallback.
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { findBlogNewsUrl } from "../lib/brand-directory/blog-news-url";
import { updateBrand } from "../lib/brand-directory/brand-service";

const BRAND_NAMES = ["Avelo", "Avelo Airlines", "American Airlines"];

async function main() {
  console.log("\n📰 Finding Blog/News URLs for:", BRAND_NAMES.join(", "), "\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is not set. Set it in .env or environment.");
    process.exit(1);
  }

  const brands = await prisma.brand.findMany({
    where: {
      deleted_at: null,
      OR: BRAND_NAMES.flatMap((name) => [{ brand_name: name }, { company_name: name }]),
    },
    select: {
      id: true,
      brand_name: true,
      company_name: true,
      website_url: true,
      blog_news_url: true,
    },
  });

  if (brands.length === 0) {
    console.log("No brands found matching:", BRAND_NAMES.join(", "));
    console.log("Ensure these brands exist in the brand directory.");
    process.exit(0);
  }

  for (const brand of brands) {
    console.log(`  • ${brand.brand_name} (${brand.company_name})`);
    console.log(`    Website: ${brand.website_url ?? "(none)"}`);
    console.log(`    Current blog_news_url: ${brand.blog_news_url ?? "(none)"}`);

    const url = await findBlogNewsUrl(
      brand.brand_name,
      brand.company_name ?? undefined,
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
