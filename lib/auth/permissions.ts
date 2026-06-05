import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function hasRole(userId: string, roleName: string): Promise<boolean> {
  const userRole = await prisma.userRole.findFirst({
    where: {
      user_id: userId,
      role: {
        name: roleName,
      },
      deleted_at: null,
    },
  });

  return !!userRole;
}

export async function requireRole(roleName: string) {
  const session = await auth();

  if (!session?.user) {
    // Get the current URL to redirect back to after authentication
    const headersList = await headers();
    const currentPath = headersList.get("x-pathname");

    if (currentPath && currentPath !== "/auth/signin") {
      const signInUrl = `/auth/signin?callbackUrl=${encodeURIComponent(currentPath)}`;
      redirect(signInUrl);
    } else {
      redirect("/auth/signin");
    }
  }

  const hasRequiredRole = await hasRole(session.user.id, roleName);

  if (!hasRequiredRole) {
    redirect("/");
  }

  return session;
}

export async function isAdmin(userId: string): Promise<boolean> {
  return hasRole(userId, "admin");
}

export async function getCurrentUser() {
  try {
    const session = await auth();

    if (!session?.user) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
        deleted_at: null,
      },
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
    });

    return user;
  } catch (error) {
    // Log detailed error information
    const errorDetails =
      error && typeof error === "object" && "name" in error
        ? {
            name: (error as any).name,
            message: (error as any).message,
            code: (error as any).code,
            meta: (error as any).meta,
            cause: (error as any).cause,
            clientVersion: (error as any).clientVersion,
            stack: (error as any).stack,
          }
        : error;
    console.error("Error getting current user:", JSON.stringify(errorDetails, null, 2));
    // Return null on error to allow page to continue loading
    return null;
  }
}

// Helper function to check if current user is admin (using session roles for performance)
export async function isCurrentUserAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.roles?.includes("admin") || false;
}

// Helper function to check if current user has specific role (using session roles for performance)
export async function currentUserHasRole(roleName: string): Promise<boolean> {
  const session = await auth();
  return session?.user?.roles?.includes(roleName) || false;
}
