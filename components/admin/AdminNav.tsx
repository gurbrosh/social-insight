"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
  Building2,
} from "lucide-react";

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
    label: "Search Sources",
    icon: Bot,
  },
  {
    href: "/admin/orchestration",
    label: "Orchestration",
    icon: Workflow,
  },
  {
    href: "/admin/brand-directory",
    label: "Brand Directory",
    icon: Building2,
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
    href: "/admin/config",
    label: "Configuration",
    icon: Settings,
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
  },
];

export function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact = false) => {
    if (exact) {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <nav className="flex-1 space-y-1 px-2 pb-4">
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href, item.exact);

        return (
          <Link key={item.href} href={item.href}>
            <Button variant={active ? "secondary" : "ghost"} className="w-full justify-start">
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </Button>
          </Link>
        );
      })}
    </nav>
  );
}
