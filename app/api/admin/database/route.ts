import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth/permissions";
import { auth } from "@/lib/auth";

// Force dynamic rendering for Docker builds
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permissions
    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tableName = searchParams.get("table");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "100");
    const sortBy = searchParams.get("sortBy");
    const sortDir = searchParams.get("sortDir") || "asc";

    if (!tableName) {
      return NextResponse.json({ error: "Table name is required" }, { status: 400 });
    }

    // Validate table name to prevent SQL injection
    const validTables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `;
    const isValidTable = validTables.some((t) => t.name === tableName);

    if (!isValidTable) {
      return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
    }

    // Get column information
    const columns: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      `PRAGMA table_info("${tableName}")`
    );
    const columnNames = columns.map((col) => col.name);

    // Validate sort column if provided
    if (sortBy) {
      const isValidColumn = columnNames.includes(sortBy);
      if (!isValidColumn) {
        return NextResponse.json({ error: "Invalid sort column" }, { status: 400 });
      }
    }

    // Get total count
    const countResult: Array<{ count: number }> = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    const totalCount = countResult[0]?.count || 0;

    // Build query with optional sorting
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM "${tableName}"`;

    if (sortBy) {
      // Use double quotes for column names to handle special characters
      query += ` ORDER BY "${sortBy}" ${sortDir.toUpperCase()}`;
    }

    query += ` LIMIT ${limit} OFFSET ${offset}`;

    // Execute query
    const data = await prisma.$queryRawUnsafe(query);

    return NextResponse.json({
      data,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      columns: columnNames,
    });
  } catch (error) {
    console.error("Error fetching table data:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permissions
    const isUserAdmin = await isAdmin(session.user.id);
    if (!isUserAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const tableName = searchParams.get("table");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "100");
    const sortBy = searchParams.get("sortBy");
    const sortDir = searchParams.get("sortDir") || "asc";

    if (!tableName) {
      return NextResponse.json({ error: "Table name is required" }, { status: 400 });
    }

    // Validate table name to prevent SQL injection
    const validTables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `;
    const isValidTable = validTables.some((t) => t.name === tableName);

    if (!isValidTable) {
      return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
    }

    // Get column information
    const columns: Array<{ name: string }> = await prisma.$queryRawUnsafe(
      `PRAGMA table_info("${tableName}")`
    );
    const columnNames = columns.map((col) => col.name);

    // Validate sort column if provided
    if (sortBy) {
      const isValidColumn = columnNames.includes(sortBy);
      if (!isValidColumn) {
        return NextResponse.json({ error: "Invalid sort column" }, { status: 400 });
      }
    }

    // Get total count
    const countResult: Array<{ count: number }> = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    const totalCount = countResult[0]?.count || 0;

    // Build query with optional sorting
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM "${tableName}"`;

    if (sortBy) {
      // Use double quotes for column names to handle special characters
      query += ` ORDER BY "${sortBy}" ${sortDir.toUpperCase()}`;
    }

    query += ` LIMIT ${limit} OFFSET ${offset}`;

    // Execute query
    const data = await prisma.$queryRawUnsafe(query);

    return NextResponse.json({
      data,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      columns: columnNames,
    });
  } catch (error) {
    console.error("Error fetching table data:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
