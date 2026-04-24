// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Flows
// DM prompt builders, history/pin embed builders, notification settings UI.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type DMChannel,
  type Message,
} from "discord.js";
import type { FRVerifiedAccount, FRDiscordUser, FRNotificationPrefs } from "./fr-data.js";

// ── Roblox API helpers ────────────────────────────────────────────────────────

export interface FRRobloxUser {
  id: number;
  name: string;
  displayName: string;
  created: string;
  description: string;
  avatarUrl: string | null;
}

export async function fetchFRRobloxUser(robloxUserId: string): Promise<FRRobloxUser | null> {
  try {
    const [userRes, thumbRes] = await Promise.all([
      fetch(`https://users.roblox.com/v1/users/${robloxUserId}`),
      fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=420x420&format=Png&isCircular=false`
      ),
    ]);

    if (!userRes.ok) return null;
    const userData = (await userRes.json()) as {
      id: number;
      name: string;
      displayName: string;
      created: string;
      description?: string;
    };

    let avatarUrl: string | null = null;
    if (thumbRes.ok) {
      const thumbData = (await thumbRes.json()) as {
        data: { targetId: number; state: string; imageUrl: string }[];
      };
      avatarUrl = thumbData.data[0]?.imageUrl ?? null;
    }

    return {
      id:          userData.id,
      name:        userData.name,
      displayName: userData.displayName,
      created:     userData.created,
      description: userData.description ?? "",
      avatarUrl,
    };
  } catch {
    return null;
  }
}

// ── Verify flow prompts ───────────────────────────────────────────────────────

export async function sendFRVerifyUsernamePrompt(channel: DMChannel): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("🔐 Link Your Roblox Account")
    .setDescription(
      [
        "Please type your **Roblox username** to begin linking your account.",
        "",
        "You can link up to **5 accounts** to receive notifications for each.",
      ].join("\n")
    )
    .setColor(0x9b59b6)
    .setFooter({ text: "Just type your Roblox username in this DM" });

  await channel.send({ embeds: [embed] });
}

export async function sendFRVerifyBioPrompt(
  channel: DMChannel,
  code: string,
  robloxUsername: string,
): Promise<Message> {
  const embed = new EmbedBuilder()
    .setTitle("📋 Bio Verification")
    .setDescription(
      [
        `Add the code below to your **Roblox bio** on the account **\`${robloxUsername}\`**,`,
        "then click **Verify** once it's saved.",
        "",
        "```",
        code,
        "```",
        "",
        "⚠️ Do not change or remove the code before clicking Verify.",
        "Once confirmed, you can remove it from your bio.",
      ].join("\n")
    )
    .setColor(0x9b59b6);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("fr:verify_check")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId("fr:verify_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌"),
  );

  return await channel.send({ embeds: [embed], components: [row] });
}

export async function sendFRVerifySuccess(
  channel: DMChannel,
  account: FRVerifiedAccount,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("✅ Account Linked!")
    .setDescription(
      [
        `Successfully linked **\`${account.robloxUsername}\`** to your Discord account.`,
        "",
        `You'll now receive DM notifications for this account.`,
        "Use `/notifications toggle` to choose which events to be notified about.",
      ].join("\n")
    )
    .setColor(0x2ecc71);

  await channel.send({ embeds: [embed] });
}

export async function sendFRVerifyFailed(channel: DMChannel, reason: string): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("❌ Verification Failed")
    .setDescription(reason)
    .setColor(0xe74c3c);

  await channel.send({ embeds: [embed] });
}

/** Shown when multiple accounts are linked and user must pick one for a command */
export function buildAccountSelectRow(accounts: FRVerifiedAccount[]): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 0; i < Math.min(accounts.length, 5); i++) {
    const acc = accounts[i]!;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`fr:switch_account:${i}`)
        .setLabel(acc.robloxUsername.slice(0, 25))
        .setStyle(ButtonStyle.Primary)
        .setEmoji("👤"),
    );
  }
  return row;
}

export async function sendFRAccountSelectPrompt(
  channel: DMChannel,
  accounts: FRVerifiedAccount[],
  action: string,
): Promise<Message> {
  const embed = new EmbedBuilder()
    .setTitle("👤 Choose an Account")
    .setDescription(
      [
        `You have **${accounts.length} linked accounts**. Which one would you like to use for **${action}**?`,
        "",
        ...accounts.map((a, i) => `**${i + 1}.** \`${a.robloxUsername}\``),
      ].join("\n")
    )
    .setColor(0x9b59b6);

  return await channel.send({ embeds: [embed], components: [buildAccountSelectRow(accounts)] });
}

// ── History / Pin entry embed ─────────────────────────────────────────────────

export interface FRHistoryEntry {
  userId: string;
  username?: string;
  displayName?: string;
  timestamp?: number;
  removedBy?: string;
}

export interface FRPinEntry {
  userId: string;
  username?: string;
  displayName?: string;
}

/**
 * Builds the paginated embed shown for `/history view` and `/pin view`.
 * `mode` controls the title and accent colour.
 */
export function buildFRUserEmbed(
  robloxUser: FRRobloxUser | null,
  entry: FRHistoryEntry | FRPinEntry,
  index: number,
  total: number,
  mode: "history" | "pin",
): EmbedBuilder {
  const username    = robloxUser?.name        ?? entry.username    ?? "Unknown";
  const displayName = robloxUser?.displayName ?? entry.displayName ?? username;
  const bio         = robloxUser?.description ?? "";
  const userId      = entry.userId;

  const createdAt = robloxUser?.created
    ? Math.floor(new Date(robloxUser.created).getTime() / 1000)
    : null;

  const isHistory = mode === "history";
  const histEntry = entry as FRHistoryEntry;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Username",      value: `\`${username}\``,     inline: true },
    { name: "Display Name",  value: `\`${displayName}\``,  inline: true },
    { name: "User ID",       value: `\`${userId}\``,       inline: true },
  ];

  if (createdAt) {
    fields.push({ name: "Account Created", value: `<t:${createdAt}:D>`, inline: true });
  }

  if (isHistory) {
    if (histEntry.timestamp) {
      fields.push({
        name: "Removed",
        value: `<t:${Math.floor(histEntry.timestamp / 1000)}:R>`,
        inline: true,
      });
    }
    if (histEntry.removedBy) {
      fields.push({ name: "Removed By", value: `\`${histEntry.removedBy}\``, inline: true });
    }
  }

  if (bio) {
    fields.push({
      name: "Bio",
      value: bio.length > 300 ? bio.slice(0, 297) + "…" : bio,
      inline: false,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(isHistory ? "📜 Unfriend History" : "📌 Pinned Friends")
    .setDescription(`**${index + 1} / ${total}**  •  [View Profile](https://www.roblox.com/users/${userId}/profile)`)
    .addFields(fields)
    .setColor(isHistory ? 0xe74c3c : 0x3498db)
    .setFooter({ text: isHistory ? "Unfriend History" : "Pinned Friends" })
    .setTimestamp();

  if (robloxUser?.avatarUrl) embed.setThumbnail(robloxUser.avatarUrl);

  return embed;
}

/** Navigation + View Profile buttons for paginated history/pin embeds */
export function buildFRNavRow(
  index: number,
  total: number,
  userId: string,
  mode: "history" | "pin",
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`fr:${mode}_back:${index}`)
      .setLabel("◀ Back")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(`fr:${mode}_forward:${index}`)
      .setLabel("Forward ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index >= total - 1),
    new ButtonBuilder()
      .setURL(`https://www.roblox.com/users/${userId}/profile`)
      .setLabel("View Profile")
      .setStyle(ButtonStyle.Link)
      .setEmoji("🔗"),
  );
}

// ── Notification settings UI ─────────────────────────────────────────────────

export function buildNotifSettingsEmbed(prefs: FRNotificationPrefs): EmbedBuilder {
  const check = (on: boolean) => (on ? "🟢 On" : "🔴 Off");
  return new EmbedBuilder()
    .setTitle("🔔 Notification Settings")
    .setDescription("Toggle which events you'd like to receive DM alerts for.")
    .addFields(
      { name: "👤 Friend Removed",       value: check(prefs.friendRemoved),     inline: true },
      { name: "📌 Friend Pinned",        value: check(prefs.friendPinned),       inline: true },
      { name: "⏰ Scheduled Removals",   value: check(prefs.scheduledRemovals),  inline: true },
      { name: "⚙️ System Events",        value: check(prefs.systemEvents),       inline: true },
    )
    .setColor(0x9b59b6)
    .setFooter({ text: "Click a button below to toggle a setting" });
}

export function buildNotifSettingsRow(prefs: FRNotificationPrefs): ActionRowBuilder<ButtonBuilder> {
  const btn = (id: string, label: string, on: boolean) =>
    new ButtonBuilder()
      .setCustomId(`fr:notif_toggle:${id}`)
      .setLabel(label)
      .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    btn("friendRemoved",    "Friend Removed",    prefs.friendRemoved),
    btn("friendPinned",     "Friend Pinned",     prefs.friendPinned),
    btn("scheduledRemovals","Scheduled",         prefs.scheduledRemovals),
    btn("systemEvents",     "System",            prefs.systemEvents),
  );
}
