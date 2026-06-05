"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Users,
  Settings,
  Shield,
  Database,
  Upload,
  Mail,
  Terminal,
  Bot,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigationItems = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    exact: true, // Only match exact path for dashboard
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: Users,
  },
  {
    href: "/admin/roles",
    label: "Roles",
    icon: Shield,
  },
  {
    href: "/admin/database",
    label: "Database Viewer",
    icon: Database,
  },
  {
    href: "/admin/media",
    label: "Media",
    icon: Upload,
  },
  {
    href: "/admin/scrapers",
    label: "Scrapers",
    icon: Bot,
  },
  {
    href: "/admin/orchestration",
    label: "Orchestration",
    icon: Workflow,
  },
  {
    href: "/admin/email-templates",
    label: "Email Templates",
    icon: Mail,
  },
  {
    href: "/admin/environment",
    label: "Environment",
    icon: Terminal,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
  },
];

export function AdminMobileNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact = false) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, item.exact);

        return (
          <DropdownMenuItem key={item.href} asChild>
            <Link
              href={item.href}
              className={cn(active && "bg-secondary text-secondary-foreground")}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Link>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
