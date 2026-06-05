#!/usr/bin/env node

/**
 * Development server with automatic browser opening
 * Finds an available port and opens the correct URL
 */

import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";

// Get port from command line or environment
const requestedPort = process.argv[2] || process.env.PORT || "3000";

// Function to check if a port is available
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Function to find an available port
async function findAvailablePort(startPort) {
  let port = parseInt(startPort);
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    if (await checkPort(port)) {
      return port;
    }
    console.log(`⚠️  Port ${port} is in use, trying ${port + 1}...`);
    port++;
    attempts++;
  }

  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

// Main function
async function main() {
  const portToUse = await findAvailablePort(requestedPort);

  if (portToUse !== parseInt(requestedPort)) {
    console.log(`✅ Using port ${portToUse} instead`);
  }
  console.log(`🚀 Starting development server on port ${portToUse}...`);

  // Set up log file
  const logFile = path.join(process.cwd(), "dev.log");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });

  // Write startup message to log
  const timestamp = new Date().toISOString();
  logStream.write(`\n=== Server started at ${timestamp} ===\n`);

  // Start Next.js dev server
  const nextProcess = spawn("npx", ["next", "dev", "--turbopack", "-p", portToUse], {
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });

  let browserOpened = false;
  let actualPort = portToUse;

  // Function to open browser
  function openBrowser(port) {
    if (browserOpened) return;
    browserOpened = true;

    const url = `http://localhost:${port}`;
    console.log(`🌐 Opening browser at ${url}`);

    const platform = process.platform;
    let openCommand;

    if (platform === "darwin") {
      openCommand = "open";
    } else if (platform === "win32") {
      openCommand = "start";
    } else {
      openCommand = "xdg-open";
    }

    spawn(openCommand, [url], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  // Function to check line for port and ready state
  function checkLine(line) {
    // Check for the actual port Next.js is using
    const portMatch = line.match(/https?:\/\/localhost:(\d+)/);
    if (portMatch) {
      actualPort = portMatch[1];
    }

    // Check if server is ready
    if (line.includes("Ready in") || line.includes("compiled client and server successfully")) {
      setTimeout(() => openBrowser(actualPort), 1000);
    }
  }

  // Pipe stdout to process.stdout and log file, monitor for patterns
  nextProcess.stdout.on("data", (data) => {
    const dataStr = data.toString();
    // Write to stdout immediately for real-time logs
    process.stdout.write(dataStr);
    // Also write to log file
    logStream.write(dataStr);

    // Check each line for patterns
    const lines = dataStr.split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        checkLine(line);
      }
    });
  });

  // Pipe stderr to process.stderr and log file, monitor for patterns
  nextProcess.stderr.on("data", (data) => {
    const dataStr = data.toString();
    // Write to stderr immediately for real-time logs
    process.stderr.write(dataStr);
    // Also write to log file
    logStream.write(dataStr);

    // Check each line for patterns (Next.js sometimes outputs to stderr)
    const lines = dataStr.split("\n");
    lines.forEach((line) => {
      if (line.trim()) {
        checkLine(line);
      }
    });
  });

  // Handle process termination
  process.on("SIGINT", () => {
    logStream.write(`\n=== Server stopped at ${new Date().toISOString()} ===\n`);
    logStream.end();
    nextProcess.kill("SIGINT");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logStream.write(`\n=== Server stopped at ${new Date().toISOString()} ===\n`);
    logStream.end();
    nextProcess.kill("SIGTERM");
    process.exit(0);
  });

  nextProcess.on("error", (err) => {
    const errorMsg = `Failed to start Next.js: ${err.message}\n`;
    console.error(errorMsg);
    logStream.write(errorMsg);
    logStream.end();
    process.exit(1);
  });

  nextProcess.on("exit", (code) => {
    logStream.write(`\n=== Server exited with code ${code} at ${new Date().toISOString()} ===\n`);
    logStream.end();
    process.exit(code);
  });
}

// Run the main function
main().catch((err) => {
  console.error("Failed to start development server:", err);
  process.exit(1);
});
