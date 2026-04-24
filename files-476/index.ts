// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Bot Entry Point
// ─────────────────────────────────────────────────────────────────────────────

import { Client, GatewayIntentBits, ChannelType, Events } from "discord.js";
import { FR_COMMANDS } from "./fr-commands.js";
import { routeFRCommand, routeFRButton, handleFRDMMessage } from "./fr-handlers.js";
import { purgeExpiredNotifications } from "./fr-data.js";

// ── Validate env ──────────────────────────────────────────────────────────────

const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const FR_API_BASE     = process.env.FR_API_BASE;
const FR_SHARED_SECRET = process.env.FR_SHARED_SECRET;

if (!DISCORD_TOKEN) {
  console.error("❌  DISCORD_TOKEN is not set. Aborting.");
  process.exit(1);
}
if (!FR_API_BASE) {
  console.warn("⚠️   FR_API_BASE is not set — defaulting to placeholder. History/pin commands will fail.");
}
if (!FR_SHARED_SECRET) {
  console.warn("⚠️   FR_SHARED_SECRET is not set — signed API requests will be rejected.");
}

// ── Client ────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Ready ─────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`✅  Logged in as ${c.user.tag}`);

  // Register slash commands globally
  try {
    await c.application.commands.set(FR_COMMANDS);
    console.log(`📋  Registered ${FR_COMMANDS.length} slash command(s).`);
  } catch (err) {
    console.error("❌  Failed to register slash commands:", err);
  }

  // Purge expired notifications once a day
  setInterval(purgeExpiredNotifications, 24 * 60 * 60 * 1000);
  console.log("🧹  Scheduled daily notification purge.");
});

// ── Slash commands + buttons ──────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const handled = await routeFRCommand(interaction);
      if (!handled) {
        // Placeholder — drop your own command routing here:
        // if (await routeMyCommands(interaction)) return;
        console.warn(`Unhandled command: /${interaction.commandName}`);
      }
      return;
    }

    if (interaction.isButton()) {
      const handled = await routeFRButton(interaction);
      if (!handled) {
        // Placeholder — drop your own button routing here.
        console.warn(`Unhandled button: ${interaction.customId}`);
      }
      return;
    }
  } catch (err) {
    console.error("Error handling interaction:", err);
  }
});

// ── DM messages (username input during /verify flow) ─────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  if (message.channel.type === ChannelType.DM) {
    try {
      const handled = await handleFRDMMessage(message.content, message.author.id, client);
      if (!handled) {
        // Placeholder — drop your own DM handling here.
      }
    } catch (err) {
      console.error("Error handling DM:", err);
    }
    return;
  }

  // Placeholder — drop your own guild message handling here.
});

// ── Error handling ────────────────────────────────────────────────────────────

client.on(Events.Error, (err) => {
  console.error("Discord client error:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("SIGINT", () => {
  console.log("\n👋  Shutting down...");
  client.destroy();
  process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);
