"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { MoreHorizontal, Search, Mail, Shield, X, Plus, Edit, User, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

type User = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  created_at: string;
  last_signed_in: string | null;
  profile: {
    first_name: string | null;
    last_name: string | null;
  } | null;
  roles: {
    role: {
      name: string;
    };
  }[];
};

type Role = {
  id: string;
  name: string;
};

type UserManagementPanelProps = {
  initialUsers: User[];
  totalCount: number;
  currentPage: number;
  itemsPerPage: number;
  currentUserId: string;
  availableRoles: Role[];
};

export function UserManagementPanel({
  initialUsers,
  totalCount,
  currentPage,
  itemsPerPage,
  currentUserId,
  availableRoles,
}: UserManagementPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState(initialUsers);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isRoleDialogOpen, setIsRoleDialogOpen] = useState(false);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    image: "",
    password: "",
    confirmPassword: "",
    selectedRoles: [] as string[],
  });

  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // Clear action message after 5 seconds
  useEffect(() => {
    if (actionMessage) {
      const timer = setTimeout(() => {
        setActionMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [actionMessage]);

  // Update search query when URL params change
  useEffect(() => {
    const currentSearch = searchParams.get("search") || "";
    setSearchQuery(currentSearch);
  }, [searchParams]);

  // Update users list when initialUsers prop changes (due to server-side search)
  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  function resetForm() {
    setFormData({
      email: "",
      name: "",
      image: "",
      password: "",
      confirmPassword: "",
      selectedRoles: [],
    });
  }

  function openCreateDialog() {
    resetForm();
    setActionMessage(null);
    setIsCreateUserOpen(true);
  }

  function openEditDialog(user: User) {
    setFormData({
      email: user.email,
      name: user.name || "",
      image: user.image || "",
      password: "",
      confirmPassword: "",
      selectedRoles: user.roles.map((r) => r.role.name),
    });
    setSelectedUser(user);
    setActionMessage(null);
    setIsEditUserOpen(true);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const searchTerm = searchQuery.trim();
    if (searchTerm) {
      router.push(`/admin/users?search=${encodeURIComponent(searchTerm)}`);
    } else {
      router.push(`/admin/users`);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    router.push("/admin/users");
  }

  async function handlePasswordReset(userId: string, email: string) {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to send password reset");
      }

      setActionMessage({
        type: "success",
        message: `Password reset link sent to ${email}`,
      });
    } catch {
      setActionMessage({
        type: "error",
        message: "Failed to send password reset link",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRoleToggle(userId: string, roleName: string, hasRole: boolean) {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/users/${userId}/roles`, {
        method: hasRole ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roleName }),
      });

      if (!response.ok) {
        throw new Error("Failed to update role");
      }

      // Update the selected user with new role data
      if (selectedUser) {
        const updatedUser = { ...selectedUser };
        if (hasRole) {
          // Remove role
          updatedUser.roles = updatedUser.roles.filter((r) => r.role.name !== roleName);
        } else {
          // Add role
          const newRole = availableRoles.find((r) => r.name === roleName);
          if (newRole) {
            updatedUser.roles.push({ role: newRole });
          }
        }
        setSelectedUser(updatedUser);

        // Update the user in the list
        setUsers(users.map((u) => (u.id === updatedUser.id ? updatedUser : u)));
      }

      setActionMessage({
        type: "success",
        message: `Role ${hasRole ? "removed" : "added"} successfully`,
      });
    } catch {
      setActionMessage({
        type: "error",
        message: "Failed to update user role",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      setActionMessage({
        type: "error",
        message: "Passwords do not match",
      });
      return;
    }

    if (formData.password.length < 6) {
      setActionMessage({
        type: "error",
        message: "Password must be at least 6 characters",
      });
      return;
    }

    try {
      setIsLoading(true);
      const requestData = {
        email: formData.email,
        name: formData.name,
        image: formData.image,
        password: formData.password,
        roles: formData.selectedRoles,
      };
      console.log("Sending create user request:", requestData);

      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        let errorMessage = "Failed to create user";
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      setIsCreateUserOpen(false);
      resetForm();
      setActionMessage({
        type: "success",
        message: "User created successfully",
      });
      // Force page refresh to show the updated user
      setTimeout(() => {
        router.refresh();
      }, 100);
    } catch (error) {
      console.log("Create user error caught:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to create user";
      console.log("Setting error message:", errorMessage);
      setActionMessage({
        type: "error",
        message: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleEditUser(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedUser) return;

    if (formData.password && formData.password !== formData.confirmPassword) {
      setActionMessage({
        type: "error",
        message: "Passwords do not match",
      });
      return;
    }

    if (formData.password && formData.password.length < 6) {
      setActionMessage({
        type: "error",
        message: "Password must be at least 6 characters",
      });
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
          image: formData.image,
          password: formData.password || undefined,
          roles: formData.selectedRoles,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user");
      }

      setIsEditUserOpen(false);
      resetForm();
      setActionMessage({
        type: "success",
        message: "User updated successfully",
      });
      // Force page refresh to show the updated user
      setTimeout(() => {
        router.refresh();
      }, 100);
    } catch (error) {
      setActionMessage({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update user",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {actionMessage && (
        <Alert variant={actionMessage.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{actionMessage.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between items-center">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Input
              type="text"
              placeholder="Search users by email or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm pr-8"
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-2 hover:bg-transparent"
                onClick={clearSearch}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button type="submit" variant="secondary">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </form>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add New User
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Avatar</TableHead>
              <TableHead>User ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted overflow-hidden">
                    {user.image ? (
                      <Image
                        src={
                          user.image.startsWith("http")
                            ? `/api/avatar?url=${encodeURIComponent(user.image)}`
                            : user.image
                        }
                        alt={user.name || user.email}
                        width={32}
                        height={32}
                        className="rounded-full object-cover"
                        onError={(e) => {
                          console.log("Image failed to load:", user.image);
                          const target = e.currentTarget as HTMLImageElement;
                          target.style.display = "none";
                          const fallback = target.nextElementSibling as HTMLElement;
                          if (fallback) {
                            fallback.style.display = "flex";
                          }
                        }}
                      />
                    ) : null}
                    <div
                      className={`flex items-center justify-center h-8 w-8 ${user.image ? "hidden" : "flex"}`}
                    >
                      <User className="h-4 w-4" />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{user.id}</TableCell>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{user.name || "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {user.roles.map((r) => (
                      <Badge key={r.role.name} variant="secondary">
                        {r.role.name}
                      </Badge>
                    ))}
                    {user.roles.length === 0 && <Badge variant="outline">user</Badge>}
                  </div>
                </TableCell>
                <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {user.last_signed_in
                    ? new Date(user.last_signed_in).toLocaleDateString()
                    : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedUser(user);
                          setIsDetailsOpen(true);
                        }}
                      >
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEditDialog(user)} disabled={isLoading}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handlePasswordReset(user.id, user.email)}
                        disabled={isLoading}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Send Password Reset
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setSelectedUser(user);
                          setIsRoleDialogOpen(true);
                        }}
                      >
                        <Shield className="mr-2 h-4 w-4" />
                        Manage Roles
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const search = searchParams.get("search");
              const url = search
                ? `/admin/users?page=${currentPage - 1}&search=${encodeURIComponent(search)}`
                : `/admin/users?page=${currentPage - 1}`;
              router.push(url);
            }}
            disabled={currentPage <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              const search = searchParams.get("search");
              const url = search
                ? `/admin/users?page=${currentPage + 1}&search=${encodeURIComponent(search)}`
                : `/admin/users?page=${currentPage + 1}`;
              router.push(url);
            }}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>Detailed information about {selectedUser?.email}</DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center justify-center h-16 w-16 rounded-full bg-muted overflow-hidden">
                  {selectedUser.image ? (
                    <Image
                      src={
                        selectedUser.image.startsWith("http")
                          ? `/api/avatar?url=${encodeURIComponent(selectedUser.image)}`
                          : selectedUser.image
                      }
                      alt={selectedUser.name || selectedUser.email}
                      width={64}
                      height={64}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-8 w-8" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{selectedUser.name || "Unnamed User"}</h3>
                  <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <span className="font-medium">Email:</span>
                  <span>{selectedUser.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">User ID:</span>
                  <span className="font-mono text-sm">{selectedUser.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Name:</span>
                  <span>{selectedUser.name || "Not provided"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Avatar:</span>
                  <span className="text-xs break-all">{selectedUser.image || "Not provided"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Joined:</span>
                  <span>{new Date(selectedUser.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Last Sign In:</span>
                  <span>
                    {selectedUser.last_signed_in
                      ? new Date(selectedUser.last_signed_in).toLocaleString()
                      : "Never"}
                  </span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="font-medium">Roles:</span>
                  <div className="flex gap-1">
                    {selectedUser.roles.map((r) => (
                      <Badge key={r.role.name}>{r.role.name}</Badge>
                    ))}
                    {selectedUser.roles.length === 0 && <Badge variant="outline">user</Badge>}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isRoleDialogOpen} onOpenChange={setIsRoleDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Roles</DialogTitle>
            <DialogDescription>Add or remove roles for {selectedUser?.email}</DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Current Roles</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedUser.roles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">No roles assigned</span>
                  ) : (
                    selectedUser.roles.map((userRole) => (
                      <Badge
                        key={userRole.role.name}
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        {userRole.role.name}
                        {!(selectedUser.id === currentUserId && userRole.role.name === "admin") && (
                          <button
                            onClick={() =>
                              handleRoleToggle(selectedUser.id, userRole.role.name, true)
                            }
                            disabled={isLoading}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </Badge>
                    ))
                  )}
                </div>
                {selectedUser.id === currentUserId &&
                  selectedUser.roles.some((r) => r.role.name === "admin") && (
                    <p className="text-xs text-muted-foreground mt-1">
                      You cannot remove your own admin role
                    </p>
                  )}
              </div>

              <div>
                <h4 className="font-medium mb-2">Add Role</h4>
                <div className="flex gap-2">
                  <Select
                    onValueChange={(roleName) => {
                      handleRoleToggle(selectedUser.id, roleName, false);
                    }}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role to add" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles
                        .filter(
                          (role) => !selectedUser.roles.some((ur) => ur.role.name === role.name)
                        )
                        .map((role) => (
                          <SelectItem key={role.id} value={role.name}>
                            {role.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>Add a new user to the system</DialogDescription>
          </DialogHeader>

          {actionMessage && (
            <Alert variant={actionMessage.type === "error" ? "destructive" : "default"}>
              <AlertDescription>{actionMessage.message}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image">Avatar URL</Label>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Input
                    id="image"
                    type="url"
                    placeholder="https://example.com/avatar.jpg"
                    value={formData.image}
                    onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                    disabled={isLoading}
                  />
                </div>
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-muted overflow-hidden">
                  {formData.image ? (
                    <Image
                      src={
                        formData.image.startsWith("http")
                          ? `/api/avatar?url=${encodeURIComponent(formData.image)}`
                          : formData.image
                      }
                      alt="Avatar preview"
                      width={40}
                      height={40}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={isLoading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password *</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                disabled={isLoading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="space-y-2">
                {availableRoles.map((role) => (
                  <div key={role.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={formData.selectedRoles.includes(role.name)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFormData({
                            ...formData,
                            selectedRoles: [...formData.selectedRoles, role.name],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            selectedRoles: formData.selectedRoles.filter((r) => r !== role.name),
                          });
                        }
                      }}
                      disabled={isLoading}
                    />
                    <Label htmlFor={`role-${role.id}`}>{role.name}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateUserOpen(false);
                  resetForm();
                  setActionMessage(null);
                }}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                Create User
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user information</DialogDescription>
          </DialogHeader>

          {actionMessage && (
            <Alert variant={actionMessage.type === "error" ? "destructive" : "default"}>
              <AlertDescription>{actionMessage.message}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleEditUser} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email *</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-image">Avatar URL</Label>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Input
                    id="edit-image"
                    type="url"
                    placeholder="https://example.com/avatar.jpg"
                    value={formData.image}
                    onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                    disabled={isLoading}
                  />
                </div>
                <div className="flex items-center justify-center h-10 w-10 rounded-full bg-muted overflow-hidden">
                  {formData.image ? (
                    <Image
                      src={
                        formData.image.startsWith("http")
                          ? `/api/avatar?url=${encodeURIComponent(formData.image)}`
                          : formData.image
                      }
                      alt="Avatar preview"
                      width={40}
                      height={40}
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">New Password (leave empty to keep current)</Label>
              <Input
                id="edit-password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                disabled={isLoading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-confirmPassword">Confirm New Password</Label>
              <Input
                id="edit-confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                disabled={isLoading}
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="space-y-2">
                {availableRoles.map((role) => (
                  <div key={role.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-role-${role.id}`}
                      checked={formData.selectedRoles.includes(role.name)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setFormData({
                            ...formData,
                            selectedRoles: [...formData.selectedRoles, role.name],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            selectedRoles: formData.selectedRoles.filter((r) => r !== role.name),
                          });
                        }
                      }}
                      disabled={
                        isLoading || (selectedUser?.id === currentUserId && role.name === "admin")
                      }
                    />
                    <Label htmlFor={`edit-role-${role.id}`}>{role.name}</Label>
                    {selectedUser?.id === currentUserId && role.name === "admin" && (
                      <span className="text-xs text-muted-foreground">
                        (cannot remove own admin role)
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsEditUserOpen(false);
                  resetForm();
                  setActionMessage(null);
                }}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                Update User
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
