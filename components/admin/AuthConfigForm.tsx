"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CheckCircle,
  AlertTriangle,
  Loader2,
  Fingerprint,
  HelpCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  updateAuthSettings,
  getCurrentAuthSettings,
  type AuthSettings,
} from "@/app/actions/auth-settings";

export function AuthConfigForm() {
  const [settings, setSettings] = useState<AuthSettings>({
    enableEmailPassword: true,
    enableMagicLink: true,
    enableGoogleAuth: false,
    enableGithubAuth: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isGithubCopied, setIsGithubCopied] = useState(false);
  const [googleHelpOpen, setGoogleHelpOpen] = useState(false);
  const [githubHelpOpen, setGithubHelpOpen] = useState(false);
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showGithubSecret, setShowGithubSecret] = useState(false);

  // Handle Google OAuth toggle with credential check
  const handleGoogleAuthToggle = (checked: boolean) => {
    setSettings({ ...settings, enableGoogleAuth: checked });

    // If enabling and credentials are missing, show help dialog
    if (checked && (!settings.googleClientId || !settings.googleClientSecret)) {
      setGoogleHelpOpen(true);
    }
  };

  // Handle GitHub OAuth toggle with credential check
  const handleGithubAuthToggle = (checked: boolean) => {
    setSettings({ ...settings, enableGithubAuth: checked });

    // If enabling and credentials are missing, show help dialog
    if (checked && (!settings.githubClientId || !settings.githubClientSecret)) {
      setGithubHelpOpen(true);
    }
  };

  // Load current settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const currentSettings = await getCurrentAuthSettings();
        setSettings(currentSettings);
      } catch (error) {
        console.error("Failed to load auth settings:", error);
        setMessage({ type: "error", text: "Failed to load current settings" });
      } finally {
        setIsLoadingSettings(false);
      }
    }

    loadSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateAuthSettings(settings);
      if (result.success) {
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update authentication settings" });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            Authentication Configuration
          </CardTitle>
          <CardDescription>Configure authentication providers and methods</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading settings...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5" />
          Authentication Configuration
        </CardTitle>
        <CardDescription>Configure authentication providers and methods</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {message && (
            <Alert variant={message.type === "error" ? "destructive" : "default"}>
              {message.type === "success" ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          {/* Authentication Methods */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm">Authentication Methods</h3>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="emailPassword"
                  checked={settings.enableEmailPassword}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, enableEmailPassword: !!checked })
                  }
                />
                <Label htmlFor="emailPassword" className="text-sm">
                  Email & Password Authentication
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="magicLink"
                  checked={settings.enableMagicLink}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, enableMagicLink: !!checked })
                  }
                />
                <Label htmlFor="magicLink" className="text-sm">
                  Magic Link Authentication
                </Label>
              </div>
            </div>
          </div>

          <Separator />

          {/* OAuth Providers */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm">OAuth Providers</h3>

            {/* Google OAuth */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="googleAuth"
                  checked={settings.enableGoogleAuth}
                  onCheckedChange={(checked) => handleGoogleAuthToggle(!!checked)}
                />
                <Label htmlFor="googleAuth" className="text-sm">
                  Google OAuth
                </Label>
                <Dialog open={googleHelpOpen} onOpenChange={setGoogleHelpOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-auto p-1">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>How to Create a Google OAuth App</DialogTitle>
                      <DialogDescription>
                        Follow these steps to set up Google OAuth authentication for your
                        application.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 text-sm">
                      {/* Callback URL Section */}
                      <div className="space-y-3 p-4 bg-muted rounded-lg">
                        <h4 className="font-semibold text-base">
                          Callback URL for Google Cloud Console
                        </h4>
                        <div className="grid gap-2">
                          <Label className="text-sm">
                            Copy this URL to your Google OAuth app configuration:
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={`${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/google`}
                              className="font-mono text-xs bg-background"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                const url = `${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/google`;
                                await navigator.clipboard.writeText(url);
                                setIsCopied(true);
                                setTimeout(() => setIsCopied(false), 2000);
                              }}
                            >
                              {isCopied ? "Copied!" : "Copy"}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Credentials Input Section */}
                      <div className="space-y-3 p-4 bg-muted rounded-lg">
                        <h4 className="font-semibold text-base">
                          Enter Your Google OAuth Credentials
                        </h4>
                        <div className="space-y-3">
                          <div className="grid gap-2">
                            <Label htmlFor="dialogGoogleClientId" className="text-sm">
                              Google Client ID
                            </Label>
                            <Input
                              id="dialogGoogleClientId"
                              type="text"
                              placeholder="Enter Google Client ID"
                              value={settings.googleClientId || ""}
                              onChange={(e) =>
                                setSettings({ ...settings, googleClientId: e.target.value })
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="dialogGoogleClientSecret" className="text-sm">
                              Google Client Secret
                            </Label>
                            <div className="relative">
                              <Input
                                id="dialogGoogleClientSecret"
                                type={showGoogleSecret ? "text" : "password"}
                                placeholder="Enter Google Client Secret"
                                value={settings.googleClientSecret || ""}
                                onChange={(e) =>
                                  setSettings({ ...settings, googleClientSecret: e.target.value })
                                }
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => setShowGoogleSecret(!showGoogleSecret)}
                              >
                                {showGoogleSecret ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Instructions */}
                      <div className="space-y-4">
                        <h4 className="font-semibold text-base">Step-by-Step Instructions</h4>

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <h5 className="font-semibold">1. Go to Google Cloud Console</h5>
                            <p>
                              Visit{" "}
                              <a
                                href="https://console.cloud.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                https://console.cloud.google.com/
                              </a>{" "}
                              and sign in with your Google account.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">2. Create or Select a Project</h5>
                            <p>
                              Create a new project or select an existing one from the project
                              dropdown at the top of the page.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">3. Enable Google+ API</h5>
                            <p>
                              Go to &quot;APIs &amp; Services&quot; → &quot;Library&quot; and search
                              for &quot;Google+ API&quot; or &quot;Google Identity&quot;. Enable the
                              API for your project.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">4. Configure OAuth Consent Screen</h5>
                            <p>
                              Go to &quot;APIs &amp; Services&quot; → &quot;OAuth consent
                              screen&quot;. Choose &quot;External&quot; user type and fill in the
                              required application information.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">5. Create OAuth 2.0 Credentials</h5>
                            <p>
                              Go to &quot;APIs &amp; Services&quot; → &quot;Credentials&quot; →
                              &quot;Create Credentials&quot; → &quot;OAuth 2.0 Client IDs&quot;.
                            </p>
                            <p>Select &quot;Web application&quot; as the application type.</p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">6. Configure Redirect URIs</h5>
                            <p>
                              In the &quot;Authorized redirect URIs&quot; section, add the callback
                              URL shown above (use the Copy button to copy it).
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">7. Copy Credentials</h5>
                            <p>
                              After creating the OAuth client, copy the <strong>Client ID</strong>{" "}
                              and <strong>Client Secret</strong> and paste them into the fields
                              above in this dialog. They will automatically populate the main form.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {settings.enableGoogleAuth && (
                <div className="pl-6 space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="googleCallbackUrl" className="text-sm">
                      Callback URL (Copy this to Google Cloud Console)
                    </Label>
                    <Input
                      id="googleCallbackUrl"
                      type="text"
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/google`}
                      className="font-mono text-xs bg-muted"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="googleClientId" className="text-sm">
                      Google Client ID
                    </Label>
                    <Input
                      id="googleClientId"
                      type="text"
                      placeholder="Enter Google Client ID"
                      value={settings.googleClientId || ""}
                      onChange={(e) => setSettings({ ...settings, googleClientId: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="googleClientSecret" className="text-sm">
                      Google Client Secret
                    </Label>
                    <div className="relative">
                      <Input
                        id="googleClientSecret"
                        type={showGoogleSecret ? "text" : "password"}
                        placeholder="Enter Google Client Secret"
                        value={settings.googleClientSecret || ""}
                        onChange={(e) =>
                          setSettings({ ...settings, googleClientSecret: e.target.value })
                        }
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowGoogleSecret(!showGoogleSecret)}
                      >
                        {showGoogleSecret ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* GitHub OAuth */}
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="githubAuth"
                  checked={settings.enableGithubAuth}
                  onCheckedChange={(checked) => handleGithubAuthToggle(!!checked)}
                />
                <Label htmlFor="githubAuth" className="text-sm">
                  GitHub OAuth
                </Label>
                <Dialog open={githubHelpOpen} onOpenChange={setGithubHelpOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-auto p-1">
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>How to Create a GitHub OAuth App</DialogTitle>
                      <DialogDescription>
                        Follow these steps to set up GitHub OAuth authentication for your
                        application.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 text-sm">
                      {/* Callback URL Section */}
                      <div className="space-y-3 p-4 bg-muted rounded-lg">
                        <h4 className="font-semibold text-base">
                          Callback URL for GitHub OAuth App
                        </h4>
                        <div className="grid gap-2">
                          <Label className="text-sm">
                            Copy this URL to your GitHub OAuth app configuration:
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              readOnly
                              value={`${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/github`}
                              className="font-mono text-xs bg-background"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                const url = `${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/github`;
                                await navigator.clipboard.writeText(url);
                                setIsGithubCopied(true);
                                setTimeout(() => setIsGithubCopied(false), 2000);
                              }}
                            >
                              {isGithubCopied ? "Copied!" : "Copy"}
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Credentials Input Section */}
                      <div className="space-y-3 p-4 bg-muted rounded-lg">
                        <h4 className="font-semibold text-base">
                          Enter Your GitHub OAuth Credentials
                        </h4>
                        <div className="space-y-3">
                          <div className="grid gap-2">
                            <Label htmlFor="dialogGithubClientId" className="text-sm">
                              GitHub Client ID
                            </Label>
                            <Input
                              id="dialogGithubClientId"
                              type="text"
                              placeholder="Enter GitHub Client ID"
                              value={settings.githubClientId || ""}
                              onChange={(e) =>
                                setSettings({ ...settings, githubClientId: e.target.value })
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="dialogGithubClientSecret" className="text-sm">
                              GitHub Client Secret
                            </Label>
                            <div className="relative">
                              <Input
                                id="dialogGithubClientSecret"
                                type={showGithubSecret ? "text" : "password"}
                                placeholder="Enter GitHub Client Secret"
                                value={settings.githubClientSecret || ""}
                                onChange={(e) =>
                                  setSettings({ ...settings, githubClientSecret: e.target.value })
                                }
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                onClick={() => setShowGithubSecret(!showGithubSecret)}
                              >
                                {showGithubSecret ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Instructions */}
                      <div className="space-y-4">
                        <h4 className="font-semibold text-base">Step-by-Step Instructions</h4>

                        <div className="space-y-3">
                          <div className="space-y-2">
                            <h5 className="font-semibold">1. Go to GitHub Developer Settings</h5>
                            <p>
                              Visit{" "}
                              <a
                                href="https://github.com/settings/developers"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                https://github.com/settings/developers
                              </a>{" "}
                              and sign in to your GitHub account.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">2. Create New OAuth App</h5>
                            <p>
                              Click on &quot;OAuth Apps&quot; in the left sidebar, then click
                              &quot;New OAuth App&quot; button.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">3. Fill Application Details</h5>
                            <p>
                              Enter your application name, homepage URL, and application
                              description.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">4. Set Authorization Callback URL</h5>
                            <p>
                              In the &quot;Authorization callback URL&quot; field, paste the
                              callback URL shown above (use the Copy button to copy it).
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">5. Register Application</h5>
                            <p>Click &quot;Register application&quot; to create your OAuth app.</p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">6. Generate Client Secret</h5>
                            <p>
                              After creating the app, click &quot;Generate a new client secret&quot;
                              to create your client secret.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <h5 className="font-semibold">7. Copy Credentials</h5>
                            <p>
                              Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>{" "}
                              and paste them into the fields above in this dialog. They will
                              automatically populate the main form.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {settings.enableGithubAuth && (
                <div className="pl-6 space-y-3">
                  <div className="grid gap-2">
                    <Label htmlFor="githubCallbackUrl" className="text-sm">
                      Callback URL (Copy this to GitHub OAuth App)
                    </Label>
                    <Input
                      id="githubCallbackUrl"
                      type="text"
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/github`}
                      className="font-mono text-xs bg-muted"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="githubClientId" className="text-sm">
                      GitHub Client ID
                    </Label>
                    <Input
                      id="githubClientId"
                      type="text"
                      placeholder="Enter GitHub Client ID"
                      value={settings.githubClientId || ""}
                      onChange={(e) => setSettings({ ...settings, githubClientId: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="githubClientSecret" className="text-sm">
                      GitHub Client Secret
                    </Label>
                    <div className="relative">
                      <Input
                        id="githubClientSecret"
                        type={showGithubSecret ? "text" : "password"}
                        placeholder="Enter GitHub Client Secret"
                        value={settings.githubClientSecret || ""}
                        onChange={(e) =>
                          setSettings({ ...settings, githubClientSecret: e.target.value })
                        }
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowGithubSecret(!showGithubSecret)}
                      >
                        {showGithubSecret ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Authentication Settings"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
