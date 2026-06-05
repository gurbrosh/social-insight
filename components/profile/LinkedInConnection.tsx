"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Linkedin, CheckCircle, Loader2, Unlink, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LinkedInConnectionProps {
  hasLinkedInAccount: boolean;
  linkedInProfileUrl?: string;
}

export function LinkedInConnection({
  hasLinkedInAccount,
  linkedInProfileUrl,
}: LinkedInConnectionProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      setIsConnecting(true);

      // Call the authorize endpoint
      const response = await fetch("/api/auth/linkedin/authorize");

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        const errorMessage =
          errorData.message || errorData.error || `Server error: ${response.status}`;
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (!data.authUrl) {
        throw new Error("No authorization URL received");
      }

      // Redirect to LinkedIn OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to connect LinkedIn",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);

      const response = await fetch("/api/auth/linkedin/disconnect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to disconnect LinkedIn");
      }

      toast({
        title: "Success",
        description: "LinkedIn account disconnected successfully",
      });

      // Reload page to update UI
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect LinkedIn",
        variant: "destructive",
      });
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Linkedin className="h-5 w-5" />
          LinkedIn Connection
        </CardTitle>
        <CardDescription>
          Connect your LinkedIn account for identity verification and engagement tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasLinkedInAccount ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium">
                  Connected {linkedInProfileUrl && `(${linkedInProfileUrl})`}
                </span>
              </div>
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
              >
                Active
              </Badge>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Your LinkedIn account is connected. This helps identify your replies in
                conversations and improves engagement tracking accuracy.
              </AlertDescription>
            </Alert>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Note:</strong> LinkedIn&apos;s API doesn&apos;t support fetching public
                conversation threads. Engagement tracking relies on scraped data from your database.
              </AlertDescription>
            </Alert>

            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="w-full"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                <>
                  <Unlink className="mr-2 h-4 w-4" />
                  Disconnect LinkedIn
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>LinkedIn OAuth Unavailable:</strong> LinkedIn requires product approval
                (&quot;Sign In with LinkedIn&quot;) to use OAuth, which is not available for your
                app.
                <br />
                <br />
                <strong>Good news:</strong> LinkedIn engagement tracking{" "}
                <strong>works perfectly without OAuth</strong> using scraped data.
              </AlertDescription>
            </Alert>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>To track your LinkedIn engagement:</strong>
                <ol className="mt-2 ml-4 list-decimal space-y-1 text-sm">
                  <li>Go to &quot;User Identities&quot; section below</li>
                  <li>
                    Add your LinkedIn profile URL manually (e.g.,{" "}
                    <code className="bg-muted px-1 rounded">
                      https://www.linkedin.com/in/yourname
                    </code>
                    )
                  </li>
                  <li>
                    Engagement tracking will automatically match your replies in scraped
                    conversations
                  </li>
                </ol>
              </AlertDescription>
            </Alert>

            <Button onClick={handleConnect} disabled={true} className="w-full" variant="outline">
              <AlertCircle className="mr-2 h-4 w-4" />
              OAuth Unavailable (Requires LinkedIn Approval)
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              <strong>Note:</strong> LinkedIn OAuth requires product approval which is not
              available.
              <br />
              Use the &quot;User Identities&quot; section below to add your LinkedIn profile
              manually.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
