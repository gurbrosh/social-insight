"use server";

import { spawn } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import path from "path";

// Status file path
const STATUS_FILE = path.join(process.cwd(), ".crunchycone-upload-status");

interface UploadStatus {
  status: "pending" | "running" | "completed" | "error";
  startedAt?: string;
  completedAt?: string;
  error?: string;
  pid?: number;
}

export async function triggerDatabaseUpload(): Promise<{ success: boolean; message: string }> {
  try {
    // Only run in local environments (not on CrunchyCone platform)
    if (process.env.CRUNCHYCONE_PLATFORM === "1") {
      return {
        success: false,
        message: "Database upload is not needed on CrunchyCone platform",
      };
    }

    // Check if already running
    const currentStatus = await getUploadStatus();
    if (currentStatus.status === "running") {
      return {
        success: false,
        message: "Database upload is already running",
      };
    }

    // Set status to running
    const status: UploadStatus = {
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await writeFile(STATUS_FILE, JSON.stringify(status, null, 2));

    // Spawn the CLI command in background
    const child = spawn("npx", ["--yes", "crunchycone-cli", "database", "upload"], {
      detached: true,
      stdio: "ignore", // Don't pipe stdio to parent
    });

    // Store PID for potential cleanup
    status.pid = child.pid;
    await writeFile(STATUS_FILE, JSON.stringify(status, null, 2));

    // Allow parent process to exit independently
    child.unref();

    // Handle process completion in background
    child.on("close", async (code) => {
      const finalStatus: UploadStatus = {
        status: code === 0 ? "completed" : "error",
        startedAt: status.startedAt,
        completedAt: new Date().toISOString(),
        error: code !== 0 ? `Process exited with code ${code}` : undefined,
      };

      try {
        await writeFile(STATUS_FILE, JSON.stringify(finalStatus, null, 2));
      } catch (error) {
        console.error("Failed to update status file:", error);
      }
    });

    child.on("error", async (error) => {
      const errorStatus: UploadStatus = {
        status: "error",
        startedAt: status.startedAt,
        completedAt: new Date().toISOString(),
        error: error.message,
      };

      try {
        await writeFile(STATUS_FILE, JSON.stringify(errorStatus, null, 2));
      } catch (writeError) {
        console.error("Failed to update status file:", writeError);
      }
    });

    return {
      success: true,
      message: "Database upload started in background",
    };
  } catch (error) {
    console.error("Error triggering database upload:", error);

    // Update status to error
    const errorStatus: UploadStatus = {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      completedAt: new Date().toISOString(),
    };

    try {
      await writeFile(STATUS_FILE, JSON.stringify(errorStatus, null, 2));
    } catch (writeError) {
      console.error("Failed to update status file:", writeError);
    }

    return {
      success: false,
      message: `Failed to start database upload: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

export async function getUploadStatus(): Promise<UploadStatus> {
  try {
    const statusData = await readFile(STATUS_FILE, "utf-8");
    return JSON.parse(statusData) as UploadStatus;
  } catch {
    // Default status if file doesn't exist
    return { status: "pending" };
  }
}

export async function clearUploadStatus(): Promise<void> {
  try {
    await unlink(STATUS_FILE);
  } catch {
    // File doesn't exist, that's fine
  }
}

export async function checkCrunchyConeCLIAvailable(): Promise<{
  available: boolean;
  message: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--yes", "crunchycone-cli", "--version"], {
      stdio: "pipe",
    });

    let output = "";

    child.stdout?.on("data", (data) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data) => {
      output += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          available: true,
          message: "CrunchyCone CLI is available",
        });
      } else {
        resolve({
          available: false,
          message: `CrunchyCone CLI is not available: ${output}`,
        });
      }
    });

    child.on("error", (error) => {
      resolve({
        available: false,
        message: `Failed to check CrunchyCone CLI: ${error.message}`,
      });
    });
  });
}
