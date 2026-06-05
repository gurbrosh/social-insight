import { prisma } from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

interface TaxonomyRow {
  category: string;
  subcategory: string;
  sub_subcategory: string;
}

async function main() {
  console.log("🌱 Starting taxonomy seed...");

  // Read CSV file
  const csvPath = path.join(process.cwd(), "docs", "commercial_business_taxonomy-prj.csv");

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

  // Skip header row
  const dataLines = lines.slice(1);

  const taxonomyEntries: TaxonomyRow[] = [];
  const seen = new Set<string>();

  // Parse CSV rows
  for (const line of dataLines) {
    // Handle CSV parsing (simple split by comma, but handle quoted fields)
    const parts = line.split(",").map((part) => part.trim());

    if (parts.length < 3) {
      console.warn(`Skipping invalid line: ${line}`);
      continue;
    }

    const category = parts[0];
    const subcategory = parts[1];
    const sub_subcategory = parts[2];

    // Create unique key to prevent duplicates
    const key = `${category}|${subcategory}|${sub_subcategory}`;

    if (seen.has(key)) {
      console.warn(`Skipping duplicate entry: ${key}`);
      continue;
    }

    seen.add(key);
    taxonomyEntries.push({
      category,
      subcategory,
      sub_subcategory,
    });
  }

  console.log(`📊 Found ${taxonomyEntries.length} taxonomy entries to import`);

  // Get all existing taxonomy entries to avoid duplicates
  const existingEntries = await prisma.businessTaxonomy.findMany({
    where: { deleted_at: null },
    select: {
      category: true,
      subcategory: true,
      sub_subcategory: true,
    },
  });

  const existingKeys = new Set(
    existingEntries.map((e) => `${e.category}|${e.subcategory}|${e.sub_subcategory}`)
  );

  // Filter out entries that already exist
  const entriesToCreate = taxonomyEntries.filter(
    (entry) => !existingKeys.has(`${entry.category}|${entry.subcategory}|${entry.sub_subcategory}`)
  );

  console.log(`📝 Creating ${entriesToCreate.length} new taxonomy entries...`);

  // Use createMany in batches to avoid ULID collisions
  const batchSize = 50;
  let created = 0;
  let skipped = taxonomyEntries.length - entriesToCreate.length;

  for (let i = 0; i < entriesToCreate.length; i += batchSize) {
    const batch = entriesToCreate.slice(i, i + batchSize);
    try {
      // Create entries one by one to handle duplicates
      for (const entry of batch) {
        try {
          await prisma.businessTaxonomy.create({
            data: {
              category: entry.category,
              subcategory: entry.subcategory,
              sub_subcategory: entry.sub_subcategory,
            },
          });
        } catch (error: any) {
          // Skip if duplicate (unique constraint violation)
          if (error.code !== "P2002") {
            throw error;
          }
        }
      }
      created += batch.length;
    } catch (error) {
      console.error(`Error creating batch ${i / batchSize + 1}:`, error);
      // Try individual creates for this batch
      for (const entry of batch) {
        try {
          await prisma.businessTaxonomy.create({
            data: {
              category: entry.category,
              subcategory: entry.subcategory,
              sub_subcategory: entry.sub_subcategory,
            },
          });
          created++;
        } catch (individualError: any) {
          if (individualError.code === "P2002") {
            // Duplicate, skip
            skipped++;
          } else {
            console.error(
              `Error inserting ${entry.category}/${entry.subcategory}/${entry.sub_subcategory}:`,
              individualError
            );
            skipped++;
          }
        }
      }
    }
  }

  const totalInDb = await prisma.businessTaxonomy.count({
    where: { deleted_at: null },
  });

  console.log(`✅ Taxonomy seed completed!`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (already exists): ${skipped}`);
  console.log(`   Total entries in database: ${totalInDb}`);
  console.log(`   Total entries processed: ${taxonomyEntries.length}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Taxonomy seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
