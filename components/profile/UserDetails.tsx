"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Mail, User, Clock } from "lucide-react";

interface UserDetailsProps {
  user: {
    id: string;
    email: string;
    name: string | null;
    created_at: Date;
    last_signed_in: Date | null;
    profile: {
      first_name: string | null;
      last_name: string | null;
    } | null;
  };
}

export function UserDetails({ user }: UserDetailsProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Account Details
        </CardTitle>
        <CardDescription>Your personal information and account settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email Address
            </Label>
            <Input id="email" value={user.email} disabled className="bg-muted" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="full-name">Full Name</Label>
            <Input
              id="full-name"
              value={user.name || ""}
              placeholder="Not provided"
              disabled
              className="bg-muted"
            />
          </div>

          <div className="grid gap-2">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Member Since
            </Label>
            <Input value={formatDate(user.created_at)} disabled className="bg-muted" />
          </div>

          {user.last_signed_in && (
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Last Sign In
              </Label>
              <Input value={formatDate(user.last_signed_in)} disabled className="bg-muted" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
