import { prisma } from "../lib/prisma";

async function main() {
  // Create default roles
  const userRole = await prisma.role.upsert({
    where: { name: "user" },
    update: {},
    create: {
      name: "user",
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: {
      name: "admin",
    },
  });

  console.log({ userRole, adminRole });
  console.log("Database seeded successfully!");
  console.log("Note: No users created - use the first-time setup flow to create an admin user.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
