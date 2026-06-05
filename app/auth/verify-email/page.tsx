import { Suspense } from "react";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// Force dynamic rendering
export const dynamic = "force-dynamic";

interface VerifyEmailPageProps {
  searchParams: Promise<{
    token?: string;
  }>;
}

async function VerifyEmailContent({ searchParams }: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-destructive">Invalid Verification Link</CardTitle>
          <CardDescription>No verification token provided.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            The verification link appears to be invalid or incomplete.
          </p>
          <Link href="/auth/signin">
            <Button className="w-full">Go to Sign In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  try {
    // Verify the token
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error("AUTH_SECRET not configured");
    }

    const decoded = jwt.verify(token, secret) as { userId: string; type: string };

    if (!decoded) {
      throw new Error("Invalid or expired token");
    }

    if (decoded.type !== "verification") {
      throw new Error("Invalid token type");
    }

    // Check if user exists and update verification status
    const user = await prisma.user.findUnique({
      where: {
        id: decoded.userId,
        deleted_at: null,
      },
    });

    if (!user) {
      return (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">User Not Found</CardTitle>
            <CardDescription>
              The user associated with this verification link could not be found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              This could happen if the account was deleted or the link is very old.
            </p>
            <Link href="/auth/signup">
              <Button className="w-full">Create New Account</Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    // For this template, we&apos;ll just show success since we don't have an email_verified field
    // In a real app, you&apos;d update the user's email_verified status here
    // await prisma.user.update({
    //   where: { id: user.id },
    //   data: { email_verified: true }
    // });

    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-green-600">Email Verified Successfully!</CardTitle>
          <CardDescription>Your email address has been verified.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Thank you for verifying your email address. You can now sign in to your account.
          </p>
          <div className="space-y-2">
            <Link href="/auth/signin">
              <Button className="w-full">Sign In</Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="w-full">
                Go to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  } catch {
    console.error("Email verification error:");

    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-destructive">Verification Failed</CardTitle>
          <CardDescription>The verification link is invalid or has expired.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Verification links expire after 24 hours. You may need to request a new verification
            email.
          </p>
          <div className="space-y-2">
            <Link href="/auth/signin">
              <Button className="w-full">Sign In</Button>
            </Link>
            <Link href="/auth/signup">
              <Button variant="outline" className="w-full">
                Create New Account
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }
}

export default function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <Suspense
        fallback={
          <Card className="w-full max-w-md">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            </CardContent>
          </Card>
        }
      >
        <VerifyEmailContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
