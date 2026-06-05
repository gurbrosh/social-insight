import jwt from "jsonwebtoken";

export type ReportExportKind = "themes" | "influencers" | "news" | "chatter";

const TOKEN_TYPE = "report_export";

export type ReportExportPayload = {
  typ: typeof TOKEN_TYPE;
  kind: ReportExportKind;
  projectId: string;
  userId: string;
  windowStartMs: number;
  rangeAmount: number;
  rangeUnit: string;
  themeId?: string;
};

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }
  return secret;
}

export function createReportExportToken(params: {
  kind: ReportExportKind;
  projectId: string;
  userId: string;
  windowStart: Date;
  rangeAmount: number;
  rangeUnit: string;
  themeId?: string;
}): string {
  if (params.kind === "themes" && !params.themeId) {
    throw new Error("themeId is required for themes export");
  }
  const payload: ReportExportPayload = {
    typ: TOKEN_TYPE,
    kind: params.kind,
    projectId: params.projectId,
    userId: params.userId,
    windowStartMs: params.windowStart.getTime(),
    rangeAmount: params.rangeAmount,
    rangeUnit: params.rangeUnit,
    themeId: params.themeId,
  };
  return jwt.sign(payload, getSecret(), { expiresIn: "14d", algorithm: "HS256" });
}

export function verifyReportExportToken(token: string): ReportExportPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret(), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload & ReportExportPayload;
    if (decoded.typ !== TOKEN_TYPE || !decoded.projectId || !decoded.userId || !decoded.kind) {
      return null;
    }
    if (decoded.kind === "themes" && !decoded.themeId) {
      return null;
    }
    return {
      typ: TOKEN_TYPE,
      kind: decoded.kind,
      projectId: decoded.projectId,
      userId: decoded.userId,
      windowStartMs: decoded.windowStartMs,
      rangeAmount: decoded.rangeAmount,
      rangeUnit: decoded.rangeUnit,
      themeId: decoded.themeId,
    };
  } catch {
    return null;
  }
}

/** Themes-only helper (same token shape as `createReportExportToken` with kind `themes`). */
export function createThemeExportToken(params: {
  projectId: string;
  themeId: string;
  userId: string;
  windowStart: Date;
  rangeAmount: number;
  rangeUnit: string;
}): string {
  return createReportExportToken({
    kind: "themes",
    projectId: params.projectId,
    themeId: params.themeId,
    userId: params.userId,
    windowStart: params.windowStart,
    rangeAmount: params.rangeAmount,
    rangeUnit: params.rangeUnit,
  });
}
