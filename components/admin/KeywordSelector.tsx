"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, X } from "lucide-react";

interface Project {
  id: string;
  name: string;
  keywords: Array<{
    id: string;
    keyword: string;
  }>;
}

interface KeywordSelectorProps {
  selectedKeywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
}

export function KeywordSelector({
  selectedKeywords,
  onKeywordsChange,
  selectedProjectId,
  onProjectChange,
}: KeywordSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [customKeywords, setCustomKeywords] = useState<string[]>([]);
  const [newCustomKeyword, setNewCustomKeyword] = useState("");

  // Fetch projects with keywords
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/projects");
        if (!response.ok) throw new Error("Failed to fetch projects");

        const data = await response.json();
        setProjects(data || []);
      } catch (error) {
        console.error("Error fetching projects:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  // Get keywords from selected project
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const projectKeywords = selectedProject?.keywords || [];

  // Filter keywords based on search term
  const filteredKeywords = projectKeywords.filter((keyword) =>
    keyword.keyword.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleKeyword = (keyword: string) => {
    if (selectedKeywords.includes(keyword)) {
      onKeywordsChange(selectedKeywords.filter((k) => k !== keyword));
    } else {
      onKeywordsChange([...selectedKeywords, keyword]);
    }
  };

  const addCustomKeyword = () => {
    if (newCustomKeyword.trim() && !customKeywords.includes(newCustomKeyword.trim())) {
      const newKeywords = [...customKeywords, newCustomKeyword.trim()];
      setCustomKeywords(newKeywords);
      onKeywordsChange([...selectedKeywords, newCustomKeyword.trim()]);
      setNewCustomKeyword("");
    }
  };

  const removeCustomKeyword = (keyword: string) => {
    const newCustomKeywords = customKeywords.filter((k) => k !== keyword);
    setCustomKeywords(newCustomKeywords);
    onKeywordsChange(selectedKeywords.filter((k) => k !== keyword));
  };

  const selectAllKeywords = () => {
    const allProjectKeywords = filteredKeywords.map((k) => k.keyword);
    const allKeywords = [...new Set([...allProjectKeywords, ...customKeywords])];
    onKeywordsChange(allKeywords);
  };

  const deselectAllKeywords = () => {
    onKeywordsChange([]);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select Keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Project Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <Label htmlFor="project">Choose a project to select keywords from</Label>
            <Select
              value={selectedProjectId || ""}
              onValueChange={(value) => {
                onProjectChange?.(value);
                // Clear selected keywords when project changes
                onKeywordsChange([]);
                setSearchTerm("");
              }}
              disabled={projects.length === 0}
            >
              <SelectTrigger className="mt-1">
                <SelectValue
                  placeholder={
                    projects.length === 0
                      ? "No projects available. Create a project first."
                      : "Select a project..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} ({project.keywords.length} keywords)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                You need to create a project first before you can select keywords for testing.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Project Keywords */}
      {selectedProjectId && (
        <Card>
          <CardHeader>
            <CardTitle>Keywords from {selectedProject?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="search">Search Keywords</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search keywords..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Select All / Deselect All Buttons */}
            {filteredKeywords.length > 0 && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={selectAllKeywords}
                  className="text-xs"
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={deselectAllKeywords}
                  className="text-xs"
                >
                  Deselect All
                </Button>
              </div>
            )}

            {filteredKeywords.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {searchTerm
                  ? "No keywords found matching your search."
                  : "No keywords available in this project."}
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {filteredKeywords.map((keyword) => (
                  <div key={keyword.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`keyword-${keyword.id}`}
                      checked={selectedKeywords.includes(keyword.keyword)}
                      onCheckedChange={() => toggleKeyword(keyword.keyword)}
                    />
                    <Label htmlFor={`keyword-${keyword.id}`} className="flex-1 cursor-pointer">
                      {keyword.keyword}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Custom Keywords */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Keywords</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter custom keyword..."
              value={newCustomKeyword}
              onChange={(e) => setNewCustomKeyword(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && addCustomKeyword()}
            />
            <Button type="button" onClick={addCustomKeyword} disabled={!newCustomKeyword.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {customKeywords.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Added Custom Keywords:</p>
              <div className="flex flex-wrap gap-2">
                {customKeywords.map((keyword) => (
                  <Badge key={keyword} variant="secondary" className="flex items-center gap-1">
                    {keyword}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 ml-1"
                      onClick={() => removeCustomKeyword(keyword)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Keywords Summary */}
      {selectedKeywords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Keywords ({selectedKeywords.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {selectedKeywords.map((keyword) => (
                <Badge key={keyword} variant="default">
                  {keyword}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
