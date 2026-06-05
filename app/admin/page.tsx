import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, Clock, TrendingUp } from "lucide-react";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

async function getStats() {
  const [totalUsers, activeUsers, recentSignups] = await Promise.all([
    prisma.user.count({
      where: { deleted_at: null },
    }),
    prisma.user.count({
      where: {
        deleted_at: null,
        last_signed_in: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      },
    }),
    prisma.user.count({
      where: {
        deleted_at: null,
        created_at: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      },
    }),
  ]);

  const recentUsers = await prisma.user.findMany({
    where: { deleted_at: null },
    orderBy: { created_at: "desc" },
    take: 5,
    include: {
      profile: true,
    },
  });

  return {
    totalUsers,
    activeUsers,
    recentSignups,
    recentUsers,
  };
}

export default async function AdminDashboard() {
  const stats = await getStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to your admin dashboard</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
            <p className="text-xs text-muted-foreground">All registered users</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeUsers}</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recent Signups</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.recentSignups}</div>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Daily Signups</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.recentSignups / 7).toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">7 day average</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>Latest users who signed up</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stats.recentUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{user.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Joined {new Date(user.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-sm text-muted-foreground">
                  {user.last_signed_in
                    ? `Last seen ${new Date(user.last_signed_in).toLocaleDateString()}`
                    : "Never signed in"}
                </div>
              </div>
            ))}
            {stats.recentUsers.length === 0 && (
              <p className="text-center text-muted-foreground">No users yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
