// Auth for the Qala sync server (PLAN.md sections 3 and 7).
//
// Identity comes only from the `Tailscale-User-Login` header injected by
// `tailscale serve`. Origin is never used for auth: the Capacitor app sends
// `Origin: https://localhost`, browsers send the tailnet hostname, and both
// are accepted when the identity header is present.

/** Header injected by `tailscale serve` carrying the tailnet login. */
export const IDENTITY_HEADER = "tailscale-user-login";

/** Origin sent by the Capacitor phone shell (bundled WebView). */
export const CAPACITOR_ORIGIN = "https://localhost";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/** Canonical user id for a tailnet login (stable from day one, section 3). */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Stable user id for a request, or null when the identity header is absent. */
export function userIdFromRequest(req: Request): string | null {
  const raw = req.headers.get(IDENTITY_HEADER);
  if (raw === null || raw.trim() === "") return null;
  return normalizeLogin(raw);
}

/** Throw a 401 when the request carries no Tailscale identity. */
export function requireUser(req: Request): string {
  const userId = userIdFromRequest(req);
  if (userId === null) throw new AuthError(401, "missing Tailscale identity");
  return userId;
}

/**
 * Throw a 403 unless `docId` is the document owned by `userId`.
 * `ownedDocId` is the document id recorded for the user (null when unknown).
 */
export function requireDocOwnership(
  userId: string,
  docId: string,
  ownedDocId: string | null,
): void {
  if (ownedDocId === null || docId !== ownedDocId) {
    throw new AuthError(403, `document not owned by user ${userId}`);
  }
}

/** True for loopback hosts: 127.0.0.0/8, ::1, localhost. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  const v4 = h.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 && v4.slice(1).every((octet) => Number(octet) <= 255)) return true;
  return false;
}

/**
 * Refuse to bind anything but loopback (same rule as Beamer's sync server).
 * Tailscale serves the port to the tailnet; the process itself never listens
 * on a LAN-reachable address.
 */
export function assertLoopbackBind(hostname: string): void {
  if (!isLoopbackHost(hostname)) {
    throw new Error(`refusing non-loopback bind: ${hostname}`);
  }
}

/**
 * WebSocket upgrade policy. Auth is the identity header only, never Origin:
 * `Origin: https://localhost` with a header is accepted, and a request
 * without the header is rejected whatever its Origin is.
 */
export function checkWsUpgrade(req: Request): { userId: string } {
  return { userId: requireUser(req) };
}

/** Convert an AuthError (or anything else) into an HTTP response. */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json({ error: "internal server error" }, { status: 500 });
}
