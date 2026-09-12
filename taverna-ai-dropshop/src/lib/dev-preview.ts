/**
 * Single source of truth for "are we in a Lovable preview / dev environment".
 *
 * Used to enable the DEV role switcher ("Жук") and demo fallback data.
 * NEVER true on the published production domain.
 */
export const isPreviewDevEnvironment = (): boolean => {
  try {
    if (import.meta.env.DEV) return true;
    const host = window.location.hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.includes("lovable")
    );
  } catch {
    return false;
  }
};

/** Stable demo profile id used across preview test roles. */
export const PREVIEW_PROFILE_ID = "38363307-c867-4dad-835d-e5bf0f301464";
