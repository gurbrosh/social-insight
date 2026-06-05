"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Upload,
  Search,
  Eye,
  Trash2,
  Download,
  Image,
  FileText,
  File,
  Loader2,
  AlertTriangle,
  CheckCircle,
  RefreshCcw,
  Filter,
  Lock,
  Unlock,
  MoreHorizontal,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: string;
  contentType: string;
  visibility: "public" | "private";
  url?: string;
}

interface UploadResult {
  success: boolean;
  fileName: string;
  filePath: string;
  size: number;
  contentType: string;
  visibility: "public" | "private";
  url?: string;
}

export function MediaUploader() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadVisibility, setUploadVisibility] = useState<"public" | "private">("private");
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [flashingFile, setFlashingFile] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize] = useState(20);

  // Load files from API
  const loadFiles = useCallback(
    async (page = 1, resetFiles = false) => {
      try {
        const offset = (page - 1) * pageSize;
        const params = new URLSearchParams({
          limit: pageSize.toString(),
          offset: offset.toString(),
        });

        if (searchTerm) {
          params.append("search", searchTerm);
        }

        const response = await fetch(`/api/admin/media/files?${params}`);
        const data = await response.json();

        if (response.ok) {
          const newFiles = data.files || [];
          if (resetFiles) {
            setFiles(newFiles);
          } else {
            setFiles((prevFiles) => prevFiles.concat(newFiles));
          }
          setTotalCount(data.totalCount || 0);
          setHasMore(data.hasMore || false);
          setMessage(null);
        } else {
          setMessage({ type: "error", text: data.error || "Failed to load files" });
        }
      } catch (error) {
        setMessage({ type: "error", text: "Failed to load files" });
        console.error("Error loading files:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [pageSize, searchTerm]
  );

  // Load files on mount and when search changes
  useEffect(() => {
    setCurrentPage(1);
    setFiles([]);
    loadFiles(1, true);
  }, [searchTerm, loadFiles]);

  // Load files on page change
  useEffect(() => {
    if (currentPage > 1) {
      loadFiles(currentPage, false);
    }
  }, [currentPage, loadFiles]);

  // Since search is now handled server-side, filtered files are just the files
  useEffect(() => {
    setFilteredFiles(files);
  }, [files]);

  // Handle file upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("visibility", uploadVisibility);
    if (uploadFolder) {
      formData.append("folder", uploadFolder);
    }

    try {
      const response = await fetch("/api/admin/media/upload", {
        method: "POST",
        body: formData,
      });

      const result: UploadResult = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: `File uploaded successfully: ${result.fileName}` });
        setSelectedFile(null);
        setUploadFolder("");
        setUploadDialogOpen(false);
        setCurrentPage(1);
        setFiles([]);
        await loadFiles(1, true); // Refresh file list from beginning

        // Flash the newly uploaded file
        setFlashingFile(result.filePath);
        setTimeout(() => setFlashingFile(null), 2000);
      } else {
        setMessage({
          type: "error",
          text: (result as { error?: string }).error || "Upload failed",
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Upload failed" });
      console.error("Upload error:", error);
    } finally {
      setIsUploading(false);
    }
  };

  // Toggle file visibility
  const toggleVisibility = async (filePath: string, currentVisibility: "public" | "private") => {
    const newVisibility = currentVisibility === "public" ? "private" : "public";

    try {
      const response = await fetch(`/api/admin/media/files/${encodeURIComponent(filePath)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ visibility: newVisibility }),
      });

      if (response.ok) {
        setMessage({ type: "success", text: `File visibility changed to ${newVisibility}` });
        setCurrentPage(1);
        setFiles([]);
        await loadFiles(1, true); // Refresh file list
      } else {
        const data = await response.json();
        setMessage({ type: "error", text: data.error || "Failed to update visibility" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to update visibility" });
      console.error("Visibility update error:", error);
    }
  };

  // Delete file
  const deleteFile = async (filePath: string) => {
    if (!confirm("Are you sure you want to delete this file? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/media/files/${encodeURIComponent(filePath)}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setMessage({ type: "success", text: "File deleted successfully" });

        // Remove the deleted file from the current list instead of clearing all files
        setFiles((prevFiles) => prevFiles.filter((f) => f.path !== filePath));
        setFilteredFiles((prevFiles) => prevFiles.filter((f) => f.path !== filePath));

        // Optionally reload to get fresh data (but don't clear files first)
        // await loadFiles(currentPage, false);
      } else {
        const data = await response.json();
        setMessage({ type: "error", text: data.error || "Failed to delete file" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to delete file" });
      console.error("Delete error:", error);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Get file icon
  const getFileIcon = (contentType: string) => {
    if (contentType.startsWith("image/")) {
      return <Image className="h-4 w-4" aria-label="Image file" />;
    } else if (
      contentType.includes("pdf") ||
      contentType.includes("document") ||
      contentType.includes("text")
    ) {
      return <FileText className="h-4 w-4" />;
    } else {
      return <File className="h-4 w-4" />;
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
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

        {/* Header with Search and Actions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="flex items-center gap-2">
              {searchTerm && (
                <Button variant="outline" size="sm" onClick={() => setSearchTerm("")}>
                  <Filter className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => loadFiles(1, true)}
                disabled={isLoading}
              >
                <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>

              <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Upload className="mr-2 h-4 w-4" />
                    Add File
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      Upload New File
                    </DialogTitle>
                    <DialogDescription>Add a new file to your media library</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="file">Select File</Label>
                      <Input
                        id="file"
                        type="file"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        accept="*/*"
                      />
                      <p className="text-sm text-muted-foreground">Maximum file size: 50MB</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="folder">Folder (optional)</Label>
                        <Input
                          id="folder"
                          placeholder="e.g., images, documents"
                          value={uploadFolder}
                          onChange={(e) => setUploadFolder(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="visibility">Visibility</Label>
                        <Select
                          value={uploadVisibility}
                          onValueChange={(value: "public" | "private") =>
                            setUploadVisibility(value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="private">Private</SelectItem>
                            <SelectItem value="public">Public</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleUpload} disabled={!selectedFile || isUploading}>
                        {isUploading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload File
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {totalCount > 0
                ? `${filteredFiles.length} of ${totalCount} files`
                : `${filteredFiles.length} files`}
            </div>

            {/* Pagination Controls - Only show when needed */}
            {totalCount > pageSize && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {Math.ceil(totalCount / pageSize)}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                  disabled={!hasMore || isLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Files Table */}
        <div className="border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading files...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Upload className="h-6 w-6 mr-2" />
              {files.length === 0 ? "No files uploaded yet" : "No files match your filters"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Modified</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFiles.map((file) => (
                  <TableRow
                    key={file.path}
                    className={
                      flashingFile === file.path ? "animate-pulse bg-green-50 border-green-200" : ""
                    }
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getFileIcon(file.contentType)}
                        <a
                          href={`/api/storage/files/${encodeURIComponent(file.path)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate max-w-[200px] text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                          title={`Click to view ${file.name}`}
                        >
                          {file.name}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{file.contentType.split("/")[0]}</Badge>
                    </TableCell>
                    <TableCell>{formatFileSize(file.size)}</TableCell>
                    <TableCell>
                      <Badge variant={file.visibility === "public" ? "default" : "secondary"}>
                        {file.visibility}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(file.lastModified).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                className="cursor-pointer"
                              >
                                <Info className="mr-2 h-4 w-4" />
                                File Details
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                  {getFileIcon(file.contentType)}
                                  File Details
                                </DialogTitle>
                                <DialogDescription>
                                  Comprehensive information about this file
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-3">
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        File Name
                                      </Label>
                                      <p className="text-sm break-all">{file.name}</p>
                                    </div>
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        File Path
                                      </Label>
                                      <p className="text-sm font-mono break-all bg-muted px-2 py-1 rounded">
                                        {file.path}
                                      </p>
                                    </div>
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        File Size
                                      </Label>
                                      <p className="text-sm">{formatFileSize(file.size)}</p>
                                    </div>
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        Content Type
                                      </Label>
                                      <p className="text-sm font-mono">{file.contentType}</p>
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        Visibility
                                      </Label>
                                      <div className="flex items-center gap-2">
                                        <Badge
                                          variant={
                                            file.visibility === "public" ? "default" : "secondary"
                                          }
                                        >
                                          {file.visibility}
                                        </Badge>
                                        {file.visibility === "public" ? (
                                          <Unlock className="h-4 w-4 text-green-600" />
                                        ) : (
                                          <Lock className="h-4 w-4 text-orange-600" />
                                        )}
                                      </div>
                                    </div>
                                    <div>
                                      <Label className="text-sm font-semibold text-muted-foreground">
                                        Last Modified
                                      </Label>
                                      <p className="text-sm">
                                        {new Date(file.lastModified).toLocaleString()}
                                      </p>
                                    </div>
                                    {file.url && (
                                      <div>
                                        <Label className="text-sm font-semibold text-muted-foreground">
                                          Public URL
                                        </Label>
                                        <p className="text-sm break-all">
                                          <a
                                            href={file.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800 hover:underline"
                                          >
                                            {file.url}
                                          </a>
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="border-t pt-4">
                                  <Label className="text-sm font-semibold text-muted-foreground">
                                    Quick Actions
                                  </Label>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    <Button size="sm" variant="outline" asChild>
                                      <a
                                        href={`/api/storage/files/${encodeURIComponent(file.path)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <Eye className="mr-2 h-4 w-4" />
                                        View File
                                      </a>
                                    </Button>
                                    {file.url && (
                                      <Button size="sm" variant="outline" asChild>
                                        <a
                                          href={file.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <Download className="mr-2 h-4 w-4" />
                                          Public URL
                                        </a>
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => toggleVisibility(file.path, file.visibility)}
                                    >
                                      {file.visibility === "public" ? (
                                        <>
                                          <Lock className="mr-2 h-4 w-4" />
                                          Make Private
                                        </>
                                      ) : (
                                        <>
                                          <Unlock className="mr-2 h-4 w-4" />
                                          Make Public
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>

                          <DropdownMenuItem asChild>
                            <a
                              href={`/api/storage/files/${encodeURIComponent(file.path)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center cursor-pointer"
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              View File
                            </a>
                          </DropdownMenuItem>

                          {file.url && (
                            <DropdownMenuItem asChild>
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center cursor-pointer"
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Public URL
                              </a>
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuItem
                            onClick={() => toggleVisibility(file.path, file.visibility)}
                            className="cursor-pointer"
                          >
                            {file.visibility === "public" ? (
                              <>
                                <Lock className="mr-2 h-4 w-4" />
                                Make Private
                              </>
                            ) : (
                              <>
                                <Unlock className="mr-2 h-4 w-4" />
                                Make Public
                              </>
                            )}
                          </DropdownMenuItem>

                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={(e) => e.preventDefault()}
                                className="text-destructive cursor-pointer"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete File
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Delete File</DialogTitle>
                                <DialogDescription>
                                  Are you sure you want to delete &quot;{file.name}&quot;? This
                                  action cannot be undone.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => {}}>
                                  Cancel
                                </Button>
                                <Button variant="destructive" onClick={() => deleteFile(file.path)}>
                                  Delete
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
