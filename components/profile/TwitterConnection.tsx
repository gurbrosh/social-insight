"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Twitter, CheckCircle, Loader2, Unlink, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TwitterConnectionProps {
  hasTwitterAccount: boolean;
  twitterUsername?: string;
}

export function TwitterConnection({ hasTwitterAccount, twitterUsername }: TwitterConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      setIsConnecting(true);

      // Call the authorize endpoint
      const response = await fetch("/api/auth/twitter/authorize");

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

      // Redirect to Twitter OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to connect Twitter",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);

      const response = await fetch("/api/auth/twitter/disconnect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to disconnect Twitter");
      }

      toast({
        title: "Success",
        description: "Twitter account disconnected successfully",
      });

      // Reload page to update UI
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect Twitter",
        variant: "destructive",
      });
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Twitter className="h-5 w-5" />
          Twitter API Connection
        </CardTitle>
        <CardDescription>
          Connect your Twitter account to enable engagement tracking and reply detection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasTwitterAccount ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium">
                  Connected {twitterUsername && `as @${twitterUsername}`}
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
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Your Twitter account is connected. The app can now track your replies and engagement
                metrics on Twitter conversations.
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
                  Disconnect Twitter
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Optional:</strong> Connect your Twitter account for personalized rate limits
                and better tracking. The app works without this - it uses a shared API token for all
                users. Connecting your account gives you your own rate limits and better control.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              className="w-full"
              variant="default"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Twitter className="mr-2 h-4 w-4" />
                  Connect Twitter Account
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Note: Twitter OAuth is optional. The app works with a shared API token. OAuth requires
              Twitter Developer Portal configuration (may require paid plan).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
