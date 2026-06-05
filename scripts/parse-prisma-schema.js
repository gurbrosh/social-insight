/**
 * Parse Prisma schema to extract model and field definitions
 * Used for comprehensive schema validation
 */

import fs from "fs";

/**
 * Map Prisma field types to SQLite column types
 */
function mapPrismaTypeToSQLite(prismaType, isOptional) {
  const type = prismaType.trim();

  // Handle arrays and relations (these are not columns in SQLite)
  if (type.includes("[]") || type.includes("@relation")) {
    return null; // Not a database column
  }

  // Handle Json type
  if (type === "Json" || type === "Json?") {
    return "TEXT"; // SQLite stores JSON as TEXT
  }

  // Handle DateTime
  if (type === "DateTime" || type === "DateTime?") {
    return "DATETIME";
  }

  // Handle Int
  if (type === "Int" || type === "Int?") {
    return "INTEGER";
  }

  // Handle Float/Decimal
  if (type === "Float" || type === "Decimal" || type === "Float?" || type === "Decimal?") {
    return "REAL";
  }

  // Handle Boolean
  if (type === "Boolean" || type === "Boolean?") {
    return "BOOLEAN";
  }

  // Handle BigInt
  if (type === "BigInt" || type === "BigInt?") {
    return "INTEGER"; // SQLite stores BigInt as INTEGER
  }

  // Handle Bytes
  if (type === "Bytes" || type === "Bytes?") {
    return "BLOB";
  }

  // Default to TEXT for String and unknown types
  return "TEXT";
}

/**
 * Extract field definition from a line
 */
function parseField(line) {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) {
    return null;
  }

  // Field format: fieldName Type? @attributes
  // Example: "monitoring_focus String? // comment"
  const fieldMatch = trimmed.match(/^(\w+)\s+([^\s]+(?:\s+[^\s]+)*?)(?:\s*\/\/|$)/);
  if (!fieldMatch) {
    return null;
  }

  const fieldName = fieldMatch[1];
  const fullType = fieldMatch[2].trim();

  // Remove relation syntax and attributes
  const typeMatch = fullType.match(/^([^\s@]+)/);
  if (!typeMatch) {
    return null;
  }

  const prismaType = typeMatch[1];
  const isOptional = fullType.includes("?");

  // Skip if it's a relation (contains @relation) or if it's a relation field (references another model)
  // Relation fields don't have a corresponding column - they use foreign keys instead
  if (
    trimmed.includes("@relation") ||
    trimmed.includes("fields:") ||
    trimmed.includes("references:")
  ) {
    return null;
  }

  // Skip relation fields that reference other models (non-primitive types)
  // We only want fields that map to actual database columns
  const primitiveTypes = [
    "String",
    "Int",
    "Float",
    "Boolean",
    "DateTime",
    "Json",
    "BigInt",
    "Bytes",
    "Decimal",
  ];
  const isPrimitive = primitiveTypes.some((t) => prismaType === t || prismaType === `${t}?`);
  if (!isPrimitive) {
    // Check if it's a custom enum or model reference - skip those
    // Enums in Prisma are typically PascalCase and referenced directly
    // Models are also PascalCase and used in relations
    // We'll be conservative and only include known primitives
    return null;
  }

  const sqliteType = mapPrismaTypeToSQLite(prismaType, isOptional);
  if (!sqliteType) {
    return null; // Not a database column
  }

  return {
    name: fieldName,
    prismaType,
    sqliteType,
    isOptional,
  };
}

/**
 * Parse Prisma schema file and extract all models with their fields
 */
export function parsePrismaSchema(schemaPath) {
  const content = fs.readFileSync(schemaPath, "utf8");
  const lines = content.split("\n");

  const models = {};
  let currentModel = null;
  let inModel = false;
  let braceCount = 0;
  let modelStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect model start: "model ModelName {"
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      inModel = true;
      braceCount = 1;
      modelStartLine = i;
      models[currentModel] = {
        name: currentModel,
        fields: [],
      };
      continue;
    }

    // Track braces to know when model ends
    if (inModel && currentModel) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      braceCount += openBraces - closeBraces;

      // Parse field if we're inside a model
      if (braceCount > 0) {
        const field = parseField(line);
        if (field) {
          models[currentModel].fields.push(field);
        }
      }

      // Model ended
      if (braceCount === 0) {
        inModel = false;
        currentModel = null;
      }
    }
  }

  return models;
}
