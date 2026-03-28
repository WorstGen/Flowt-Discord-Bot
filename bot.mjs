/**
 * src/bot.mjs
 * Flowt Discord Bot — entry point.
 *
 *   Normal start:     node src/bot.mjs
 *   Deploy commands:  DEPLOY_COMMANDS=1 node src/bot.mjs
 *   Dev watch:        node --watch src/bot.mjs
 */

// Load .env if present (optional — works without it if env is set externally)
import { existsSync, readFileSync } from 'node:fs';
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && !k.startsWith('#') && rest.length) {
      process.env[k.trim()] ??= rest.join('=').trim();
    }
  }
}

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { config }                             from './config.mjs';
import { registerSlashCommands, handleSlashCommand } from './commands/slash.mjs';
import { handleTextCommand }                  from './commands/text.mjs';

// ─── Command-deploy-only mode ─────────────────────────────────────────────────

if (process.env.DEPLOY_COMMANDS === '1') {
  await registerSlashCommands();
  console.log('[bot] Commands deployed. Exiting.');
  process.exit(0);
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // Required for text commands
  ],
});

// ─── Events ───────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  console.log(`[bot] Prefix: ${config.prefix}   |   Flowt API: ${config.flowtApiBase}`);
  console.log(`[bot] Guild scope: ${config.guildId ?? 'global'}`);

  // Register slash commands on startup (idempotent)
  await registerSlashCommands().catch(err =>
    console.warn('[bot] Slash command registration skipped:', err.message)
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlashCommand(interaction);
  } catch (err) {
    console.error(`[bot] Slash /${interaction.commandName}:`, err);
    const msg = `❌ ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  await handleTextCommand(message).catch(err =>
    console.error('[bot] Text command error:', err)
  );
});

client.on(Events.Error, (err) => console.error('[bot] Client error:', err));

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('unhandledRejection', (err) => console.error('[bot] Unhandled rejection:', err));
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });

// ─── Login ────────────────────────────────────────────────────────────────────

await client.login(config.botToken);
