import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function MagicLinkPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Magic Link Authentication</CardTitle>
          <CardDescription>Magic link authentication is processed automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            If you clicked a magic link from your email, you should have been automatically signed
            in and redirected. If you&apos;re seeing this page, the link may have expired or been
            invalid.
          </p>
          <div className="space-y-2">
            <Link href="/auth/signin">
              <Button className="w-full">Try Signing In Again</Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="w-full">
                Go to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
