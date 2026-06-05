"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  FileText,
  Folder,
  LogOut,
  Mail,
  Menu,
  Plus,
  Settings,
  User,
} from "lucide-react";

export type WorkspaceProjectNav = { id: string; name: string };

function isProjectResultsPath(pathname: string, projectId: string): boolean {
  const base = `/projects/${projectId}`;
  if (pathname === base) return true;
  if (pathname.startsWith(`${base}/`)) {
    return !pathname.startsWith(`${base}/edit`);
  }
  return false;
}

function isProjectSettingsPath(pathname: string, projectId: string): boolean {
  return (
    pathname === `/projects/${projectId}/edit` ||
    pathname.startsWith(`/projects/${projectId}/edit/`)
  );
}

function WorkspaceNavContent({ projects }: { projects: WorkspaceProjectNav[] }) {
  const pathname = usePathname();
  const pad = "px-2";

  return (
    <div className={cn("flex flex-col gap-1", pad)}>
      <Link href="/projects">
        <Button
          variant={pathname === "/projects" ? "secondary" : "ghost"}
          className="w-full justify-start"
        >
          <Folder className="mr-2 h-4 w-4 shrink-0" />
          Projects
        </Button>
      </Link>
      <Link href="/projects/new">
        <Button variant="ghost" className="w-full justify-start">
          <Plus className="mr-2 h-4 w-4 shrink-0" />
          New project
        </Button>
      </Link>

      <Separator className="my-2" />

      <p className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Your projects
      </p>
      <div className="max-h-[40vh] overflow-y-auto space-y-3 pr-1">
        {projects.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No projects yet</p>
        ) : (
          projects.map((p) => {
            const resultsActive = isProjectResultsPath(pathname, p.id);
            const settingsActive = isProjectSettingsPath(pathname, p.id);
            const projectActive = resultsActive || settingsActive;
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-lg border p-2 transition-colors",
                  projectActive
                    ? "border-primary/45 bg-primary/8 shadow-sm ring-1 ring-primary/25 dark:bg-primary/12"
                    : "border-border/60 bg-muted/20"
                )}
              >
                <p
                  className={cn(
                    "mb-1.5 truncate px-1 text-sm",
                    projectActive
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground"
                  )}
                  title={p.name}
                >
                  {p.name}
                </p>
                <div className="flex flex-col gap-1">
                  <Button
                    asChild
                    variant={resultsActive ? "default" : "ghost"}
                    size="sm"
                    className={cn("w-full justify-start", resultsActive && "shadow-sm font-medium")}
                  >
                    <Link
                      href={`/projects/${p.id}`}
                      aria-current={resultsActive ? "page" : undefined}
                    >
                      <BarChart3 className="mr-2 h-4 w-4 shrink-0" />
                      Results
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant={settingsActive ? "default" : "ghost"}
                    size="sm"
                    className={cn(
                      "w-full justify-start",
                      settingsActive && "shadow-sm font-medium"
                    )}
                  >
                    <Link
                      href={`/projects/${p.id}/edit`}
                      aria-current={settingsActive ? "page" : undefined}
                    >
                      <Settings className="mr-2 h-4 w-4 shrink-0" />
                      Settings
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Separator className="my-2" />

      <p className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Reports
      </p>
      <Link href="/reports/email">
        <Button
          variant={
            pathname === "/reports/email" || pathname.startsWith("/reports/email/")
              ? "secondary"
              : "ghost"
          }
          className="w-full justify-start"
        >
          <Mail className="mr-2 h-4 w-4 shrink-0" />
          Email reports
        </Button>
      </Link>
      <Link href="/reports/exec">
        <Button
          variant={
            pathname === "/reports/exec" || pathname.startsWith("/reports/exec/")
              ? "secondary"
              : "ghost"
          }
          className="w-full justify-start"
        >
          <FileText className="mr-2 h-4 w-4 shrink-0" />
          Exec Report
        </Button>
      </Link>

      <Separator className="my-2" />

      <Link href="/profile">
        <Button
          variant={
            pathname === "/profile" || pathname.startsWith("/profile/") ? "secondary" : "ghost"
          }
          className="w-full justify-start"
        >
          <User className="mr-2 h-4 w-4 shrink-0" />
          Profile
        </Button>
      </Link>
    </div>
  );
}

export function AppWorkspaceShell({
  children,
  projects,
}: {
  children: React.ReactNode;
  projects: WorkspaceProjectNav[];
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
        <div className="flex flex-grow flex-col overflow-y-auto border-r border-border/80 bg-muted">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/50 px-4">
            <Link href="/projects" className="text-lg font-semibold hover:underline">
              Social Insight
            </Link>
            <ThemeToggle />
          </div>
          <nav className="flex flex-1 flex-col px-2 pb-4">
            <WorkspaceNavContent projects={projects} />
          </nav>
          <div className="mt-auto border-t border-border/50 p-4">
            <SignOutButton variant="ghost" className="w-full justify-start">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </SignOutButton>
          </div>
        </div>
      </div>

      <div className="md:hidden">
        <div className="flex h-14 items-center justify-between border-b border-border/80 bg-muted px-4">
          <Link href="/projects" className="text-lg font-semibold">
            Social Insight
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 max-h-[85vh] overflow-y-auto">
                <WorkspaceNavContent projects={projects} />
                <Separator className="my-2" />
                <DropdownMenuItem asChild>
                  <div className="w-full">
                    <SignOutButton variant="ghost" className="w-full justify-start">
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </SignOutButton>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="md:pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
