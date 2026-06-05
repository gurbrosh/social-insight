"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";

export function UserIdentities() {
  const [list, setList] = useState<
    Array<{ platform: string; identity: string; verified: boolean }>
  >([]);
  const [platform, setPlatform] = useState("x");
  const [identity, setIdentity] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/profile/identities");
    if (res.ok) {
      const data = await res.json();
      setList(
        data.map((d: any) => ({
          platform: d.platform,
          identity: d.identity,
          verified: !!d.verified,
        }))
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!identity.trim()) return;
    setLoading(true);
    try {
      await fetch("/api/profile/identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, identity: identity.trim() }),
      });
      setIdentity("");
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function remove(p: string, i: string) {
    setLoading(true);
    try {
      await fetch(
        `/api/profile/identities?platform=${encodeURIComponent(p)}&identity=${encodeURIComponent(i)}`,
        { method: "DELETE" }
      );
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My Platform Identities</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="x">X (Twitter)</SelectItem>
              <SelectItem value="reddit">Reddit</SelectItem>
              <SelectItem value="discord">Discord</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="@handle / username / user ID / URL"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
          />
          <Button onClick={add} disabled={loading || !identity.trim()}>
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground">No identities added.</div>
          ) : (
            list.map((row) => (
              <div
                key={`${row.platform}:${row.identity}`}
                className="flex items-center justify-between text-sm border rounded px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{row.platform}</span>
                  <span>{row.identity}</span>
                  {row.verified && <span className="text-green-600">(verified)</span>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remove(row.platform, row.identity)}
                  disabled={loading}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
