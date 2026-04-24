// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Slash Command Definitions
// Register with: client.application?.commands.set(FR_COMMANDS)
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export const FR_COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  // /verify
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Link your Roblox account to receive DM notifications (up to 5 accounts)")
    .toJSON(),

  // /switch account
  new SlashCommandBuilder()
    .setName("switch")
    .setDescription("Switch between your verified Roblox accounts")
    .addSubcommand((sub) =>
      sub
        .setName("account")
        .setDescription("Switch your active Roblox account")
        .addIntegerOption((opt) =>
          opt
            .setName("slot")
            .setDescription("Account slot (1–5)")
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(false)
        )
    )
    .toJSON(),

  // /history view
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Browse your unfriend history")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Browse removed friends one by one")
        .addIntegerOption((opt) =>
          opt
            .setName("page")
            .setDescription("Start from this entry (default: 1 = most recent)")
            .setMinValue(1)
            .setRequired(false)
        )
    )
    .toJSON(),

  // /pin view
  new SlashCommandBuilder()
    .setName("pin")
    .setDescription("Browse your pinned friends")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Browse pinned friends one by one")
        .addIntegerOption((opt) =>
          opt
            .setName("page")
            .setDescription("Start from this entry (default: 1)")
            .setMinValue(1)
            .setRequired(false)
        )
    )
    .toJSON(),

  // /notifications toggle
  new SlashCommandBuilder()
    .setName("notifications")
    .setDescription("Manage your DM notification preferences")
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Open the notification settings menu")
    )
    .toJSON(),
];
