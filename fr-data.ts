// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Discord Integration: Types & KV Data Layer
// All user/notification data is persisted to Cloudflare Worker KV via the
// existing FR API. Verify sessions remain in-memory (ephemeral by design).
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface FRVerifiedAccount {
  robloxUserId: string;
  robloxUsername: string;
  robloxDisplayName: string;
  linkedAt: number; // Unix ms
}

/** Up to 5 verified Roblox accounts per Discord user */
export interface FRDiscordUser {
  discordId: string;
  accounts: FRVerifiedAccount[];
  activeAccountIndex: number;
  discordUsername: string;
  notificationPrefs: FRNotificationPrefs;
  createdAt: number;
  updatedAt: number;
}

export interface FRNotificationPrefs {
  friendRemoved: boolean;
  friendPinned: boolean;
  scheduledRemovals: boolean;
  systemEvents: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: FRNotificationPrefs = {
  friendRemoved: true,
  friendPinned: true,
  scheduledRemovals: true,
  systemEvents: false,
};

export type NotificationStatus = "sent" | "received";
export type NotificationEventType =
  | "friend_removed"
  | "friend_pinned"
  | "friend_unpinned"
  | "scheduled_removal_ran"
  | "scheduled_removal_failed"
  | "system";

export interface FRNotification {
  id: string;
  discordId: string;
  robloxUserId: string;
  eventType: NotificationEventType;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  createdAt: number;
  expiresAt: number;
}

/** Ephemeral session for the /verify flow — in-memory only (short-lived) */
export interface FRVerifySession {
  discordId: string;
  step: "awaiting_username" | "awaiting_bio_verify" | "done";
  robloxUserId?: string;
  robloxUsername?: string;
  robloxDisplayName?: string;
  verificationCode?: string;
  verifyingForIndex?: number;
  startedAt: number;
}

// ── Worker API config ─────────────────────────────────────────────────────────

const FR_API_BASE     = process.env.FR_API_BASE     ?? "";
const FR_SHARED_SECRET = process.env.FR_SHARED_SECRET ?? "";

// Signing uses a DISCORD_BOT_ID as the userId for discord-user routes,
// since those routes aren't tied to a Roblox user ID.
// We use a fixed sentinel ID so the Worker can verify the signature.
const BOT_SIGNING_ID = process.env.BOT_SIGNING_ID ?? "0";

async function signHeaders(userId: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = new TextEncoder().encode(`${userId}:${timestamp}`);
  const keyMat    = new TextEncoder().encode(FR_SHARED_SECRET);
  const key       = await crypto.subtle.importKey(
    "raw", keyMat, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, message);
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    "Content-Type": "application/json",
    "X-User-Id":    userId,
    "X-Timestamp":  timestamp,
    "X-Signature":  sigHex,
  };
}

async function kvGet<T>(path: string, userId: string): Promise<T | null> {
  try {
    const headers = await signHeaders(userId);
    const res = await fetch(`${FR_API_BASE}${path}`, { headers });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim() === "" || text === "null") return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function kvPut(path: string, userId: string, body: unknown): Promise<boolean> {
  try {
    const headers = await signHeaders(userId);
    const res = await fetch(`${FR_API_BASE}${path}`, {
      method:  "PUT",
      headers,
      body:    JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── In-memory verify session store (ephemeral — OK to lose on restart) ────────

const verifySessionStore = new Map<string, FRVerifySession>();

export function getFRVerifySession(discordId: string): FRVerifySession | null {
  return verifySessionStore.get(discordId) ?? null;
}

export function setFRVerifySession(session: FRVerifySession): void {
  verifySessionStore.set(session.discordId, session);
}

export function clearFRVerifySession(discordId: string): void {
  verifySessionStore.delete(discordId);
}

// ── Discord Users — persisted to Worker KV via /discord-user route ────────────
// KV key: discord:{discordId}  stored in FR_SETTINGS_KV under a prefixed key

export async function getFRDiscordUser(discordId: string): Promise<FRDiscordUser | null> {
  return kvGet<FRDiscordUser>(`/discord-user?userId=${discordId}`, discordId);
}

export async function setFRDiscordUser(user: FRDiscordUser): Promise<void> {
  user.updatedAt = Date.now();
  await kvPut(`/discord-user?userId=${user.discordId}`, user.discordId, user);
}

export async function getOrCreateFRDiscordUser(
  discordId: string,
  discordUsername: string,
): Promise<FRDiscordUser> {
  const existing = await getFRDiscordUser(discordId);
  if (existing) {
    // Keep username in sync
    if (existing.discordUsername !== discordUsername) {
      existing.discordUsername = discordUsername;
      await setFRDiscordUser(existing);
    }
    return existing;
  }
  const now = Date.now();
  const user: FRDiscordUser = {
    discordId,
    accounts:           [],
    activeAccountIndex: 0,
    discordUsername,
    notificationPrefs:  { ...DEFAULT_NOTIFICATION_PREFS },
    createdAt:          now,
    updatedAt:          now,
  };
  await setFRDiscordUser(user);
  return user;
}

export async function getActiveAccount(discordId: string): Promise<FRVerifiedAccount | null> {
  const user = await getFRDiscordUser(discordId);
  if (!user || user.accounts.length === 0) return null;
  return user.accounts[user.activeAccountIndex] ?? user.accounts[0] ?? null;
}

/** Find which Discord user is linked to a given Roblox user ID */
export async function findDiscordUserByRobloxId(robloxUserId: string): Promise<FRDiscordUser | null> {
  return kvGet<FRDiscordUser>(`/discord-user/by-roblox?robloxUserId=${robloxUserId}`, robloxUserId);
}

// ── Notifications — persisted to Worker KV via /notifications route ───────────

let notifIdCounter = 0;

export async function createNotification(
  discordId: string,
  robloxUserId: string,
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): Promise<FRNotification> {
  const id  = `notif_${Date.now()}_${++notifIdCounter}`;
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const notif: FRNotification = {
    id, discordId, robloxUserId, eventType, payload,
    status:    "sent",
    createdAt: now,
    expiresAt: now + THIRTY_DAYS_MS,
  };

  // Load existing notifications, append, save back
  const existing = await kvGet<FRNotification[]>(`/notifications?userId=${robloxUserId}`, robloxUserId) ?? [];
  existing.push(notif);
  // Keep only last 200 notifications per user, and only non-expired
  const pruned = existing
    .filter((n) => n.expiresAt > now)
    .slice(-200);
  await kvPut(`/notifications?userId=${robloxUserId}`, robloxUserId, pruned);

  return notif;
}

export async function markNotificationReceived(
  robloxUserId: string,
  notifId: string,
): Promise<void> {
  const notifications = await kvGet<FRNotification[]>(`/notifications?userId=${robloxUserId}`, robloxUserId) ?? [];
  const idx = notifications.findIndex((n) => n.id === notifId);
  if (idx !== -1) {
    notifications[idx]!.status = "received";
    await kvPut(`/notifications?userId=${robloxUserId}`, robloxUserId, notifications);
  }
}

export async function getNotificationsForUser(robloxUserId: string): Promise<FRNotification[]> {
  const now  = Date.now();
  const all  = await kvGet<FRNotification[]>(`/notifications?userId=${robloxUserId}`, robloxUserId) ?? [];
  return all.filter((n) => n.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt);
}

export async function purgeExpiredNotifications(): Promise<void> {
  // Purging happens lazily on read; this is a no-op kept for API compatibility.
  // Full purge would require listing all KV keys — not practical from the bot.
  console.log("[FR] purgeExpiredNotifications: pruning handled lazily on write.");
}
