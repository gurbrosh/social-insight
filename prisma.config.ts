import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  migrations: {
    seed: "npx --yes tsx prisma/seed.ts",
  },
});
