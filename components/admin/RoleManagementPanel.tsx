"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, Shield, Users } from "lucide-react";

type Role = {
  id: string;
  name: string;
  created_at: string;
  _count: {
    users: number;
  };
};

const createRoleSchema = z.object({
  name: z
    .string()
    .min(1, { error: "Role name is required" })
    .max(50, { error: "Role name must be less than 50 characters" })
    .regex(/^[a-z0-9_-]+$/, {
      error: "Role name must contain only lowercase letters, numbers, hyphens, and underscores",
    }),
});

type CreateRoleData = z.infer<typeof createRoleSchema>;

type RoleManagementPanelProps = {
  initialRoles: Role[];
};

export function RoleManagementPanel({ initialRoles }: RoleManagementPanelProps) {
  const [roles, setRoles] = useState(initialRoles);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const form = useForm<CreateRoleData>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: "",
    },
  });

  const protectedRoles = ["user", "admin"];

  async function onCreateRole(data: CreateRoleData) {
    try {
      setIsLoading(true);
      setMessage(null);

      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create role");
      }

      setMessage({
        type: "success",
        text: `Role "${data.name}" created successfully`,
      });

      form.reset();
      setIsCreateOpen(false);

      // Refresh the roles list
      const rolesResponse = await fetch("/api/admin/roles");
      if (rolesResponse.ok) {
        const { roles: updatedRoles } = await rolesResponse.json();
        setRoles(updatedRoles);
      }
    } catch {
      setMessage({
        type: "error",
        text: "Failed to create role",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteRole(roleId: string, roleName: string) {
    if (protectedRoles.includes(roleName)) {
      setMessage({
        type: "error",
        text: `Cannot delete the "${roleName}" role`,
      });
      return;
    }

    if (!confirm(`Are you sure you want to delete the "${roleName}" role?`)) {
      return;
    }

    try {
      setIsLoading(true);
      setMessage(null);

      const response = await fetch(`/api/admin/roles/${roleId}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete role");
      }

      setMessage({
        type: "success",
        text: `Role "${roleName}" deleted successfully`,
      });

      // Remove the role from the local state
      setRoles(roles.filter((role) => role.id !== roleId));
    } catch {
      setMessage({
        type: "error",
        text: "Failed to delete role",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">System Roles</h2>
          <p className="text-sm text-muted-foreground">
            Manage roles that can be assigned to users
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Role
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Role</DialogTitle>
              <DialogDescription>
                Add a new role to the system. Role names should be lowercase and can contain
                letters, numbers, hyphens, and underscores.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCreateRole)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., moderator, editor, viewer" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? "Creating..." : "Create Role"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => {
              const isProtected = protectedRoles.includes(role.name);

              return (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {role.name === "admin" && <Shield className="h-4 w-4 text-primary" />}
                      {role.name === "user" && <Users className="h-4 w-4 text-muted-foreground" />}
                      {role.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isProtected ? (
                      <Badge variant="secondary">System</Badge>
                    ) : (
                      <Badge variant="outline">Custom</Badge>
                    )}
                  </TableCell>
                  <TableCell>{role._count.users}</TableCell>
                  <TableCell>{new Date(role.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {!isProtected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteRole(role.id, role.name)}
                        disabled={isLoading || role._count.users > 0}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    {role._count.users > 0 && !isProtected && (
                      <span className="text-xs text-muted-foreground ml-2">Has users</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="text-sm text-muted-foreground">
        <p>• System roles (user, admin) cannot be deleted</p>
        <p>• Roles with assigned users must have all users removed before deletion</p>
      </div>
    </div>
  );
}
