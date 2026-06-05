import { requireRole } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme-toggle";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { LogOut, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("admin");

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Navigation */}
      <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
        <div className="flex flex-grow flex-col overflow-y-auto border-r bg-card">
          <div className="flex h-16 items-center justify-between px-4">
            <h2 className="text-lg font-semibold">Admin Dashboard</h2>
            <ThemeToggle />
          </div>
          <AdminNav />
          <div className="p-4">
            <Separator className="mb-4" />
            <SignOutButton variant="ghost" className="w-full justify-start">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </SignOutButton>
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="md:hidden">
        <div className="flex h-16 items-center justify-between border-b bg-card px-4">
          <h2 className="text-lg font-semibold">Admin Dashboard</h2>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <AdminMobileNav />
                <Separator className="my-1" />
                <DropdownMenuItem asChild>
                  <div className="w-full">
                    <SignOutButton variant="ghost" className="w-full justify-start">
                      <LogOut className="mr-2 h-4 w-4" />
                      Logout
                    </SignOutButton>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="md:pl-64">
        <main className="py-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
