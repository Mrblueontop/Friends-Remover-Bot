// ─────────────────────────────────────────────────────────────────────────────
// Friends Remover X — Integration Guide
// How to wire the FR Discord integration into your existing bot.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ─── FILES ───────────────────────────────────────────────────────────────────
 *
 *  fr-data.ts          Types, in-memory KV stores, notification records
 *  fr-flows.ts         Embed/prompt builders (verify flow, history, pins, notifs)
 *  fr-notifications.ts DM notification dispatcher (sendFRNotification)
 *  fr-commands.ts      Slash command JSON definitions (FR_COMMANDS)
 *  fr-handlers.ts      All interaction handlers + top-level routers
 *
 * ─── ENVIRONMENT VARIABLES ───────────────────────────────────────────────────
 *
 *  FR_API_BASE        Your Cloudflare Worker URL (e.g. https://fr.example.workers.dev)
 *  FR_SHARED_SECRET   Same SHARED_SECRET as the Cloudflare Worker (for HMAC signing)
 *
 * ─── STEP 1: Register commands ───────────────────────────────────────────────
 *
 *  import { FR_COMMANDS } from "./fr-commands.js";
 *
 *  // Add to your existing command registration block:
 *  client.once("ready", async () => {
 *    const allCommands = [
 *      ...YOUR_EXISTING_COMMANDS,
 *      ...FR_COMMANDS,
 *    ];
 *    await client.application?.commands.set(allCommands);
 *  });
 *
 * ─── STEP 2: Route slash commands ────────────────────────────────────────────
 *
 *  import { routeFRCommand } from "./fr-handlers.js";
 *
 *  // In your interactionCreate handler, before your existing switch/if block:
 *  client.on("interactionCreate", async (interaction) => {
 *    if (interaction.isChatInputCommand()) {
 *      // Try FR commands first — returns true if handled
 *      if (await routeFRCommand(interaction)) return;
 *
 *      // ... your existing command routing below ...
 *    }
 *
 *    if (interaction.isButton()) {
 *      // Try FR buttons first
 *      if (await routeFRButton(interaction)) return;
 *
 *      // ... your existing button routing below ...
 *    }
 *  });
 *
 * ─── STEP 3: Handle DMs (verify username input) ───────────────────────────────
 *
 *  import { handleFRDMMessage } from "./fr-handlers.js";
 *
 *  // In your messageCreate handler, inside the DM branch:
 *  client.on("messageCreate", async (message) => {
 *    if (message.author.bot) return;
 *    if (message.channel.type === ChannelType.DM) {
 *      // FR verify flow consumes the message and returns true if handled
 *      if (await handleFRDMMessage(message.content, message.author.id, client)) return;
 *
 *      // ... rest of your DM handling ...
 *    }
 *  });
 *
 * ─── STEP 4: Send notifications from your existing event sources ──────────────
 *
 *  import { sendFRNotification } from "./fr-notifications.js";
 *
 *  // Call wherever a friend-related event occurs in your system.
 *  // The function is safe — silently skips if no Discord link or pref is off.
 *
 *  // Friend removed:
 *  await sendFRNotification(client, robloxUserId, "friend_removed", {
 *    removedUserId:   "12345678",
 *    removedUsername: "CoolDude",
 *    byUsername:      "MyAccount",
 *    timestamp:       Date.now(),
 *  });
 *
 *  // Friend pinned:
 *  await sendFRNotification(client, robloxUserId, "friend_pinned", {
 *    userId:   "12345678",
 *    username: "CoolDude",
 *  });
 *
 *  // Friend unpinned:
 *  await sendFRNotification(client, robloxUserId, "friend_unpinned", {
 *    userId:   "12345678",
 *    username: "CoolDude",
 *  });
 *
 *  // Scheduled removal success:
 *  await sendFRNotification(client, robloxUserId, "scheduled_removal_ran", {
 *    name:  "Daily Cleanup",
 *    count: 14,
 *  });
 *
 *  // Scheduled removal failure:
 *  await sendFRNotification(client, robloxUserId, "scheduled_removal_failed", {
 *    name:  "Daily Cleanup",
 *    error: "API timeout",
 *  });
 *
 * ─── STEP 5: Optional — periodic notification cleanup ─────────────────────────
 *
 *  import { purgeExpiredNotifications } from "./fr-data.js";
 *
 *  // Purge notifications older than 30 days once a day:
 *  setInterval(purgeExpiredNotifications, 24 * 60 * 60 * 1000);
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

export {}; // makes this a module
