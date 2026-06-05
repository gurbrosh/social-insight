"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Search, Loader2, Users, Building, Hash } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Profile {
  id: string;
  name: string;
  url: string;
  type: "person" | "company" | "channel";
  selected: boolean;
}

interface PlatformProfiles {
  [platform: string]: Profile[];
}

interface PeopleProfilesChannelsProps {
  profiles: PlatformProfiles;
  onProfilesChange: (profiles: PlatformProfiles) => void;
  keywords: string[];
  selectedBrands?: string[];
}

export function PeopleProfilesChannels({
  profiles,
  onProfilesChange,
  keywords,
  selectedBrands = [],
}: PeopleProfilesChannelsProps) {
  const [activeTab, setActiveTab] = useState("facebook");
  const [isLoading, setIsLoading] = useState(false);

  const platforms = [
    { id: "facebook", name: "Facebook", icon: "📘" },
    { id: "linkedin", name: "LinkedIn", icon: "💼" },
    { id: "x", name: "X (Twitter)", icon: "🐦" },
    { id: "instagram", name: "Instagram", icon: "📷" },
    { id: "youtube", name: "YouTube", icon: "📺" },
    { id: "tiktok", name: "TikTok", icon: "🎵" },
    { id: "reddit", name: "Reddit", icon: "🔴" },
    { id: "discord", name: "Discord", icon: "💬" },
    { id: "podcasts", name: "Podcasts", icon: "🎧" },
    { id: "websites", name: "Websites", icon: "🌐" },
    { id: "news-outlets", name: "News", icon: "📰" },
  ];

  const initializePlatform = (platformId: string): Profile[] => {
    if (!profiles[platformId]) {
      const newProfiles: PlatformProfiles = { ...profiles, [platformId]: [] };
      onProfilesChange(newProfiles);
      return [];
    }
    return profiles[platformId];
  };

  const handleFindProfiles = async (platform: string) => {
    if (keywords.length === 0) {
      toast({
        title: "Keywords required",
        description: "Please add keywords first to find related profiles and channels.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      let apiProfiles: Profile[] = [];

      if (platform === "facebook") {
        // Call the Facebook-specific API
        const response = await fetch("/api/projects/find-facebook-profiles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keywords,
            brands: selectedBrands,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to find Facebook profiles");
        }

        const data = await response.json();
        apiProfiles = data.profiles.map((profile: any) => ({
          id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: profile.name,
          url: profile.url,
          type: profile.type,
          selected: true,
        }));
      } else if (platform === "linkedin") {
        // Call the LinkedIn-specific API
        const response = await fetch("/api/projects/find-linkedin-profiles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keywords,
            brands: selectedBrands,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to find LinkedIn profiles");
        }

        const data = await response.json();
        apiProfiles = data.profiles.map((profile: any) => ({
          id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: profile.name,
          url: profile.url,
          type: profile.type,
          selected: true,
        }));
      } else if (platform === "twitter") {
        // Call the Twitter-specific API
        const response = await fetch("/api/projects/find-twitter-profiles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keywords,
            brands: selectedBrands,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to find Twitter profiles");
        }

        const data = await response.json();
        apiProfiles = data.profiles.map((profile: any) => ({
          id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: profile.name,
          url: profile.url,
          type: profile.type,
          selected: true,
        }));
      } else if (platform === "discord") {
        // Call the Discord-specific API
        const response = await fetch("/api/projects/find-discord-profiles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            keywords,
            brands: selectedBrands,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to find Discord profiles");
        }

        const data = await response.json();
        apiProfiles = data.profiles.map((profile: any) => ({
          id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: profile.name,
          url: profile.url,
          type: profile.type,
          selected: true,
        }));
      } else {
        // For other platforms, use mock data for now
        const mockProfiles: Profile[] = [
          {
            id: `mock-1-${Date.now()}`,
            name: `${keywords[0]} Official Page`,
            url: `https://${platform}.com/${keywords[0].toLowerCase()}`,
            type: "company",
            selected: true,
          },
          {
            id: `mock-2-${Date.now()}`,
            name: `${keywords[0]} Community`,
            url: `https://${platform}.com/groups/${keywords[0].toLowerCase()}`,
            type: "channel",
            selected: true,
          },
        ];
        apiProfiles = mockProfiles;
      }

      const currentProfiles = initializePlatform(platform);
      const existingUrls = new Set(currentProfiles.map((p) => p.url));
      const newProfiles = apiProfiles.filter((p) => !existingUrls.has(p.url));

      const updatedProfiles = [...currentProfiles, ...newProfiles];

      const updatedPlatformProfiles = {
        ...profiles,
        [platform]: updatedProfiles,
      };

      onProfilesChange(updatedPlatformProfiles);

      toast({
        title: "Profiles found",
        description: `Found ${newProfiles.length} new ${platform} profiles related to your keywords.`,
      });
    } catch (error) {
      console.error("Error finding profiles:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to find profiles. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddManualProfile = (
    platform: string,
    name: string,
    url: string,
    type: Profile["type"]
  ) => {
    if (!name.trim() || !url.trim()) {
      toast({
        title: "Missing information",
        description: "Please provide both name and URL for the profile.",
        variant: "destructive",
      });
      return;
    }

    const currentProfiles = initializePlatform(platform);
    const existingUrls = new Set(currentProfiles.map((p) => p.url.toLowerCase()));

    if (existingUrls.has(url.toLowerCase())) {
      toast({
        title: "Profile already exists",
        description: "This URL is already in your list.",
        variant: "destructive",
      });
      return;
    }

    const newProfile: Profile = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      url: url.trim(),
      type,
      selected: true,
    };

    const updatedProfiles = [...currentProfiles, newProfile];
    const updatedPlatformProfiles = {
      ...profiles,
      [platform]: updatedProfiles,
    };

    onProfilesChange(updatedPlatformProfiles);

    toast({
      title: "Profile added",
      description: `Added ${name} to your ${platform} profiles.`,
    });
  };

  const handleRemoveProfile = (platform: string, profileId: string) => {
    const currentProfiles = profiles[platform] || [];
    const updatedProfiles = currentProfiles.filter((p) => p.id !== profileId);

    const updatedPlatformProfiles = {
      ...profiles,
      [platform]: updatedProfiles,
    };

    onProfilesChange(updatedPlatformProfiles);
  };

  const handleToggleProfile = (platform: string, profileId: string, selected: boolean) => {
    const currentProfiles = profiles[platform] || [];
    const updatedProfiles = currentProfiles.map((p) =>
      p.id === profileId ? { ...p, selected } : p
    );

    const updatedPlatformProfiles = {
      ...profiles,
      [platform]: updatedProfiles,
    };

    onProfilesChange(updatedPlatformProfiles);
  };

  const handleSelectAllProfiles = (platform: string) => {
    const currentProfiles = profiles[platform] || [];
    const updatedProfiles = currentProfiles.map((p) => ({ ...p, selected: true }));

    const updatedPlatformProfiles = {
      ...profiles,
      [platform]: updatedProfiles,
    };

    onProfilesChange(updatedPlatformProfiles);
  };

  const handleUnselectAllProfiles = (platform: string) => {
    const currentProfiles = profiles[platform] || [];
    const updatedProfiles = currentProfiles.map((p) => ({ ...p, selected: false }));

    const updatedPlatformProfiles = {
      ...profiles,
      [platform]: updatedProfiles,
    };

    onProfilesChange(updatedPlatformProfiles);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getProfileIcon = (type: Profile["type"]) => {
    switch (type) {
      case "person":
        return <Users className="h-4 w-4" />;
      case "company":
        return <Building className="h-4 w-4" />;
      case "channel":
        return <Hash className="h-4 w-4" />;
      default:
        return <Users className="h-4 w-4" />;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const getProfileTypeColor = (type: Profile["type"]) => {
    switch (type) {
      case "person":
        return "bg-blue-100 text-blue-800";
      case "company":
        return "bg-green-100 text-green-800";
      case "channel":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const ManualProfileForm = ({
    platform,
    type: defaultType,
  }: {
    platform: string;
    type?: Profile["type"];
  }) => {
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [type, setType] = useState<Profile["type"]>(
      defaultType || (platform === "discord" ? "channel" : "company")
    );

    const handleAdd = () => {
      handleAddManualProfile(platform, name, url, type);
      setName("");
      setUrl("");
      setType(defaultType || (platform === "discord" ? "channel" : "company"));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    };

    return (
      <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`${platform}-name`}>Name</Label>
            <Input
              id={`${platform}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Profile name"
              className="text-sm"
            />
          </div>
          {!defaultType && (
            <div>
              <Label htmlFor={`${platform}-type`}>Type</Label>
              <select
                id={`${platform}-type`}
                value={type}
                onChange={(e) => setType(e.target.value as Profile["type"])}
                className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
              >
                {platform !== "discord" && <option value="person">Person</option>}
                {platform !== "discord" && <option value="company">Company</option>}
                {platform !== "facebook" && platform !== "linkedin" && platform !== "twitter" && (
                  <option value="channel">
                    {platform === "discord" ? "Server/Channel" : "Channel/Group"}
                  </option>
                )}
              </select>
            </div>
          )}
        </div>
        <div>
          <Label htmlFor={`${platform}-url`}>URL</Label>
          <Input
            id={`${platform}-url`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://platform.com/profile"
            type="url"
            className="text-sm"
          />
        </div>
        <Button type="button" onClick={handleAdd} size="sm" className="text-xs">
          <Plus className="h-3 w-3 mr-1" />
          Add {defaultType || "Profile"}
        </Button>
      </div>
    );
  };

  const PlatformTabContent = ({ platform }: { platform: (typeof platforms)[0] }) => {
    const platformProfiles = profiles[platform.id] || [];
    const selectedCount = platformProfiles.filter((p) => p.selected).length;

    // Group profiles by type
    const persons = platformProfiles.filter((p) => p.type === "person");
    const companies = platformProfiles.filter((p) => p.type === "company");
    const channels = platformProfiles.filter((p) => p.type === "channel");

    const ProfileColumn = ({
      title,
      profiles,
      type,
    }: {
      title: string;
      profiles: Profile[];
      type: Profile["type"];
    }) => (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">{title}</h4>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex items-center gap-2 p-2 border rounded text-sm">
              <input
                type="checkbox"
                checked={profile.selected}
                onChange={(e) => handleToggleProfile(platform.id, profile.id, e.target.checked)}
                className="rounded"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{profile.name}</div>
                <div className="text-xs text-muted-foreground truncate">{profile.url}</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveProfile(platform.id, profile.id)}
                className="h-6 w-6 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* Manual add form for this type */}
        <ManualProfileForm platform={platform.id} type={type} />
      </div>
    );

    return (
      <TabsContent value={platform.id} className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{platform.icon}</span>
            <div>
              <h3 className="font-medium">{platform.name} Profiles</h3>
              <p className="text-sm text-muted-foreground">
                {selectedCount} of {platformProfiles.length} profiles selected
              </p>
            </div>
          </div>
          {platformProfiles.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSelectAllProfiles(platform.id)}
                className="flex items-center gap-2"
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleUnselectAllProfiles(platform.id)}
                className="flex items-center gap-2"
              >
                Unselect All
              </Button>
            </div>
          )}
        </div>

        {platformProfiles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <div className="text-4xl mb-4">{platform.icon}</div>
            <p>No {platform.name} profiles added yet.</p>
            <p className="text-sm">Use AI to find profiles or add them manually below.</p>
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 ${platform.id === "discord" ? "md:grid-cols-1" : platform.id === "facebook" || platform.id === "linkedin" || platform.id === "twitter" ? "md:grid-cols-2" : "md:grid-cols-3"} gap-6`}
          >
            {platform.id !== "discord" && (
              <ProfileColumn title="Person" profiles={persons} type="person" />
            )}
            {platform.id !== "discord" && (
              <ProfileColumn title="Company" profiles={companies} type="company" />
            )}
            {platform.id !== "facebook" &&
              platform.id !== "linkedin" &&
              platform.id !== "twitter" && (
                <ProfileColumn
                  title={platform.id === "discord" ? "Server/Channel" : "Channel/Group"}
                  profiles={channels}
                  type="channel"
                />
              )}
          </div>
        )}

        {/* Fallback manual form when no profiles exist */}
        {platformProfiles.length === 0 && <ManualProfileForm platform={platform.id} />}
      </TabsContent>
    );
  };

  const totalProfiles = Object.values(profiles).reduce(
    (acc, platformProfiles) => acc + platformProfiles.length,
    0
  );
  const totalSelected = Object.values(profiles).reduce(
    (acc, platformProfiles) => acc + platformProfiles.filter((p) => p.selected).length,
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          People, Profiles & Channels
        </CardTitle>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          <p>Define specific people or company profiles to monitor on social platforms.</p>
          <p>
            Add new targets as they appear in data collection results. Use AI Find to get started.
          </p>
        </div>
        <div className="text-sm text-muted-foreground mt-4">
          {totalSelected} of {totalProfiles} profiles selected
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleFindProfiles(activeTab)}
            disabled={isLoading || keywords.length === 0}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            AI Find
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
            {platforms.map((platform) => (
              <TabsTrigger
                key={platform.id}
                value={platform.id}
                className="flex items-center gap-1"
              >
                <span>{platform.icon}</span>
                <span className="hidden sm:inline">{platform.name}</span>
                {profiles[platform.id]?.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                    {profiles[platform.id].length}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {platforms.map((platform) => (
            <PlatformTabContent key={platform.id} platform={platform} />
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
