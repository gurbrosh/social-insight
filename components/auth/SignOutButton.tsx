"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface SignOutButtonProps {
  className?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  children?: React.ReactNode;
}

export function SignOutButton({
  className = "w-full",
  variant = "outline",
  children = "Sign Out",
}: SignOutButtonProps) {
  const handleSignOut = () => {
    signOut({ callbackUrl: "/auth/signin" });
  };

  return (
    <Button type="button" className={className} variant={variant} onClick={handleSignOut}>
      {children}
    </Button>
  );
}
