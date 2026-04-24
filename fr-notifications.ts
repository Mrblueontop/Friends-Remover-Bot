// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Notification Dispatcher
// Sends DM notifications for friend-related events to linked Discord users.
// ─────────────────────────────────────────────────────────────────────────────

import { type Client, EmbedBuilder } from "discord.js";
import {
  type NotificationEventType,
  type FRNotificationPrefs,
  findDiscordUserByRobloxId,
  createNotification,
  markNotificationReceived,
} from "./fr-data.js";

// ── Embed builders per event type ─────────────────────────────────────────────

function buildFriendRemovedEmbed(payload: Record<string, unknown>): EmbedBuilder {
  const target   = payload.removedUsername as string | undefined;
  const targetId = payload.removedUserId   as string | undefined;
  const by       = payload.byUsername      as string | undefined;
  const ts       = payload.timestamp       as number | undefined;

  return new EmbedBuilder()
    .setTitle("👤 Friend Removed")
    .setDescription(
      [
        `A friend was removed from your list.`,
        "",
        target   ? `**Removed:** \`${target}\`` + (targetId ? ` (ID: ${targetId})` : "") : null,
        by       ? `**By account:** \`${by}\`` : null,
        ts       ? `**When:** <t:${Math.floor(ts / 1000)}:R>` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(0xe74c3c)
    .setTimestamp();
}

function buildFriendPinnedEmbed(payload: Record<string, unknown>): EmbedBuilder {
  const target   = payload.username as string | undefined;
  const targetId = payload.userId   as string | undefined;
  const action   = payload.action   as "pinned" | "unpinned" | undefined;
  const isPinned = action !== "unpinned";

  return new EmbedBuilder()
    .setTitle(isPinned ? "📌 Friend Pinned" : "📌 Friend Unpinned")
    .setDescription(
      [
        isPinned
          ? `A user was added to your pinned list.`
          : `A user was removed from your pinned list.`,
        "",
        target   ? `**User:** \`${target}\`` + (targetId ? ` (ID: ${targetId})` : "") : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setColor(isPinned ? 0x3498db : 0x95a5a6)
    .setTimestamp();
}

function buildScheduledRemovalEmbed(payload: Record<string, unknown>): EmbedBuilder {
  const success    = payload.success    as boolean | undefined;
  const count      = payload.count      as number  | undefined;
  const errorMsg   = payload.error      as string  | undefined;
  const scheduleName = payload.name     as string  | undefined;

  return new EmbedBuilder()
    .setTitle(success ? "✅ Scheduled Removal Ran" : "❌ Scheduled Removal Failed")
    .setDescription(
      [
        scheduleName ? `**Schedule:** ${scheduleName}` : null,
        success && count != null
          ? `**Removed:** ${count} friend${count !== 1 ? "s" : ""}`
          : null,
        !success && errorMsg
          ? `**Error:** ${errorMsg}`
          : null,
      ]
        .filter(Boolean)
        .join("\n") || "No details available."
    )
    .setColor(success ? 0x2ecc71 : 0xe74c3c)
    .setTimestamp();
}

function buildSystemEmbed(payload: Record<string, unknown>): EmbedBuilder {
  const message = payload.message as string | undefined;
  return new EmbedBuilder()
    .setTitle("🔔 System Notification")
    .setDescription(message ?? "A system event occurred.")
    .setColor(0x9b59b6)
    .setTimestamp();
}

function buildNotificationEmbed(
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): EmbedBuilder {
  switch (eventType) {
    case "friend_removed":
      return buildFriendRemovedEmbed(payload);
    case "friend_pinned":
    case "friend_unpinned":
      return buildFriendPinnedEmbed({ ...payload, action: eventType === "friend_pinned" ? "pinned" : "unpinned" });
    case "scheduled_removal_ran":
      return buildScheduledRemovalEmbed({ ...payload, success: true });
    case "scheduled_removal_failed":
      return buildScheduledRemovalEmbed({ ...payload, success: false });
    case "system":
    default:
      return buildSystemEmbed(payload);
  }
}

// ── Preference guard ──────────────────────────────────────────────────────────

function isEventEnabled(eventType: NotificationEventType, prefs: FRNotificationPrefs): boolean {
  switch (eventType) {
    case "friend_removed":
      return prefs.friendRemoved;
    case "friend_pinned":
    case "friend_unpinned":
      return prefs.friendPinned;
    case "scheduled_removal_ran":
    case "scheduled_removal_failed":
      return prefs.scheduledRemovals;
    case "system":
      return prefs.systemEvents;
    default:
      return false;
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Send a DM notification to the Discord user linked to a given Roblox account.
 * Safe to call from anywhere — silently skips if no Discord link, or if the
 * user has disabled the relevant notification type.
 */
export async function sendFRNotification(
  client: Client,
  robloxUserId: string,
  eventType: NotificationEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const discordUser = findDiscordUserByRobloxId(robloxUserId);
  if (!discordUser) return;

  if (!isEventEnabled(eventType, discordUser.notificationPrefs)) return;

  // Create a notification record (tracks status & handles 30-day expiry)
  const notif = createNotification(discordUser.discordId, robloxUserId, eventType, payload);

  try {
    const user = await client.users.fetch(discordUser.discordId).catch(() => null);
    if (!user) return;

    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;

    const embed = buildNotificationEmbed(eventType, payload);
    await dmChannel.send({ embeds: [embed] });

    markNotificationReceived(notif.id);
  } catch {
    // Delivery failed — notification remains in "sent" state
  }
}
