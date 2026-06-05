"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link2, CheckCircle, AlertCircle, Loader2, Unlink } from "lucide-react";
import { isGoogleAuthEnabled, isGitHubAuthEnabled } from "@/lib/auth/providers";
import { disconnectOAuthAccountAction } from "@/app/actions/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AccountLinkingProps {
  user: {
    accounts: Array<{
      provider: string;
      type: string;
    }>;
  };
  hasOAuthAccounts: boolean;
  hasEmailPassword: boolean;
}

export function AccountLinking({
  user,
  hasOAuthAccounts: _hasOAuthAccounts,
  hasEmailPassword,
}: AccountLinkingProps) {
  const [isLinking, setIsLinking] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState<string | null>(null);
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check if Google is connected
  const hasGoogleAccount = user.accounts.some((account) => account.provider === "google");
  const googleEnabled = isGoogleAuthEnabled();

  // Check if GitHub is connected
  const hasGitHubAccount = user.accounts.some((account) => account.provider === "github");
  const githubEnabled = isGitHubAuthEnabled();

  // Check if user can disconnect OAuth (has email/password OR multiple OAuth providers)
  const canDisconnectOAuth = hasEmailPassword || user.accounts.length > 1;

  const handleLinkGoogle = async () => {
    try {
      setIsLinking(true);
      setLinkingError(null);
      setSuccessMessage(null);

      // Use signIn to link the account
      const result = await signIn("google", {
        callbackUrl: "/profile?linked=google",
      });

      if (result?.error) {
        throw new Error("Failed to link Google account");
      }
    } catch (error) {
      setLinkingError(error instanceof Error ? error.message : "Failed to link account");
      setIsLinking(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      setIsDisconnecting("google");
      setDisconnectError(null);
      setSuccessMessage(null);

      const result = await disconnectOAuthAccountAction("google");

      if (result.success) {
        setSuccessMessage(result.message);
      }
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : "Failed to disconnect account");
    } finally {
      setIsDisconnecting(null);
    }
  };

  const handleLinkGitHub = async () => {
    try {
      setIsLinking(true);
      setLinkingError(null);
      setSuccessMessage(null);

      // Use signIn to link the account
      const result = await signIn("github", {
        callbackUrl: "/profile?linked=github",
      });

      if (result?.error) {
        throw new Error("Failed to link GitHub account");
      }
    } catch (error) {
      setLinkingError(error instanceof Error ? error.message : "Failed to link account");
      setIsLinking(false);
    }
  };

  const handleDisconnectGitHub = async () => {
    try {
      setIsDisconnecting("github");
      setDisconnectError(null);
      setSuccessMessage(null);

      const result = await disconnectOAuthAccountAction("github");

      if (result.success) {
        setSuccessMessage(result.message);
      }
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : "Failed to disconnect account");
    } finally {
      setIsDisconnecting(null);
    }
  };

  // Always show the comprehensive account linking view

  // Show account linking options for all users
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Connected Accounts
        </CardTitle>
        <CardDescription>Manage your connected social accounts and add new ones</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linkingError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{linkingError}</AlertDescription>
          </Alert>
        )}

        {disconnectError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{disconnectError}</AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {/* Google Account Linking */}
          {googleEnabled && (
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <Image src="/icons/google-icon.svg" alt="Google" width={20} height={20} />
                <div>
                  <div className="font-medium">Google</div>
                  <div className="text-sm text-muted-foreground">
                    {hasGoogleAccount ? "Connected" : "Link your Google account"}
                  </div>
                </div>
              </div>

              {hasGoogleAccount ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-600 border-green-200">
                    Connected
                  </Badge>
                  {/* Show disconnect if user has alternative auth */}
                  {canDisconnectOAuth && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDisconnectGoogle}
                            disabled={isDisconnecting === "google"}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            {isDisconnecting === "google" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Unlink className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Disconnect</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLinkGoogle}
                  disabled={isLinking}
                  className="min-w-[80px]"
                >
                  {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
                </Button>
              )}
            </div>
          )}

          {/* GitHub Account Linking */}
          {githubEnabled && (
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <Image src="/icons/github-icon.svg" alt="GitHub" width={20} height={20} />
                <div>
                  <div className="font-medium">GitHub</div>
                  <div className="text-sm text-muted-foreground">
                    {hasGitHubAccount ? "Connected" : "Link your GitHub account"}
                  </div>
                </div>
              </div>

              {hasGitHubAccount ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-600 border-green-200">
                    Connected
                  </Badge>
                  {/* Show disconnect if user has alternative auth */}
                  {canDisconnectOAuth && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDisconnectGitHub}
                            disabled={isDisconnecting === "github"}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            {isDisconnecting === "github" ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Unlink className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Disconnect</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLinkGitHub}
                  disabled={isLinking}
                  className="min-w-[80px]"
                >
                  {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
                </Button>
              )}
            </div>
          )}

          {/* Future providers can be added here */}
          {!googleEnabled && !githubEnabled && (
            <div className="text-center py-8 text-muted-foreground">
              <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No OAuth providers are currently enabled</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
