// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Discord Integration: Types & KV Data Layer
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
  /** Index into accounts[] of the currently active account */
  activeAccountIndex: number;
  /** Discord username (kept in sync) */
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

/** Ephemeral session for the /verify flow */
export interface FRVerifySession {
  discordId: string;
  step: "awaiting_username" | "awaiting_bio_verify" | "done";
  robloxUserId?: string;
  robloxUsername?: string;
  robloxDisplayName?: string;
  verificationCode?: string;
  verifyingForIndex?: number; // slot index being verified (0-4)
  startedAt: number;
}

// ── In-memory stores (single-process) ───────────────────────────────────────

const verifySessionStore = new Map<string, FRVerifySession>();
const discordUserStore   = new Map<string, FRDiscordUser>();
const notificationStore  = new Map<string, FRNotification>();

// ── Verify Sessions ──────────────────────────────────────────────────────────

export function getFRVerifySession(discordId: string): FRVerifySession | null {
  return verifySessionStore.get(discordId) ?? null;
}

export function setFRVerifySession(session: FRVerifySession): void {
  verifySessionStore.set(session.discordId, session);
}

export function clearFRVerifySession(discordId: string): void {
  verifySessionStore.delete(discordId);
}

// ── Discord Users ────────────────────────────────────────────────────────────

export function getFRDiscordUser(discordId: string): FRDiscordUser | null {
  return discordUserStore.get(discordId) ?? null;
}

export function setFRDiscordUser(user: FRDiscordUser): void {
  user.updatedAt = Date.now();
  discordUserStore.set(user.discordId, user);
}

export function getOrCreateFRDiscordUser(discordId: string, discordUsername: string): FRDiscordUser {
  const existing = discordUserStore.get(discordId);
  if (existing) return existing;
  const now = Date.now();
  const user: FRDiscordUser = {
    discordId,
    accounts: [],
    activeAccountIndex: 0,
    discordUsername,
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    createdAt: now,
    updatedAt: now,
  };
  discordUserStore.set(discordId, user);
  return user;
}

/** Returns the currently active Roblox account for a Discord user, or null */
export function getActiveAccount(discordId: string): FRVerifiedAccount | null {
  const user = discordUserStore.get(discordId);
  if (!user || user.accounts.length === 0) return null;
  return user.accounts[user.activeAccountIndex] ?? user.accounts[0] ?? null;
}

/** Find which Discord user is linked to a given Roblox user ID */
export function findDiscordUserByRobloxId(robloxUserId: string): FRDiscordUser | null {
  for (const user of discordUserStore.values()) {
    if (user.accounts.some((a) => a.robloxUserId === robloxUserId)) return user;
  }
  return null;
}

// ── Notifications ────────────────────────────────────────────────────────────

let notifIdCounter = 0;

export function createNotification(
  discordId: string,
  robloxUserId: string,
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): FRNotification {
  const id = `notif_${Date.now()}_${++notifIdCounter}`;
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const notif: FRNotification = {
    id,
    discordId,
    robloxUserId,
    eventType,
    payload,
    status: "sent",
    createdAt: now,
    expiresAt: now + THIRTY_DAYS_MS,
  };
  notificationStore.set(id, notif);
  return notif;
}

export function markNotificationReceived(id: string): void {
  const n = notificationStore.get(id);
  if (n) { n.status = "received"; notificationStore.set(id, n); }
}

export function getNotificationsForUser(discordId: string): FRNotification[] {
  const now = Date.now();
  const results: FRNotification[] = [];
  for (const n of notificationStore.values()) {
    if (n.discordId === discordId && n.expiresAt > now) results.push(n);
  }
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

/** Purge expired notifications — call periodically */
export function purgeExpiredNotifications(): void {
  const now = Date.now();
  for (const [id, n] of notificationStore.entries()) {
    if (n.expiresAt <= now) notificationStore.delete(id);
  }
}
