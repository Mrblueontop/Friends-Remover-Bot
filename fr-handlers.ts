// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Interaction Handlers
// Handles /verify, /switch account, /history view, /pin view,
// /notifications toggle, and all FR button interactions.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Client,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import {
  type FRVerifySession,
  type FRVerifiedAccount,
  type FRNotificationPrefs,
  getFRVerifySession,
  setFRVerifySession,
  clearFRVerifySession,
  getFRDiscordUser,
  setFRDiscordUser,
  getOrCreateFRDiscordUser,
  getActiveAccount,
} from "./fr-data.js";
import {
  type FRHistoryEntry,
  type FRPinEntry,
  type FRRobloxUser,
  fetchFRRobloxUser,
  sendFRVerifyUsernamePrompt,
  sendFRVerifyBioPrompt,
  sendFRVerifySuccess,
  sendFRVerifyFailed,
  sendFRAccountSelectPrompt,
  buildFRUserEmbed,
  buildFRNavRow,
  buildNotifSettingsEmbed,
  buildNotifSettingsRow,
} from "./fr-flows.js";
import { getUserByUsername, getUserBio, generateCode } from "./roblox.js";

// ── Cloudflare Worker API helper ──────────────────────────────────────────────

const FR_API_BASE = process.env.FR_API_BASE ?? "https://your-worker.your-subdomain.workers.dev";
const FR_SHARED_SECRET = process.env.FR_SHARED_SECRET ?? "";

async function signRequest(robloxUserId: string): Promise<{
  "X-User-Id": string;
  "X-Timestamp": string;
  "X-Signature": string;
}> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message   = new TextEncoder().encode(`${robloxUserId}:${timestamp}`);
  const keyMat    = new TextEncoder().encode(FR_SHARED_SECRET);
  const key       = await crypto.subtle.importKey("raw", keyMat, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf    = await crypto.subtle.sign("HMAC", key, message);
  const hex       = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { "X-User-Id": robloxUserId, "X-Timestamp": timestamp, "X-Signature": hex };
}

async function frGet(path: string, robloxUserId: string): Promise<unknown> {
  const headers = { ...(await signRequest(robloxUserId)), Accept: "application/json" };
  const res = await fetch(`${FR_API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`FR API ${path} → ${res.status}`);
  return res.json();
}

// ── Ephemeral error reply ─────────────────────────────────────────────────────

async function replyError(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  text: string,
): Promise<void> {
  const payload = {
    embeds: [new EmbedBuilder().setDescription(`❌ ${text}`).setColor(0xe74c3c)],
    ephemeral: true,
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

// ── requireVerified guard ─────────────────────────────────────────────────────

/**
 * Ensures the user is verified and has at least one linked account.
 * Returns the active account, or null (and sends an ephemeral error).
 */
async function requireVerified(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<FRVerifiedAccount | null> {
  const account = await getActiveAccount(interaction.user.id);
  if (!account) {
    await replyError(
      interaction,
      "You don't have a linked Roblox account yet. Use `/verify` to link one.",
    );
    return null;
  }
  return account;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLASH COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// ── /verify ───────────────────────────────────────────────────────────────────

export async function handleFRVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordUser = await getFRDiscordUser(interaction.user.id);
  if (discordUser && discordUser.accounts.length >= 5) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(
            "You already have **5 linked accounts** (the maximum).\nUse `/switch account` to manage them.",
          )
          .setColor(0xe74c3c),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription("📬 Check your DMs! I've sent you a verification prompt.")
        .setColor(0x9b59b6),
    ],
    ephemeral: true,
  });

  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    await interaction.followUp({
      embeds: [
        new EmbedBuilder()
          .setDescription("❌ I couldn't send you a DM. Please enable DMs from server members and try again.")
          .setColor(0xe74c3c),
      ],
      ephemeral: true,
    });
    return;
  }

  const session: FRVerifySession = {
    discordId:    interaction.user.id,
    step:         "awaiting_username",
    startedAt:    Date.now(),
    verifyingForIndex: discordUser?.accounts.length ?? 0,
  };
  setFRVerifySession(session);

  await sendFRVerifyUsernamePrompt(dm);
}

// ── /switch account ───────────────────────────────────────────────────────────

export async function handleFRSwitchAccount(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const discordUser = await getFRDiscordUser(interaction.user.id);
  if (!discordUser || discordUser.accounts.length === 0) {
    await replyError(interaction, "You have no linked accounts. Use `/verify` to add one.");
    return;
  }

  const slotOpt = interaction.options.getInteger("slot");

  if (slotOpt !== null) {
    const idx = slotOpt - 1;
    if (idx < 0 || idx >= discordUser.accounts.length) {
      await replyError(
        interaction,
        `Invalid slot. You have ${discordUser.accounts.length} account(s) in slots 1–${discordUser.accounts.length}.`,
      );
      return;
    }
    discordUser.activeAccountIndex = idx;
    setFRDiscordUser(discordUser);
    const acc = discordUser.accounts[idx]!;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`✅ Switched to **\`${acc.robloxUsername}\`**.`)
          .setColor(0x2ecc71),
      ],
      ephemeral: true,
    });
    return;
  }

  // No slot given — show a picker via DM if multiple accounts exist
  if (discordUser.accounts.length === 1) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`You only have one linked account: **\`${discordUser.accounts[0]!.robloxUsername}\`**.`)
          .setColor(0x9b59b6),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription("📬 Check your DMs to pick an account.")
        .setColor(0x9b59b6),
    ],
    ephemeral: true,
  });

  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) return;
  await sendFRAccountSelectPrompt(dm, discordUser.accounts, "your active account");
}

// ── /history view ─────────────────────────────────────────────────────────────

export async function handleFRHistoryView(interaction: ChatInputCommandInteraction): Promise<void> {
  const account = await requireVerified(interaction);
  if (!account) return;

  await interaction.deferReply({ ephemeral: true });

  let rawHistory: FRHistoryEntry[] = [];
  try {
    const data = (await frGet("/history", account.robloxUserId)) as FRHistoryEntry[] | string;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (!Array.isArray(parsed)) { rawHistory = []; } else {
      // Normalize: extension stores removed person's id in `id` and name in `name`.
      // FRHistoryEntry expects `userId` and `username`.
      rawHistory = parsed.map((e: Record<string, unknown>) => ({
        userId:      String(e.id      ?? e.userId ?? ""),
        username:    String(e.name    ?? e.username ?? "Unknown"),
        displayName: String(e.displayName ?? e.name ?? e.username ?? ""),
        timestamp:   typeof e.timestamp === "number" ? e.timestamp : undefined,
        removedBy:   typeof e.unfriendedBy === "string" ? e.unfriendedBy : undefined,
      }));
    }
  } catch {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setDescription("❌ Failed to fetch your history. Try again later.").setColor(0xe74c3c)],
    });
    return;
  }

  if (rawHistory.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setDescription("📭 Your unfriend history is empty.").setColor(0x95a5a6)],
    });
    return;
  }

  // Sort newest first
  rawHistory.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const startPage = Math.max(0, (interaction.options.getInteger("page") ?? 1) - 1);
  const index     = Math.min(startPage, rawHistory.length - 1);
  const entry     = rawHistory[index]!;

  const robloxUser = await fetchFRRobloxUser(entry.userId);
  const embed      = buildFRUserEmbed(robloxUser, entry, index, rawHistory.length, "history");
  const navRow     = buildFRNavRow(index, rawHistory.length, entry.userId, "history");

  // Store serialised history in the nav button custom IDs would exceed 100 chars,
  // so we cache it per-user in memory during the session (see button handler).
  historyPageCache.set(interaction.user.id, rawHistory);
  setTimeout(() => historyPageCache.delete(interaction.user.id), 10 * 60 * 1000);

  await interaction.editReply({ embeds: [embed], components: [navRow] });
}

// ── /pin view ─────────────────────────────────────────────────────────────────

export async function handleFRPinView(interaction: ChatInputCommandInteraction): Promise<void> {
  const account = await requireVerified(interaction);
  if (!account) return;

  await interaction.deferReply({ ephemeral: true });

  let rawPins: FRPinEntry[] = [];
  try {
    const data = (await frGet("/pins", account.robloxUserId)) as unknown;
    const parsed = typeof data === "string" ? JSON.parse(data as string) : data;
    if (!Array.isArray(parsed)) {
      rawPins = [];
    } else {
      // Pins are stored as a plain array of Roblox user IDs (numbers or strings).
      rawPins = (parsed as unknown[]).map((item) => {
        if (typeof item === "number" || typeof item === "string") {
          return { userId: String(item) } as FRPinEntry;
        }
        const e = item as Record<string, unknown>;
        return {
          userId:      String(e.userId ?? e.id ?? ""),
          username:    typeof e.username === "string" ? e.username : undefined,
          displayName: typeof e.displayName === "string" ? e.displayName : undefined,
        } as FRPinEntry;
      }).filter((e) => e.userId && e.userId !== "undefined");
    }
  } catch {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setDescription("❌ Failed to fetch your pins. Try again later.").setColor(0xe74c3c)],
    });
    return;
  }

  if (rawPins.length === 0) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setDescription("📭 You have no pinned friends.").setColor(0x95a5a6)],
    });
    return;
  }

  const startPage = Math.max(0, (interaction.options.getInteger("page") ?? 1) - 1);
  const index     = Math.min(startPage, rawPins.length - 1);
  const entry     = rawPins[index]!;

  const robloxUser = await fetchFRRobloxUser(entry.userId);
  const embed      = buildFRUserEmbed(robloxUser, entry as FRHistoryEntry, index, rawPins.length, "pin");
  const navRow     = buildFRNavRow(index, rawPins.length, entry.userId, "pin");

  pinPageCache.set(interaction.user.id, rawPins);
  setTimeout(() => pinPageCache.delete(interaction.user.id), 10 * 60 * 1000);

  await interaction.editReply({ embeds: [embed], components: [navRow] });
}

// ── /notifications toggle ─────────────────────────────────────────────────────

export async function handleFRNotificationsToggle(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const discordUser = await getOrCreateFRDiscordUser(
    interaction.user.id,
    interaction.user.username,
  );

  const embed = buildNotifSettingsEmbed(discordUser.notificationPrefs);
  const row   = buildNotifSettingsRow(discordUser.notificationPrefs);

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON INTERACTION HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// In-memory page caches (10-minute TTL set on write)
const historyPageCache = new Map<string, FRHistoryEntry[]>();
const pinPageCache     = new Map<string, FRPinEntry[]>();

/** Route all `fr:*` button interactions */
export async function handleFRButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId; // e.g. "fr:history_back:3"

  // ── Verify flow buttons ────────────────────────────────────────────────────

  if (id === "fr:verify_check") {
    await handleFRVerifyCheck(interaction);
    return;
  }

  if (id === "fr:verify_cancel") {
    clearFRVerifySession(interaction.user.id);
    await interaction.update({
      embeds: [new EmbedBuilder().setDescription("❌ Verification cancelled.").setColor(0xe74c3c)],
      components: [],
    });
    return;
  }

  // ── Account switch buttons ─────────────────────────────────────────────────

  if (id.startsWith("fr:switch_account:")) {
    const idx = parseInt(id.split(":")[2] ?? "0", 10);
    const discordUser = await getFRDiscordUser(interaction.user.id);
    if (!discordUser || idx >= discordUser.accounts.length) {
      await interaction.update({
        embeds: [new EmbedBuilder().setDescription("❌ Account not found.").setColor(0xe74c3c)],
        components: [],
      });
      return;
    }
    discordUser.activeAccountIndex = idx;
    setFRDiscordUser(discordUser);
    const acc = discordUser.accounts[idx]!;
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setDescription(`✅ Switched to **\`${acc.robloxUsername}\`**.`)
          .setColor(0x2ecc71),
      ],
      components: [],
    });
    return;
  }

  // ── History navigation ─────────────────────────────────────────────────────

  if (id.startsWith("fr:history_back:") || id.startsWith("fr:history_forward:")) {
    await handleFRPageNav(interaction, "history");
    return;
  }

  // ── Pin navigation ─────────────────────────────────────────────────────────

  if (id.startsWith("fr:pin_back:") || id.startsWith("fr:pin_forward:")) {
    await handleFRPageNav(interaction, "pin");
    return;
  }

  // ── Notification toggle buttons ────────────────────────────────────────────

  if (id.startsWith("fr:notif_toggle:")) {
    await handleFRNotifToggle(interaction);
    return;
  }
}

// ── Bio verify check ──────────────────────────────────────────────────────────

async function handleFRVerifyCheck(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  const session = getFRVerifySession(interaction.user.id);

  if (!session || session.step !== "awaiting_bio_verify") {
    await interaction.followUp({
      embeds: [new EmbedBuilder().setDescription("❌ No active verification session found.").setColor(0xe74c3c)],
      ephemeral: true,
    });
    return;
  }

  const bio = await getUserBio(parseInt(session.robloxUserId!, 10));
  if (!bio.includes(session.verificationCode!)) {
    const dm = await interaction.user.createDM().catch(() => null);
    if (dm) {
      await sendFRVerifyFailed(
        dm,
        `The code \`${session.verificationCode}\` was not found in your Roblox bio.\n\nMake sure you saved it exactly as shown, then click **Verify** again.`,
      );
    }
    return;
  }

  // ── Bio confirmed — link the account ────────────────────────────────────────

  const discordUser = await getOrCreateFRDiscordUser(interaction.user.id, interaction.user.username);
  const alreadyLinked = discordUser.accounts.some(
    (a) => a.robloxUserId === session.robloxUserId,
  );

  if (!alreadyLinked) {
    const newAccount: FRVerifiedAccount = {
      robloxUserId:      session.robloxUserId!,
      robloxUsername:    session.robloxUsername!,
      robloxDisplayName: session.robloxDisplayName ?? session.robloxUsername!,
      linkedAt:          Date.now(),
    };
    discordUser.accounts.push(newAccount);
    discordUser.activeAccountIndex = discordUser.accounts.length - 1;
    setFRDiscordUser(discordUser);
  }

  clearFRVerifySession(interaction.user.id);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setDescription("✅ Verification complete! Check your DMs.")
        .setColor(0x2ecc71),
    ],
    components: [],
  });

  const dm = await interaction.user.createDM().catch(() => null);
  if (dm) {
    await sendFRVerifySuccess(dm, discordUser.accounts.at(-1)!);
  }
}

// ── Paginated history / pin nav ───────────────────────────────────────────────

async function handleFRPageNav(
  interaction: ButtonInteraction,
  mode: "history" | "pin",
): Promise<void> {
  await interaction.deferUpdate();

  const parts    = interaction.customId.split(":");
  const direction = parts[1]!.includes("back") ? "back" : "forward";
  const currentIndex = parseInt(parts[2] ?? "0", 10);
  const newIndex     = direction === "back" ? currentIndex - 1 : currentIndex + 1;

  const cache = mode === "history"
    ? historyPageCache.get(interaction.user.id)
    : pinPageCache.get(interaction.user.id);

  if (!cache || newIndex < 0 || newIndex >= cache.length) {
    await interaction.followUp({
      embeds: [new EmbedBuilder().setDescription("❌ Page not available. Run the command again.").setColor(0xe74c3c)],
      ephemeral: true,
    });
    return;
  }

  const entry      = cache[newIndex]!;
  const robloxUser = await fetchFRRobloxUser(entry.userId);
  const embed      = buildFRUserEmbed(robloxUser, entry as FRHistoryEntry, newIndex, cache.length, mode);
  const navRow     = buildFRNavRow(newIndex, cache.length, entry.userId, mode);

  await interaction.editReply({ embeds: [embed], components: [navRow] });
}

// ── Notification toggle ───────────────────────────────────────────────────────

const NOTIF_PREF_KEYS = ["friendRemoved", "friendPinned", "scheduledRemovals", "systemEvents"] as const;
type NotifPrefKey = typeof NOTIF_PREF_KEYS[number];

async function handleFRNotifToggle(interaction: ButtonInteraction): Promise<void> {
  const key    = interaction.customId.split(":")[2] as NotifPrefKey | undefined;
  const discordUser = await getFRDiscordUser(interaction.user.id);

  if (!key || !discordUser || !(key in discordUser.notificationPrefs)) {
    await interaction.deferUpdate();
    return;
  }

  (discordUser.notificationPrefs as unknown as Record<string, boolean>)[key] =
    !(discordUser.notificationPrefs as unknown as Record<string, boolean>)[key];
  setFRDiscordUser(discordUser);

  const embed = buildNotifSettingsEmbed(discordUser.notificationPrefs);
  const row   = buildNotifSettingsRow(discordUser.notificationPrefs);
  await interaction.update({ embeds: [embed], components: [row] });
}

// ─────────────────────────────────────────────────────────────────────────────
// DM MESSAGE HANDLER — handles username input during /verify flow
// Call this from your existing DM message handler (handleMessage equivalent).
// ─────────────────────────────────────────────────────────────────────────────

export async function handleFRDMMessage(
  content: string,
  discordId: string,
  client: Client,
): Promise<boolean> {
  const session = getFRVerifySession(discordId);
  if (!session) return false;

  if (session.step !== "awaiting_username") return false;

  const user = await client.users.fetch(discordId).catch(() => null);
  if (!user) return true;
  const dm = await user.createDM().catch(() => null);
  if (!dm) return true;

  const robloxUser = await getUserByUsername(content.trim());
  if (!robloxUser) {
    await sendFRVerifyFailed(
      dm,
      `No Roblox account found with the username **\`${content.trim()}\`**. Please double-check and try again.`,
    );
    await sendFRVerifyUsernamePrompt(dm);
    return true;
  }

  // Check not already linked by this Discord user
  const existing = await getFRDiscordUser(discordId);
  if (existing?.accounts.some((a) => a.robloxUserId === String(robloxUser.id))) {
    await sendFRVerifyFailed(
      dm,
      `**\`${robloxUser.name}\`** is already linked to your account.`,
    );
    await sendFRVerifyUsernamePrompt(dm);
    return true;
  }

  const code = generateCode();
  session.step              = "awaiting_bio_verify";
  session.robloxUserId      = String(robloxUser.id);
  session.robloxUsername    = robloxUser.name;
  session.robloxDisplayName = robloxUser.displayName;
  session.verificationCode  = code;
  setFRVerifySession(session);

  await sendFRVerifyBioPrompt(dm, code, robloxUser.name);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL ROUTER
// Wire these into your existing handleCommand / handleButton functions.
// ─────────────────────────────────────────────────────────────────────────────

/** Call from your ChatInputCommandInteraction handler */
export async function routeFRCommand(
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const { commandName } = interaction;
  const sub = interaction.options.getSubcommand(false);

  if (commandName === "verify") {
    await handleFRVerify(interaction);
    return true;
  }
  if (commandName === "switch" && sub === "account") {
    await handleFRSwitchAccount(interaction);
    return true;
  }
  if (commandName === "history" && sub === "view") {
    await handleFRHistoryView(interaction);
    return true;
  }
  if (commandName === "pin" && sub === "view") {
    await handleFRPinView(interaction);
    return true;
  }
  if (commandName === "notifications" && sub === "toggle") {
    await handleFRNotificationsToggle(interaction);
    return true;
  }

  return false;
}

/** Call from your ButtonInteraction handler */
export async function routeFRButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("fr:")) return false;
  await handleFRButton(interaction);
  return true;
}
