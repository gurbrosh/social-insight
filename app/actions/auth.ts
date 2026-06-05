"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Server action to clear invalid session and redirect to home
 */
export async function clearInvalidSessionAction() {
  redirect("/auth/signin");
}

/**
 * Server action to sign out using Auth.js
 */
export async function signOutAction() {
  // Note: signOut from next-auth/react is client-side
  // For server actions, we just redirect to sign-in
  redirect("/auth/signin");
}

/**
 * Server action to disconnect an OAuth account
 */
export async function disconnectOAuthAccountAction(provider: string) {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  try {
    // Get user with accounts and check if they have a password
    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id,
        deleted_at: null,
      },
      include: {
        accounts: {
          where: { provider },
        },
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Check if user has a password (email/password auth)
    if (!user.password) {
      throw new Error(
        "Cannot disconnect OAuth account without email/password authentication set up"
      );
    }

    // Check if the account exists
    if (user.accounts.length === 0) {
      throw new Error(`${provider} account not found`);
    }

    // Delete the OAuth account
    await prisma.account.deleteMany({
      where: {
        userId: user.id,
        provider: provider,
      },
    });

    // Revalidate the profile page to show updated state
    revalidatePath("/profile");

    return { success: true, message: `${provider} account disconnected successfully` };
  } catch (error) {
    console.error("Error disconnecting OAuth account:", error);

    if (error instanceof Error) {
      throw new Error(error.message);
    }

    throw new Error(`Failed to disconnect ${provider} account`);
  }
}
