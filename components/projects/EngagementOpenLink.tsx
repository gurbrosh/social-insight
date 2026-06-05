"use client";

import type { MouseEventHandler, ReactNode } from "react";

/**
 * Opens the engagement tracking URL in a new tab; server redirects to the destination.
 * Identity selection / warning dialogs were removed — optional identityId can still be added server-side later if needed.
 */
interface EngagementOpenLinkProps {
  hrefBase: string;
  /** Retained for call sites; not required for opening the link. */
  platform: string;
  children: ReactNode;
  className?: string;
  /** e.g. sync read state when `/api/engagement/open` marks the row read server-side */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export function EngagementOpenLink({
  hrefBase,
  children,
  className,
  onClick,
}: EngagementOpenLinkProps) {
  return (
    <a
      href={hrefBase}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {children}
    </a>
  );
}
