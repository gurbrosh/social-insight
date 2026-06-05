"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle, AlertTriangle, Loader2, Mail, TestTube2, HelpCircle } from "lucide-react";
import {
  updateEmailSettings,
  getCurrentEmailSettings,
  testEmailConfiguration,
  checkCrunchyConeAuth,
  checkEmailProviderAvailability,
  type EmailSettings,
  type EmailProvider,
} from "@/app/actions/email-settings";

export function EmailConfigForm() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<EmailSettings>({
    provider: "console",
    fromAddress: "noreply@crunchycone.app",
    fromDisplayName: "",
    smtpSecure: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [crunchyConeAuthStatus, setCrunchyConeAuthStatus] = useState<{
    authenticated: boolean;
    user?: { email?: string; name?: string } | null;
    source?: string;
  } | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [smtpProvider, setSmtpProvider] = useState<string>("google");
  const [providerAvailability, setProviderAvailability] = useState<
    Record<string, { available: boolean; checking: boolean }>
  >({});
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");

  const checkProviderAvailability = async (provider: EmailProvider) => {
    setProviderAvailability((prev) => ({
      ...prev,
      [provider]: { available: false, checking: true },
    }));

    try {
      const result = await checkEmailProviderAvailability(provider);
      setProviderAvailability((prev) => ({
        ...prev,
        [provider]: { available: result.available, checking: false },
      }));
      return result.available;
    } catch (error) {
      console.error(`Failed to check availability for ${provider}:`, error);
      setProviderAvailability((prev) => ({
        ...prev,
        [provider]: { available: false, checking: false },
      }));
      return false;
    }
  };

  const getProviderRequirements = (
    provider: EmailProvider
  ): { name: string; package: string } | null => {
    switch (provider) {
      case "sendgrid":
        return { name: "SendGrid", package: "@sendgrid/mail" };
      case "resend":
        return { name: "Resend", package: "resend" };
      case "aws-ses":
        return { name: "AWS SES", package: "@aws-sdk/client-ses" };
      default:
        return null;
    }
  };

  const checkCrunchyConeAuthentication = async () => {
    setIsCheckingAuth(true);
    try {
      const result = await checkCrunchyConeAuth();
      if (result.success) {
        setCrunchyConeAuthStatus({
          authenticated: result.authenticated,
          user: result.user,
          source: result.source,
        });
      } else {
        setCrunchyConeAuthStatus({ authenticated: false });
      }
    } catch (error) {
      console.error("Failed to check CrunchyCone auth:", error);
      setCrunchyConeAuthStatus({ authenticated: false });
    } finally {
      setIsCheckingAuth(false);
    }
  };

  // Load current settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const currentSettings = await getCurrentEmailSettings();
        setSettings(currentSettings);
        // If CrunchyCone is already selected, check auth status
        if (currentSettings.provider === "crunchycone") {
          setTimeout(checkCrunchyConeAuthentication, 100);
        }

        // Check provider availability for providers that need specific dependencies
        const providersToCheck = ["sendgrid", "resend", "aws-ses"];
        if (providersToCheck.includes(currentSettings.provider)) {
          setTimeout(() => checkProviderAvailability(currentSettings.provider), 100);
        }
      } catch (error) {
        console.error("Failed to load email settings:", error);
        setMessage({ type: "error", text: "Failed to load current settings" });
      } finally {
        setIsLoadingSettings(false);
      }
    }

    loadSettings();
  }, []);

  const handleProviderChange = async (provider: EmailProvider) => {
    setSettings({ ...settings, provider });

    // Check CrunchyCone auth when provider is selected
    if (provider === "crunchycone") {
      checkCrunchyConeAuthentication();
    }

    // Check provider availability for providers that need specific dependencies
    const providersToCheck = ["sendgrid", "resend", "aws-ses"];
    if (providersToCheck.includes(provider)) {
      await checkProviderAvailability(provider);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await updateEmailSettings(settings);
      if (result.success) {
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update email settings" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConfiguration = async (customTo?: string) => {
    setIsTesting(true);
    setMessage(null);

    try {
      const result = await testEmailConfiguration(settings, customTo);
      if (result.success) {
        setMessage({ type: "success", text: result.message });
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to test email configuration" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestButtonClick = () => {
    if (settings.provider === "smtp") {
      // Pre-fill with current user's email
      setTestEmailTo(session?.user?.email || "");
      setShowTestDialog(true);
    } else {
      handleTestConfiguration();
    }
  };

  const handleTestDialogSubmit = () => {
    if (testEmailTo.trim()) {
      setShowTestDialog(false);
      handleTestConfiguration(testEmailTo.trim());
    }
  };

  const renderProviderHelpDialog = () => {
    if (settings.provider === "console") return null;

    const getProviderInstructions = () => {
      switch (settings.provider) {
        case "sendgrid":
          return {
            title: "How to Get SendGrid API Key",
            steps: [
              {
                title: "Sign up or Log in",
                content:
                  "Visit https://sendgrid.com and sign up for a free account or log in to your existing account.",
              },
              {
                title: "Go to API Keys",
                content: "Navigate to Settings → API Keys in the left sidebar.",
              },
              { title: "Create API Key", content: "Click 'Create API Key' button." },
              {
                title: "Choose Permissions",
                content: "Select 'Restricted Access' and enable 'Mail Send' permissions.",
              },
              {
                title: "Name Your Key",
                content: "Give your API key a descriptive name (e.g., 'MyApp Email').",
              },
              {
                title: "Generate & Copy",
                content:
                  "Click 'Create & View' and copy the generated API key immediately (you won't see it again).",
              },
            ],
            link: "https://sendgrid.com",
          };
        case "resend":
          return {
            title: "How to Get Resend API Key",
            steps: [
              {
                title: "Sign up or Log in",
                content: "Visit https://resend.com and create an account or sign in.",
              },
              {
                title: "Go to API Keys",
                content: "Navigate to the API Keys section in your dashboard.",
              },
              { title: "Create API Key", content: "Click 'Create API Key' button." },
              {
                title: "Set Permissions",
                content: "Choose the appropriate permissions (usually 'Send emails').",
              },
              { title: "Name Your Key", content: "Give your API key a descriptive name." },
              { title: "Generate & Copy", content: "Click 'Add' and copy the generated API key." },
            ],
            link: "https://resend.com",
          };
        case "aws-ses":
          return {
            title: "How to Get AWS SES Credentials",
            steps: [
              {
                title: "Sign up for AWS",
                content: "Visit https://aws.amazon.com and create an account or sign in.",
              },
              {
                title: "Go to IAM Console",
                content: "Navigate to IAM (Identity and Access Management) service.",
              },
              { title: "Create User", content: "Create a new IAM user with programmatic access." },
              {
                title: "Attach SES Policy",
                content:
                  "Attach the 'AmazonSESFullAccess' policy or create a custom policy with SES permissions.",
              },
              {
                title: "Get Credentials",
                content: "Copy the Access Key ID and Secret Access Key.",
              },
              {
                title: "Choose Region",
                content: "Select your preferred AWS region (e.g., us-east-1, eu-west-1).",
              },
              {
                title: "Verify Domain/Email",
                content: "In SES console, verify your sending domain or email address.",
              },
            ],
            link: "https://aws.amazon.com",
          };
        case "smtp":
          const getSmtpInstructions = () => {
            switch (smtpProvider) {
              case "google":
                return {
                  title: "How to Configure Gmail SMTP",
                  steps: [
                    {
                      title: "Enable 2-Step Verification",
                      content:
                        "Go to your Google Account settings and enable 2-Step Verification if not already enabled.",
                    },
                    {
                      title: "Generate App Password",
                      content:
                        "Go to Security → 2-Step Verification → App passwords. Select 'Mail' and generate a new app password.",
                    },
                    {
                      title: "Use These Settings",
                      content:
                        "SMTP Server: smtp.gmail.com, Port: 587, Security: STARTTLS (not SSL/TLS)",
                    },
                    {
                      title: "Enter Credentials",
                      content:
                        "Username: your full Gmail address, Password: the generated app password (not your regular password)",
                    },
                  ],
                  link: "https://myaccount.google.com/security",
                };
              case "outlook":
                return {
                  title: "How to Configure Outlook SMTP",
                  steps: [
                    {
                      title: "Enable SMTP AUTH",
                      content:
                        "In your Microsoft 365 admin center, ensure SMTP AUTH is enabled for your account.",
                    },
                    {
                      title: "Use These Settings",
                      content:
                        "SMTP Server: smtp-mail.outlook.com, Port: 587, Security: STARTTLS (not SSL/TLS)",
                    },
                    {
                      title: "Authentication",
                      content: "Use your full Outlook/Hotmail email address and password.",
                    },
                    {
                      title: "App Password (if 2FA)",
                      content:
                        "If you have 2-factor authentication enabled, generate an app password in your Microsoft account security settings.",
                    },
                  ],
                  link: "https://account.microsoft.com/security",
                };
              case "yahoo":
                return {
                  title: "How to Configure Yahoo SMTP",
                  steps: [
                    {
                      title: "Enable Less Secure Apps",
                      content:
                        "Go to Yahoo Account Security and enable 'Allow apps that use less secure sign in'.",
                    },
                    {
                      title: "Generate App Password",
                      content:
                        "Create an app password specifically for your application in Account Security → App passwords.",
                    },
                    {
                      title: "Use These Settings",
                      content:
                        "SMTP Server: smtp.mail.yahoo.com, Port: 587 (STARTTLS) or 465 (SSL/TLS)",
                    },
                    {
                      title: "Enter Credentials",
                      content:
                        "Username: your full Yahoo email address, Password: the generated app password",
                    },
                  ],
                  link: "https://login.yahoo.com/account/security",
                };
              case "custom":
                return {
                  title: "How to Configure Custom SMTP",
                  steps: [
                    {
                      title: "Contact Your Provider",
                      content:
                        "Get SMTP server details from your email hosting provider or IT administrator.",
                    },
                    {
                      title: "Gather Required Info",
                      content:
                        "You'll need: SMTP server hostname, port number, security type (TLS/SSL), username, and password.",
                    },
                    {
                      title: "Common Ports",
                      content:
                        "Port 587 (STARTTLS - recommended), Port 465 (SSL/TLS), Port 25 (usually blocked by ISPs)",
                    },
                    {
                      title: "Test Connection",
                      content:
                        "Use the test configuration button to verify your settings work correctly.",
                    },
                  ],
                  link: null,
                };
              default:
                return {
                  title: "How to Configure SMTP",
                  steps: [
                    {
                      title: "Choose Provider",
                      content:
                        "Select your email provider from the dropdown above for specific instructions.",
                    },
                  ],
                  link: null,
                };
            }
          };
          return getSmtpInstructions();
        case "mailgun":
          return {
            title: "How to Get Mailgun API Key",
            steps: [
              {
                title: "Sign up or Log in",
                content: "Visit https://mailgun.com and create an account or sign in.",
              },
              {
                title: "Go to API Keys",
                content: "Navigate to Settings → API Keys in your dashboard.",
              },
              {
                title: "Copy Private Key",
                content: "Copy your Private API key (starts with 'key-').",
              },
              {
                title: "Get Domain",
                content: "Go to Sending → Domains and copy your domain name.",
              },
              { title: "Verify Domain", content: "Follow Mailgun's domain verification process." },
            ],
            link: "https://mailgun.com",
          };
        default:
          return null;
      }
    };

    const instructions = getProviderInstructions();
    if (!instructions) return null;

    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-1">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{instructions.title}</DialogTitle>
            <DialogDescription>
              Follow these steps to get your API credentials for {settings.provider}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {settings.provider === "smtp" && (
              <div className="space-y-3 p-4 bg-muted rounded-lg">
                <h4 className="font-semibold text-base">Select Your Email Provider</h4>
                <div className="grid gap-2">
                  <Label className="text-sm">
                    Choose your SMTP provider for specific instructions:
                  </Label>
                  <Select value={smtpProvider} onValueChange={setSmtpProvider}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select SMTP provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="google">Gmail (Google)</SelectItem>
                      <SelectItem value="outlook">Outlook/Hotmail (Microsoft)</SelectItem>
                      <SelectItem value="yahoo">Yahoo Mail</SelectItem>
                      <SelectItem value="custom">Custom SMTP Server</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {instructions.steps.map((step, index) => (
                <div key={index} className="space-y-2">
                  <h5 className="font-semibold">
                    {index + 1}. {step.title}
                  </h5>
                  <p>{step.content}</p>
                </div>
              ))}
            </div>
            {instructions.link && (
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-semibold">Get started:</p>
                <p>
                  Visit{" "}
                  <a
                    href={instructions.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {instructions.link}
                  </a>{" "}
                  to begin the setup process.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  const renderProviderSettings = () => {
    switch (settings.provider) {
      case "sendgrid":
        return (
          <div className="grid gap-2">
            <Label htmlFor="sendgridApiKey" className="text-sm">
              SendGrid API Key
            </Label>
            <Input
              id="sendgridApiKey"
              type="password"
              placeholder="Enter SendGrid API Key"
              value={settings.sendgridApiKey || ""}
              onChange={(e) => setSettings({ ...settings, sendgridApiKey: e.target.value })}
            />
          </div>
        );

      case "resend":
        return (
          <div className="grid gap-2">
            <Label htmlFor="resendApiKey" className="text-sm">
              Resend API Key
            </Label>
            <Input
              id="resendApiKey"
              type="password"
              placeholder="Enter Resend API Key"
              value={settings.resendApiKey || ""}
              onChange={(e) => setSettings({ ...settings, resendApiKey: e.target.value })}
            />
          </div>
        );

      case "aws-ses":
        return (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="awsAccessKeyId" className="text-sm">
                AWS Access Key ID
              </Label>
              <Input
                id="awsAccessKeyId"
                type="text"
                placeholder="Enter AWS Access Key ID"
                value={settings.awsAccessKeyId || ""}
                onChange={(e) => setSettings({ ...settings, awsAccessKeyId: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="awsSecretAccessKey" className="text-sm">
                AWS Secret Access Key
              </Label>
              <Input
                id="awsSecretAccessKey"
                type="password"
                placeholder="Enter AWS Secret Access Key"
                value={settings.awsSecretAccessKey || ""}
                onChange={(e) => setSettings({ ...settings, awsSecretAccessKey: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="awsRegion" className="text-sm">
                AWS Region
              </Label>
              <Input
                id="awsRegion"
                type="text"
                placeholder="e.g., us-east-1"
                value={settings.awsRegion || ""}
                onChange={(e) => setSettings({ ...settings, awsRegion: e.target.value })}
              />
            </div>
          </div>
        );

      case "smtp":
        return (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="smtpHost" className="text-sm">
                SMTP Host
              </Label>
              <Input
                id="smtpHost"
                type="text"
                placeholder="e.g., smtp.gmail.com"
                value={settings.smtpHost || ""}
                onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smtpPort" className="text-sm">
                SMTP Port
              </Label>
              <Input
                id="smtpPort"
                type="number"
                placeholder="e.g., 587"
                value={settings.smtpPort || ""}
                onChange={(e) => setSettings({ ...settings, smtpPort: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smtpUser" className="text-sm">
                SMTP Username
              </Label>
              <Input
                id="smtpUser"
                type="text"
                placeholder="Enter SMTP username"
                value={settings.smtpUser || ""}
                onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smtpPassword" className="text-sm">
                SMTP Password
              </Label>
              <Input
                id="smtpPassword"
                type="password"
                placeholder="Enter SMTP password"
                value={settings.smtpPassword || ""}
                onChange={(e) => setSettings({ ...settings, smtpPassword: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smtpSecure" className="text-sm">
                SMTP Secure Connection
              </Label>
              <Select
                value={settings.smtpSecure ? "true" : "false"}
                onValueChange={(value) =>
                  setSettings({ ...settings, smtpSecure: value === "true" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select security type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">STARTTLS (Port 587)</SelectItem>
                  <SelectItem value="true">SSL/TLS (Port 465)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose STARTTLS for port 587 or SSL/TLS for port 465. Most modern SMTP servers use
                STARTTLS.
              </p>
            </div>
          </div>
        );

      case "mailgun":
        return (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="mailgunApiKey" className="text-sm">
                Mailgun API Key
              </Label>
              <Input
                id="mailgunApiKey"
                type="password"
                placeholder="Enter Mailgun API Key"
                value={settings.mailgunApiKey || ""}
                onChange={(e) => setSettings({ ...settings, mailgunApiKey: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mailgunDomain" className="text-sm">
                Mailgun Domain
              </Label>
              <Input
                id="mailgunDomain"
                type="text"
                placeholder="e.g., mg.yourdomain.com"
                value={settings.mailgunDomain || ""}
                onChange={(e) => setSettings({ ...settings, mailgunDomain: e.target.value })}
              />
            </div>
          </div>
        );

      case "crunchycone":
        return (
          <div className="space-y-3">
            {/* Authentication Status */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Authentication Status</Label>
                {isCheckingAuth && <Loader2 className="h-4 w-4 animate-spin" />}
                {!isCheckingAuth && !crunchyConeAuthStatus?.authenticated && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={checkCrunchyConeAuthentication}
                  >
                    Check Status
                  </Button>
                )}
              </div>

              {crunchyConeAuthStatus !== null && (
                <Alert variant={crunchyConeAuthStatus.authenticated ? "default" : "destructive"}>
                  {crunchyConeAuthStatus.authenticated ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  <AlertDescription>
                    {crunchyConeAuthStatus.authenticated ? (
                      "Successfully authenticated with CrunchyCone"
                    ) : crunchyConeAuthStatus.source === "project_not_available" ? (
                      "This project is not available in CrunchyCone"
                    ) : (
                      <>
                        You need to be signed into your CrunchyCone account.
                        <span className="block text-xs mt-1">
                          Run:{" "}
                          <code className="bg-muted px-1 rounded">
                            npx crunchycone-cli auth login
                          </code>
                        </span>
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription>
                CrunchyCone email service provides reliable email delivery with built-in templates
                and analytics. Authentication is handled through the CLI.
              </AlertDescription>
            </Alert>
          </div>
        );

      case "console":
      default:
        return (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Console mode is for development only. Emails will be logged to the server console
              instead of being sent. Switch to a production provider for live environments.
            </AlertDescription>
          </Alert>
        );
    }
  };

  if (isLoadingSettings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Configuration
          </CardTitle>
          <CardDescription>Configure email service provider and settings</CardDescription>
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
          <Mail className="h-5 w-5" />
          Email Configuration
        </CardTitle>
        <CardDescription>Configure email service provider and settings</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Settings */}
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="provider" className="text-sm">
                Email Provider
              </Label>
              <Select value={settings.provider} onValueChange={handleProviderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select email provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="console">Console (Development)</SelectItem>
                  <SelectItem value="sendgrid">SendGrid</SelectItem>
                  <SelectItem value="resend">Resend</SelectItem>
                  <SelectItem value="aws-ses">Amazon SES</SelectItem>
                  <SelectItem value="smtp">SMTP</SelectItem>
                  <SelectItem value="mailgun">Mailgun</SelectItem>
                  <SelectItem value="crunchycone">CrunchyCone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Provider Availability Check */}
            {(settings.provider === "sendgrid" ||
              settings.provider === "resend" ||
              settings.provider === "aws-ses") && (
              <div className="space-y-2">
                {providerAvailability[settings.provider]?.checking && (
                  <Alert>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertDescription>
                      Checking {settings.provider} availability...
                    </AlertDescription>
                  </Alert>
                )}
                {providerAvailability[settings.provider] &&
                  !providerAvailability[settings.provider].checking &&
                  !providerAvailability[settings.provider].available && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>
                          {getProviderRequirements(settings.provider)?.name} is not available.
                        </strong>
                        <br />
                        The required dependency{" "}
                        <code className="bg-muted px-1 rounded">
                          {getProviderRequirements(settings.provider)?.package}
                        </code>{" "}
                        is not installed.
                        <br />
                        <span className="text-xs mt-1 block">
                          Run:{" "}
                          <code className="bg-muted px-1 rounded">
                            npm install {getProviderRequirements(settings.provider)?.package}
                          </code>
                        </span>
                      </AlertDescription>
                    </Alert>
                  )}
                {providerAvailability[settings.provider] &&
                  !providerAvailability[settings.provider].checking &&
                  providerAvailability[settings.provider].available && (
                    <Alert>
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>
                        {getProviderRequirements(settings.provider)?.name} is available and ready to
                        use.
                      </AlertDescription>
                    </Alert>
                  )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="fromAddress" className="text-sm">
                From Email Address
              </Label>
              <Input
                id="fromAddress"
                type="email"
                placeholder="noreply@yourdomain.com"
                value={settings.fromAddress}
                onChange={(e) => setSettings({ ...settings, fromAddress: e.target.value })}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fromDisplayName" className="text-sm">
                From Email Display Name (Optional)
              </Label>
              <Input
                id="fromDisplayName"
                type="text"
                placeholder="Your App Name"
                value={settings.fromDisplayName || ""}
                onChange={(e) => setSettings({ ...settings, fromDisplayName: e.target.value })}
              />
            </div>
          </div>

          {/* Provider-specific Settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">Provider Configuration</h3>
              {renderProviderHelpDialog()}
            </div>
            {renderProviderSettings()}
          </div>

          {message && (
            <Alert
              variant={message.type === "error" ? "destructive" : "default"}
              className={
                message.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                  : ""
              }
            >
              {message.type === "success" ? (
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              <AlertDescription
                className={message.type === "success" ? "text-green-800 dark:text-green-200" : ""}
              >
                {message.text}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestButtonClick}
              disabled={
                isTesting ||
                isLoading ||
                (settings.provider === "crunchycone" && !crunchyConeAuthStatus?.authenticated) ||
                (providerAvailability[settings.provider] &&
                  !providerAvailability[settings.provider].available)
              }
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <TestTube2 className="mr-2 h-4 w-4" />
                  Test Configuration
                </>
              )}
            </Button>

            <Button type="submit" disabled={isLoading || isTesting}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Email Settings"
              )}
            </Button>
          </div>
        </form>
      </CardContent>

      {/* SMTP Test Email Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test SMTP Configuration</DialogTitle>
            <DialogDescription>
              Enter the email address where you want to send the test email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="testEmailTo" className="text-sm">
                Send test email to:
              </Label>
              <Input
                id="testEmailTo"
                type="email"
                placeholder="Enter email address"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleTestDialogSubmit();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowTestDialog(false)}
                disabled={isTesting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleTestDialogSubmit}
                disabled={isTesting || !testEmailTo.trim()}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <TestTube2 className="mr-2 h-4 w-4" />
                    Send Test Email
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
