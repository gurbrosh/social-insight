"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Facebook, CheckCircle, Loader2, Unlink, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FacebookConnectionProps {
  hasFacebookAccount: boolean;
  facebookProfileUrl?: string;
}

export function FacebookConnection({
  hasFacebookAccount,
  facebookProfileUrl,
}: FacebookConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      setIsConnecting(true);

      // Call the authorize endpoint
      const response = await fetch("/api/auth/facebook/authorize");

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

      // Redirect to Facebook OAuth
      window.location.href = data.authUrl;
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to connect Facebook",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);

      const response = await fetch("/api/auth/facebook/disconnect", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to disconnect Facebook");
      }

      toast({
        title: "Success",
        description: "Facebook account disconnected successfully",
      });

      // Reload page to update UI
      window.location.reload();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect Facebook",
        variant: "destructive",
      });
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Facebook className="h-5 w-5" />
          Facebook Connection
        </CardTitle>
        <CardDescription>
          Connect your Facebook account for identity verification and engagement tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFacebookAccount ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="font-medium">
                  Connected {facebookProfileUrl && `(${facebookProfileUrl})`}
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
                Your Facebook account is connected. This helps identify your replies in
                conversations and improves engagement tracking accuracy.
              </AlertDescription>
            </Alert>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Note:</strong> Facebook&apos;s Graph API has limitations on fetching public
                conversation threads. Engagement tracking primarily relies on scraped data from your
                database.
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
                  Disconnect Facebook
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Optional:</strong> Connect your Facebook account for better identity
                verification when tracking your engagement in conversations. The app works without
                this connection.
              </AlertDescription>
            </Alert>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Limitation:</strong> Facebook&apos;s Graph API has restrictions on fetching
                public conversations. Engagement tracking will primarily use scraped data from your
                database.
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
                  <Facebook className="mr-2 h-4 w-4" />
                  Connect Facebook Account
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Note: Facebook OAuth is optional. The app works with scraped data. OAuth requires
              Facebook Developer Portal configuration.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
