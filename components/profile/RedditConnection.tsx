"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessageSquare, CheckCircle, Loader2, Unlink, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RedditConnectionProps {
  hasRedditAccount: boolean;
  redditUsername?: string;
}

export function RedditConnection({ hasRedditAccount, redditUsername }: RedditConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      setIsConnecting(true);

      // Call the authorize endpoint
      const response = await fetch("/api/auth/reddit/authorize");

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

      // Redirect to Reddit OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to connect Reddit",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);

      const response = await fetch("/api/auth/reddit/disconnect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to disconnect Reddit");
      }

      toast({
        title: "Success",
        description: "Reddit account disconnected successfully",
      });

      // Reload page to update UI
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect Reddit",
        variant: "destructive",
      });
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Reddit Connection
        </CardTitle>
        <CardDescription>
          Connect your Reddit account for better engagement tracking and identity verification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasRedditAccount ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium">
                  Connected as {redditUsername && `u/${redditUsername}`}
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
                Your Reddit account is connected. This provides:
                <ul className="mt-2 ml-4 list-disc space-y-1 text-sm">
                  <li>Better rate limits (60 requests/minute authenticated vs public)</li>
                  <li>More reliable access to comments and threads</li>
                  <li>Improved identity verification for reply detection</li>
                </ul>
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
                  Disconnect Reddit
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Note:</strong> Reddit engagement tracking{" "}
                <strong>already works without OAuth</strong> using public endpoints. Connecting your
                Reddit account is <strong>completely optional</strong> and only provides:
                <ul className="mt-2 ml-4 list-disc space-y-1 text-sm">
                  <li>Better rate limits (60/min vs public limits)</li>
                  <li>Slightly more reliable access</li>
                </ul>
                <strong className="mt-2 block">
                  You don&apos;t need this for engagement tracking to work.
                </strong>
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
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Connect Reddit Account
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              <strong>Important:</strong> Reddit engagement tracking works perfectly without OAuth.
              You only need OAuth if you want better rate limits for high-volume usage. No setup
              required for basic engagement tracking.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
