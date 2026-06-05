#!/usr/bin/env tsx

import { getSystemActivity } from "../lib/system-activity";

async function main() {
  try {
    console.log("🔬 Testing getSystemActivity() without project filter...");
    const activity = await getSystemActivity({});
    console.log("✅ getSystemActivity() result:\n", JSON.stringify(activity, null, 2));
  } catch (error) {
    console.error("❌ getSystemActivity() threw an error:");
    console.error(error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
      console.error("Name:", error.name);
    }
    process.exit(1);
  }
}

main();
