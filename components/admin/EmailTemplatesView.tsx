"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, AlertTriangle, Loader2, Mail, Eye, FileText, Code } from "lucide-react";
import {
  getAvailableTemplates,
  renderTemplatePreview,
  type EmailTemplate,
  type TemplatePreview,
} from "@/app/actions/email-templates";

function getLanguageDisplayName(code: string): string {
  try {
    // Use browser's built-in Intl.DisplayNames API for language names
    const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
    const displayName = displayNames.of(code);
    return displayName || code.toUpperCase();
  } catch {
    // Fallback to uppercase code if Intl.DisplayNames is not available or fails
    return code.toUpperCase();
  }
}

export function EmailTemplatesView() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en");
  const [availableLanguages, setAvailableLanguages] = useState<string[]>(["en"]);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load templates on mount
  useEffect(() => {
    async function loadTemplates() {
      try {
        const result = await getAvailableTemplates();
        if (result.success && result.templates) {
          setTemplates(result.templates);

          // Extract unique languages
          const languages = Array.from(new Set(result.templates.map((t) => t.language))).sort();
          setAvailableLanguages(languages);

          // Set default language to first available
          if (languages.length > 0) {
            setSelectedLanguage(languages[0]);
          }

          // Set default template to first one in the selected language
          const firstTemplate = result.templates.find((t) => t.language === (languages[0] || "en"));
          if (firstTemplate) {
            setSelectedTemplate(firstTemplate.id);
          }
        } else {
          setMessage({
            type: "error",
            text: result.message || "Failed to load templates",
          });
        }
      } catch {
        setMessage({
          type: "error",
          text: "Failed to load email templates",
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadTemplates();
  }, []);

  // Update available templates when language changes
  useEffect(() => {
    const templatesForLanguage = templates.filter((t) => t.language === selectedLanguage);
    if (templatesForLanguage.length > 0) {
      const currentTemplate = templatesForLanguage.find((t) => t.id === selectedTemplate);
      if (!currentTemplate) {
        setSelectedTemplate(templatesForLanguage[0].id);
      }
    }
  }, [selectedLanguage, templates, selectedTemplate]);

  // Get filtered templates for current language
  const filteredTemplates = templates.filter((t) => t.language === selectedLanguage);

  // Define handlePreviewTemplate before using it in useEffect
  const handlePreviewTemplate = useCallback(async () => {
    if (!selectedTemplate) return;

    setIsLoadingPreview(true);
    setMessage(null);

    try {
      const result = await renderTemplatePreview(selectedTemplate);
      if (result.success && result.preview) {
        setPreview(result.preview);
        setMessage(null); // Clear any previous error messages
      } else {
        setMessage({
          type: "error",
          text: result.message || "Failed to render template",
        });
        setPreview(null);
      }
    } catch {
      setMessage({
        type: "error",
        text: "Failed to render template preview",
      });
      setPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [selectedTemplate]);

  // Auto-preview when template changes
  useEffect(() => {
    if (selectedTemplate) {
      handlePreviewTemplate();
    }
  }, [selectedTemplate, handlePreviewTemplate]);

  const selectedTemplateInfo = filteredTemplates.find((t) => t.id === selectedTemplate);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Templates
          </CardTitle>
          <CardDescription>Loading email templates...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading templates...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-12">
      {/* Template Selection */}
      <div className="md:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Templates
            </CardTitle>
            <CardDescription>Select a template to preview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages.map((language) => (
                    <SelectItem key={language} value={language}>
                      <div className="flex items-center gap-2">
                        <span>{getLanguageDisplayName(language)}</span>
                        <Badge variant="outline" className="text-xs">
                          {templates.filter((t) => t.language === language).length} templates
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Template</label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedTemplateInfo && (
              <div className="space-y-3">
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Template Info</h4>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium">Name:</span> {selectedTemplateInfo.name}
                    </div>
                    <div>
                      <span className="font-medium">Language:</span>{" "}
                      {getLanguageDisplayName(selectedTemplateInfo.language)}
                    </div>
                    {selectedTemplateInfo.description && (
                      <div>
                        <span className="font-medium">Description:</span>{" "}
                        {selectedTemplateInfo.description}
                      </div>
                    )}
                    <div>
                      <span className="font-medium">ID:</span> {selectedTemplateInfo.id}
                    </div>
                  </div>
                </div>

                {selectedTemplateInfo.data && Object.keys(selectedTemplateInfo.data).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">Sample Data</h4>
                    <div className="bg-muted rounded-md p-3">
                      <pre className="text-xs text-muted-foreground overflow-x-auto">
                        {JSON.stringify(selectedTemplateInfo.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={handlePreviewTemplate}
              disabled={!selectedTemplate || isLoadingPreview}
              className="w-full"
            >
              {isLoadingPreview ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rendering...
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Preview Template
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Template Preview */}
      <div className="md:col-span-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Template Preview
            </CardTitle>
            <CardDescription>
              {selectedTemplateInfo
                ? `Previewing: ${selectedTemplateInfo.name}`
                : "Select a template to see preview"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {message && (
              <Alert
                variant={message.type === "error" ? "destructive" : "default"}
                className="mb-4"
              >
                {message.type === "success" ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}

            {isLoadingPreview && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="ml-2">Rendering template...</span>
              </div>
            )}

            {!isLoadingPreview && preview && (
              <Tabs defaultValue="html" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="html" className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    HTML Preview
                  </TabsTrigger>
                  <TabsTrigger value="text" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Text Version
                  </TabsTrigger>
                  <TabsTrigger value="source" className="flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    HTML Source
                  </TabsTrigger>
                </TabsList>

                <div className="mt-4">
                  <div className="mb-4 p-3 bg-muted rounded-md">
                    <div className="text-sm font-medium text-muted-foreground">Subject:</div>
                    <div className="font-medium">{preview.subject}</div>
                  </div>

                  <TabsContent value="html" className="mt-0">
                    <div className="border rounded-md">
                      <iframe
                        srcDoc={preview.html}
                        className="w-full h-96 border-0"
                        title="Email Template Preview"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="text" className="mt-0">
                    <div className="border rounded-md p-4 bg-muted/30">
                      <pre className="text-sm whitespace-pre-wrap font-mono">{preview.text}</pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="source" className="mt-0">
                    <div className="border rounded-md p-4 bg-muted/30">
                      <pre className="text-xs overflow-x-auto">
                        <code>{preview.html}</code>
                      </pre>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            )}

            {!isLoadingPreview && !preview && selectedTemplate && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mb-4" />
                <p className="text-center">
                  Click &quot;Preview Template&quot; to render and view the selected template
                </p>
              </div>
            )}

            {!selectedTemplate && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Mail className="h-12 w-12 mb-4" />
                <p className="text-center">Select a template from the dropdown to preview it</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
