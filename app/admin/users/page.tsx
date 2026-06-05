import { prisma } from "@/lib/prisma";
import { UserManagementPanel } from "@/components/admin/UserManagementPanel";
import { getCurrentUser } from "@/lib/auth/permissions";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

const ITEMS_PER_PAGE = 10;

async function getRoles() {
  return prisma.role.findMany({
    where: {
      deleted_at: null,
    },
    orderBy: {
      id: "asc",
    },
  });
}

async function getUsers(page: number = 1, search?: string) {
  const skip = (page - 1) * ITEMS_PER_PAGE;

  // For SQLite, we need to handle case-insensitive search manually
  const where = search
    ? {
        deleted_at: null,
        OR: [
          {
            email: {
              contains: search.toLowerCase(),
            },
          },
          {
            name: {
              contains: search.toLowerCase(),
            },
          },
        ],
      }
    : {
        deleted_at: null,
      };

  const [users, count] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: ITEMS_PER_PAGE,
      orderBy: { created_at: "desc" },
      include: {
        profile: true,
        roles: {
          where: {
            deleted_at: null,
          },
          include: {
            role: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Convert dates to ISO strings for client component
  const serializedUsers = users.map((user) => ({
    ...user,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
    deleted_at: user.deleted_at?.toISOString() ?? null,
    last_signed_in: user.last_signed_in?.toISOString() ?? null,
    profile: user.profile
      ? {
          ...user.profile,
          created_at: user.profile.created_at.toISOString(),
          updated_at: user.profile.updated_at.toISOString(),
          deleted_at: user.profile.deleted_at?.toISOString() ?? null,
        }
      : null,
    roles: user.roles.map((userRole) => ({
      ...userRole,
      created_at: userRole.created_at.toISOString(),
      updated_at: userRole.updated_at.toISOString(),
      deleted_at: userRole.deleted_at?.toISOString() ?? null,
      role: {
        ...userRole.role,
        created_at: userRole.role.created_at.toISOString(),
        updated_at: userRole.role.updated_at.toISOString(),
        deleted_at: userRole.role.deleted_at?.toISOString() ?? null,
      },
    })),
  }));

  return { users: serializedUsers, count };
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1");
  const search = params.search;

  const [{ users, count }, currentUser, roles] = await Promise.all([
    getUsers(page, search),
    getCurrentUser(),
    getRoles(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="text-muted-foreground">Manage user accounts and permissions</p>
      </div>

      <UserManagementPanel
        initialUsers={users}
        totalCount={count}
        currentPage={page}
        itemsPerPage={ITEMS_PER_PAGE}
        currentUserId={currentUser?.id || ""}
        availableRoles={roles}
      />
    </div>
  );
}
