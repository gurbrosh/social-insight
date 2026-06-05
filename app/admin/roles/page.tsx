import { prisma } from "@/lib/prisma";
import { RoleManagementPanel } from "@/components/admin/RoleManagementPanel";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

async function getRoles() {
  const roles = await prisma.role.findMany({
    where: {
      deleted_at: null,
    },
    orderBy: {
      id: "asc",
    },
    include: {
      _count: {
        select: {
          users: {
            where: {
              deleted_at: null,
              user: {
                deleted_at: null,
              },
            },
          },
        },
      },
    },
  });

  // Convert dates to ISO strings for client component
  return roles.map((role) => ({
    ...role,
    created_at: role.created_at.toISOString(),
    updated_at: role.updated_at.toISOString(),
    deleted_at: role.deleted_at?.toISOString() ?? null,
  }));
}

export default async function RolesPage() {
  const roles = await getRoles();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Role Management</h1>
        <p className="text-muted-foreground">Create and manage roles for your application</p>
      </div>

      <RoleManagementPanel initialRoles={roles} />
    </div>
  );
}
