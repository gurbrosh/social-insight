import dns from "node:dns/promises";
import net from "node:net";

/** Block private, loopback, link-local, and metadata IPs (SSRF mitigation). */
function isUnsafeIpv4(ip: string): boolean {
  const parts = ip.split(".").map((x) => parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isUnsafeIpv6(ip: string): boolean {
  const n = ip.toLowerCase();
  if (n === "::1") return true;
  if (n.startsWith("fe80:")) return true;
  if (n.startsWith("fc") || n.startsWith("fd")) return true;
  if (n.startsWith("::ffff:")) {
    const v4 = n.slice(7);
    if (net.isIPv4(v4)) return isUnsafeIpv4(v4);
  }
  return false;
}

/**
 * Returns true if the URL host is safe to fetch (http/https only; no private/loopback IPs).
 */
export async function assertUrlSafeForFetch(
  rawUrl: string
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs are allowed" };
  }
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, reason: "Localhost is not allowed" };
  }
  if (net.isIPv4(host)) {
    return isUnsafeIpv4(host)
      ? { ok: false, reason: "Address is not reachable" }
      : { ok: true, url: u };
  }
  if (net.isIPv6(host)) {
    return isUnsafeIpv6(host)
      ? { ok: false, reason: "Address is not reachable" }
      : { ok: true, url: u };
  }

  try {
    const r4 = await dns.resolve4(host).catch(() => [] as string[]);
    const r6 = await dns.resolve6(host).catch(() => [] as string[]);
    if (r4.length === 0 && r6.length === 0) {
      return { ok: false, reason: "Could not resolve host" };
    }
    for (const ip of r4) {
      if (isUnsafeIpv4(ip)) {
        return { ok: false, reason: "Host resolves to a non-public address" };
      }
    }
    for (const ip of r6) {
      if (isUnsafeIpv6(ip)) {
        return { ok: false, reason: "Host resolves to a non-public address" };
      }
    }
  } catch {
    return { ok: false, reason: "Invalid host" };
  }

  return { ok: true, url: u };
}
