"use client";

import { useState, useEffect } from "react";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  Database,
  TestTube,
  Save,
  HelpCircle,
} from "lucide-react";
import {
  getStorageSettings,
  updateStorageSettings,
  testStorageConnection,
} from "@/app/actions/storage-settings";

interface StorageSettings {
  provider: string;
  // LocalStorage settings
  localStoragePath?: string;
  localStorageBaseUrl?: string;

  // AWS S3 settings
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  awsBucket?: string;
  awsCloudFrontDomain?: string;

  // Digital Ocean Spaces settings
  doAccessKeyId?: string;
  doSecretAccessKey?: string;
  doRegion?: string;
  doBucket?: string;
  doCdnEndpoint?: string;

  // Azure Storage settings
  azureAccountName?: string;
  azureAccountKey?: string;
  azureSasToken?: string;
  azureConnectionString?: string;
  azureContainerName?: string;
  azureCdnUrl?: string;

  // Google Cloud Storage settings
  gcpProjectId?: string;
  gcpKeyFile?: string;
  gcsBucket?: string;
  gcpCdnUrl?: string;

  // CrunchyCone uses CLI authentication and crunchycone.toml project config
  // No additional settings required
}

interface CrunchyConeUser {
  email?: string;
  name?: string;
}

interface CrunchyConeAuthDetails {
  success: boolean;
  message?: string;
  user?: CrunchyConeUser;
}

interface CrunchyConeProjectDetails {
  project_id: string;
  configFile?: string;
}

export function StorageConfigForm() {
  const [settings, setSettings] = useState<StorageSettings>({
    provider: "localstorage",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    details?: string;
    error?: string;
  } | null>(null);
  const [crunchyConeStatus, setCrunchyConeStatus] = useState<{
    authenticated: boolean;
    hasProject: boolean;
    authDetails?: CrunchyConeAuthDetails;
    projectDetails?: CrunchyConeProjectDetails;
    error?: string;
  } | null>(null);
  const [isCheckingCrunchyCone, setIsCheckingCrunchyCone] = useState(false);
  const [isPlatformMode, setIsPlatformMode] = useState(false);

  // Load current settings and check platform mode
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await getStorageSettings();
        if (result.success && result.settings) {
          setSettings(result.settings);
          // Use platform mode info from settings instead of separate API call
          setIsPlatformMode(result.isPlatformMode || false);
        } else {
          setMessage({ type: "error", text: result.error || "Failed to load storage settings" });
        }
      } catch {
        setMessage({ type: "error", text: "Failed to load storage settings" });
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Check CrunchyCone status when provider changes to crunchycone
  useEffect(() => {
    if (settings.provider === "crunchycone") {
      checkCrunchyConeStatus();
    } else {
      setCrunchyConeStatus(null);
    }
  }, [settings.provider]);

  const checkCrunchyConeStatus = async () => {
    setIsCheckingCrunchyCone(true);
    try {
      const response = await fetch("/api/admin/crunchycone-storage-check", {
        method: "POST",
      });
      const result = await response.json();
      console.log("Frontend DEBUG: Response status:", response.status);
      console.log("Frontend DEBUG: Response result:", result);

      if (response.ok) {
        setCrunchyConeStatus(result);
        console.log("Frontend DEBUG: Set crunchyConeStatus to:", result);
      } else {
        console.log("Frontend DEBUG: Response not ok, setting error state");
        setCrunchyConeStatus({
          authenticated: false,
          hasProject: false,
          error: result.error || "Failed to check CrunchyCone status",
        });
      }
    } catch {
      setCrunchyConeStatus({
        authenticated: false,
        hasProject: false,
        error: "Failed to check CrunchyCone status",
      });
    } finally {
      setIsCheckingCrunchyCone(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const result = await updateStorageSettings(settings);
      if (result.success) {
        setMessage({ type: "success", text: "Storage settings updated successfully" });
      } else {
        setMessage({ type: "error", text: result.error || "Failed to update storage settings" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update storage settings" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testStorageConnection(settings);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: "Connection test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Get instructions for setting up storage providers
  const getProviderInstructions = () => {
    switch (settings.provider) {
      case "aws":
        return {
          title: "How to Set Up AWS S3 Storage",
          steps: [
            {
              title: "Create AWS Account",
              content: "Sign up for AWS if you don't have an account.",
            },
            {
              title: "Create IAM User",
              content: "Go to AWS IAM console and create a new user for programmatic access.",
            },
            {
              title: "Attach S3 Policy",
              content:
                "Attach the 'AmazonS3FullAccess' policy or create a custom policy with S3 permissions.",
            },
            {
              title: "Generate Access Keys",
              content:
                "Create access keys for the IAM user. Download and securely store the Access Key ID and Secret Access Key.",
            },
            {
              title: "Create S3 Bucket",
              content: "Go to S3 console and create a new bucket in your preferred region.",
            },
            {
              title: "Configure Bucket",
              content: "Set appropriate permissions and enable/disable public access as needed.",
            },
            {
              title: "Optional: CloudFront",
              content: "For CDN, create a CloudFront distribution pointing to your S3 bucket.",
            },
          ],
          link: "https://aws.amazon.com",
        };
      case "digitalocean":
        return {
          title: "How to Set Up DigitalOcean Spaces Storage",
          steps: [
            {
              title: "Create DigitalOcean Account",
              content: "Sign up for DigitalOcean if you don't have an account.",
            },
            {
              title: "Create Spaces",
              content: "Go to Spaces in the DigitalOcean control panel and create a new Space.",
            },
            {
              title: "Choose Region",
              content: "Select a region close to your users for better performance.",
            },
            {
              title: "Generate API Keys",
              content: "Go to API → Spaces Keys and generate new credentials.",
            },
            { title: "Get Access Keys", content: "Copy the Access Key ID and Secret Access Key." },
            {
              title: "Note Space Details",
              content: "Record your Space name and region for configuration.",
            },
            {
              title: "Optional: CDN",
              content: "Enable CDN for your Space to get a CDN endpoint URL.",
            },
          ],
          link: "https://cloud.digitalocean.com/spaces",
        };
      case "azure":
        return {
          title: "How to Set Up Azure Blob Storage",
          steps: [
            {
              title: "Create Azure Account",
              content: "Sign up for Azure if you don't have an account.",
            },
            {
              title: "Create Storage Account",
              content: "In Azure Portal, create a new Storage Account.",
            },
            {
              title: "Choose Settings",
              content: "Select performance tier (Standard/Premium) and replication options.",
            },
            {
              title: "Create Container",
              content: "In your storage account, create a new Blob container.",
            },
            {
              title: "Get Access Keys",
              content:
                "Go to Access Keys section and copy one of the connection strings or account keys.",
            },
            {
              title: "Optional: SAS Token",
              content:
                "For more granular access, generate a SAS token instead of using account keys.",
            },
            {
              title: "Optional: CDN",
              content: "Enable Azure CDN for your storage account to get a CDN URL.",
            },
          ],
          link: "https://portal.azure.com",
        };
      case "gcp":
        return {
          title: "How to Set Up Google Cloud Storage",
          steps: [
            {
              title: "Create GCP Account",
              content: "Sign up for Google Cloud if you don't have an account.",
            },
            {
              title: "Create Project",
              content: "Create a new project in Google Cloud Console or select an existing one.",
            },
            {
              title: "Enable Cloud Storage API",
              content:
                "Go to APIs & Services and enable the Google Cloud Storage API for your project.",
            },
            {
              title: "Create Service Account",
              content: "Go to IAM & Admin → Service Accounts and create a new service account.",
            },
            {
              title: "Generate Key File",
              content:
                "Create and download a JSON key file for the service account. Store this securely.",
            },
            {
              title: "Set Permissions",
              content: "Grant the service account 'Storage Admin' or custom storage permissions.",
            },
            {
              title: "Create Storage Bucket",
              content: "Go to Cloud Storage and create a new bucket in your preferred region.",
            },
            {
              title: "Configure Access",
              content: "Set appropriate bucket permissions and access controls as needed.",
            },
            {
              title: "Optional: CDN",
              content: "Set up Cloud CDN or use a custom CDN URL for faster content delivery.",
            },
          ],
          link: "https://console.cloud.google.com",
        };
      default:
        return null;
    }
  };

  // Render help dialog for storage providers
  const renderProviderHelp = () => {
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
              Follow these steps to get your storage credentials for {settings.provider}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
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
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Security Note:</strong> Store your credentials securely and never share them
                publicly. Use environment variables or secure credential management systems in
                production.
              </AlertDescription>
            </Alert>
          </div>
        </DialogContent>
      </Dialog>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Loading storage settings...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Storage Configuration
        </CardTitle>
        <CardDescription>
          Configure your file storage provider and connection settings
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Message Display */}
          {message && (
            <Alert variant={message.type === "error" ? "destructive" : "default"}>
              {message.type === "error" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          {/* Test Result Display */}
          {testResult && (
            <Alert variant={testResult.success ? "default" : "destructive"}>
              {testResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              <AlertDescription>
                <div className="space-y-1">
                  <p>{testResult.success ? "Connection successful!" : testResult.error}</p>
                  {testResult.details && <p className="text-sm opacity-80">{testResult.details}</p>}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Storage Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="provider">Storage Provider</Label>
            <Select
              value={settings.provider}
              onValueChange={(value) => setSettings((prev) => ({ ...prev, provider: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select storage provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="localstorage">Local Storage</SelectItem>
                <SelectItem value="aws">AWS S3</SelectItem>
                <SelectItem value="digitalocean">DigitalOcean Spaces</SelectItem>
                <SelectItem value="azure">Azure Blob Storage</SelectItem>
                <SelectItem value="gcp">Google Cloud Storage</SelectItem>
                <SelectItem value="crunchycone">CrunchyCone Storage</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Provider-Specific Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">Provider Configuration</h3>
              {renderProviderHelp()}
            </div>
          </div>

          <Tabs value={settings.provider} className="w-full">
            {/* LocalStorage Configuration */}
            <TabsContent value="localstorage" className="space-y-4">
              {/* Platform Mode Warning */}
              {isPlatformMode && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-medium">⚠️ LocalStorage Not Available in Platform Mode</p>
                      <p className="text-sm">
                        LocalStorage requires file system access which is not available when running
                        in CrunchyCone platform mode. Please select a cloud storage provider
                        instead.
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="localStoragePath">Storage Path</Label>
                  <Input
                    id="localStoragePath"
                    type="text"
                    placeholder="./uploads"
                    value={settings.localStoragePath || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, localStoragePath: e.target.value }))
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Local directory path for file storage
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="localStorageBaseUrl">Base URL</Label>
                  <Input
                    id="localStorageBaseUrl"
                    type="text"
                    placeholder="/api/storage/files"
                    value={settings.localStorageBaseUrl || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, localStorageBaseUrl: e.target.value }))
                    }
                  />
                  <p className="text-sm text-muted-foreground">Base URL for file access</p>
                </div>
              </div>
            </TabsContent>

            {/* AWS S3 Configuration */}
            <TabsContent value="aws" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="awsAccessKeyId">Access Key ID</Label>
                  <Input
                    id="awsAccessKeyId"
                    type="text"
                    placeholder="AKIA..."
                    value={settings.awsAccessKeyId || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, awsAccessKeyId: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="awsSecretAccessKey">Secret Access Key</Label>
                  <Input
                    id="awsSecretAccessKey"
                    type="password"
                    placeholder="Your AWS secret key"
                    value={settings.awsSecretAccessKey || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, awsSecretAccessKey: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="awsRegion">Region</Label>
                  <Input
                    id="awsRegion"
                    type="text"
                    placeholder="us-east-1"
                    value={settings.awsRegion || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, awsRegion: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="awsBucket">Bucket Name</Label>
                  <Input
                    id="awsBucket"
                    type="text"
                    placeholder="my-s3-bucket"
                    value={settings.awsBucket || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, awsBucket: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="awsCloudFrontDomain">CloudFront Domain (Optional)</Label>
                  <Input
                    id="awsCloudFrontDomain"
                    type="text"
                    placeholder="d123456789.cloudfront.net"
                    value={settings.awsCloudFrontDomain || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, awsCloudFrontDomain: e.target.value }))
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* DigitalOcean Spaces Configuration */}
            <TabsContent value="digitalocean" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="doAccessKeyId">Access Key ID</Label>
                  <Input
                    id="doAccessKeyId"
                    type="text"
                    placeholder="Your DO access key"
                    value={settings.doAccessKeyId || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, doAccessKeyId: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doSecretAccessKey">Secret Access Key</Label>
                  <Input
                    id="doSecretAccessKey"
                    type="password"
                    placeholder="Your DO secret key"
                    value={settings.doSecretAccessKey || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, doSecretAccessKey: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doRegion">Region</Label>
                  <Input
                    id="doRegion"
                    type="text"
                    placeholder="nyc3"
                    value={settings.doRegion || ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, doRegion: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doBucket">Space Name</Label>
                  <Input
                    id="doBucket"
                    type="text"
                    placeholder="my-space"
                    value={settings.doBucket || ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, doBucket: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="doCdnEndpoint">CDN Endpoint (Optional)</Label>
                  <Input
                    id="doCdnEndpoint"
                    type="text"
                    placeholder="my-space.nyc3.cdn.digitaloceanspaces.com"
                    value={settings.doCdnEndpoint || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, doCdnEndpoint: e.target.value }))
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* Azure Storage Configuration */}
            <TabsContent value="azure" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="azureAccountName">Account Name</Label>
                  <Input
                    id="azureAccountName"
                    type="text"
                    placeholder="mystorageaccount"
                    value={settings.azureAccountName || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureAccountName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureAccountKey">Account Key</Label>
                  <Input
                    id="azureAccountKey"
                    type="password"
                    placeholder="Your Azure account key"
                    value={settings.azureAccountKey || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureAccountKey: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureContainerName">Container Name</Label>
                  <Input
                    id="azureContainerName"
                    type="text"
                    placeholder="my-container"
                    value={settings.azureContainerName || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureContainerName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="azureSasToken">SAS Token (Optional)</Label>
                  <Input
                    id="azureSasToken"
                    type="password"
                    placeholder="SAS token"
                    value={settings.azureSasToken || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureSasToken: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="azureConnectionString">
                    Connection String (Alternative to Account Key)
                  </Label>
                  <Input
                    id="azureConnectionString"
                    type="password"
                    placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                    value={settings.azureConnectionString || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureConnectionString: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="azureCdnUrl">CDN URL (Optional)</Label>
                  <Input
                    id="azureCdnUrl"
                    type="text"
                    placeholder="https://mycdn.azureedge.net"
                    value={settings.azureCdnUrl || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, azureCdnUrl: e.target.value }))
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* Google Cloud Storage Configuration */}
            <TabsContent value="gcp" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gcpProjectId">Project ID</Label>
                  <Input
                    id="gcpProjectId"
                    type="text"
                    placeholder="my-gcp-project"
                    value={settings.gcpProjectId || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, gcpProjectId: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gcpKeyFile">Service Account Key File Path</Label>
                  <Input
                    id="gcpKeyFile"
                    type="text"
                    placeholder="/path/to/service-account.json"
                    value={settings.gcpKeyFile || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, gcpKeyFile: e.target.value }))
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Optional if using other GCP authentication methods
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gcsBucket">Bucket Name</Label>
                  <Input
                    id="gcsBucket"
                    type="text"
                    placeholder="my-gcs-bucket"
                    value={settings.gcsBucket || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, gcsBucket: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gcpCdnUrl">CDN URL (Optional)</Label>
                  <Input
                    id="gcpCdnUrl"
                    type="text"
                    placeholder="https://cdn.example.com"
                    value={settings.gcpCdnUrl || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, gcpCdnUrl: e.target.value }))
                    }
                  />
                </div>
              </div>
            </TabsContent>

            {/* CrunchyCone Configuration */}
            <TabsContent value="crunchycone" className="space-y-4">
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  CrunchyCone Storage uses your CLI authentication and project configuration. No
                  additional settings are required.
                </p>

                {/* Authentication Status */}
                {isCheckingCrunchyCone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking CrunchyCone status...
                  </div>
                )}

                {crunchyConeStatus && (
                  <div className="space-y-3">
                    {/* Authentication Status */}
                    <Alert variant={crunchyConeStatus.authenticated ? "default" : "destructive"}>
                      {crunchyConeStatus.authenticated ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      <AlertDescription>
                        <div className="space-y-2">
                          <p className="font-medium">
                            {crunchyConeStatus.authenticated
                              ? "✅ Authenticated"
                              : "❌ Not Authenticated"}
                          </p>
                          {crunchyConeStatus.authDetails?.user && (
                            <p className="text-sm">
                              Logged in as:{" "}
                              {crunchyConeStatus.authDetails.user.email ||
                                crunchyConeStatus.authDetails.user.name ||
                                "Unknown user"}
                            </p>
                          )}
                          {!crunchyConeStatus.authenticated && !isPlatformMode && (
                            <div className="text-sm space-y-1">
                              <p>
                                You need to sign in to CrunchyCone to use this storage provider.
                              </p>
                              <div className="bg-muted p-2 rounded font-mono text-xs">
                                npx crunchycone-cli auth login
                              </div>
                              <p className="text-muted-foreground">
                                Run this command in your terminal to sign in.
                              </p>
                            </div>
                          )}
                          {!crunchyConeStatus.authenticated && isPlatformMode && (
                            <div className="text-sm space-y-1">
                              <p>
                                CrunchyCone authentication is handled automatically in platform
                                mode.
                              </p>
                              <p className="text-muted-foreground">
                                Make sure CRUNCHYCONE_API_KEY and CRUNCHYCONE_PROJECT_ID environment
                                variables are properly configured.
                              </p>
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>

                    {/* Project Status */}
                    <Alert variant={crunchyConeStatus.hasProject ? "default" : "destructive"}>
                      {crunchyConeStatus.hasProject ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      <AlertDescription>
                        <div className="space-y-2">
                          <p className="font-medium">
                            {crunchyConeStatus.hasProject
                              ? "✅ Project Configured"
                              : "❌ This project is not available in CrunchyCone"}
                          </p>
                          {crunchyConeStatus.hasProject && crunchyConeStatus.projectDetails ? (
                            <div className="text-sm space-y-1">
                              <p>
                                Project ID:{" "}
                                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                                  {crunchyConeStatus.projectDetails.project_id}
                                </code>
                              </p>
                              <p className="text-muted-foreground text-xs">
                                Configuration from: {crunchyConeStatus.projectDetails.configFile}
                              </p>
                            </div>
                          ) : !isPlatformMode ? (
                            <div className="text-sm space-y-1">
                              <p>
                                You need to link a CrunchyCone project to use this storage provider.
                              </p>
                              <div className="bg-muted p-2 rounded font-mono text-xs">
                                npx crunchycone-cli project link
                              </div>
                              <p className="text-muted-foreground">
                                Run this command from your project folder to link a project.
                              </p>
                            </div>
                          ) : (
                            <div className="text-sm space-y-1">
                              <p>
                                Project configuration is handled automatically in platform mode.
                              </p>
                              <p className="text-muted-foreground">
                                Make sure CRUNCHYCONE_PROJECT_ID environment variable is properly
                                configured.
                              </p>
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>

                    {/* Overall Status */}
                    {crunchyConeStatus.authenticated && crunchyConeStatus.hasProject && (
                      <Alert variant="default">
                        <CheckCircle className="h-4 w-4" />
                        <AlertDescription>
                          <p className="font-medium text-green-700">
                            🎉 CrunchyCone Storage is ready to use!
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Your files will be stored securely in CrunchyCone Cloud Storage.
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            {/* Show test connection button for all providers except localstorage and crunchycone */}
            {settings.provider !== "localstorage" && settings.provider !== "crunchycone" && (
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="sm:w-auto"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <TestTube className="mr-2 h-4 w-4" />
                    Test Connection
                  </>
                )}
              </Button>
            )}

            <Button type="submit" disabled={isSaving} className="sm:w-auto">
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
