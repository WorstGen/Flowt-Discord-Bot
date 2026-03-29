/**
 * src/config.mjs
 * Single source of truth for all runtime configuration.
 * Reads from process.env — load a .env file before importing if needed.
 */

function require(key, fallback) {
  const val = process.env[key]?.trim();
  if (!val && fallback === undefined) {
    console.error(`[config] Missing required env var: ${key}`);
    process.exit(1);
  }
  return val || fallback;
}

export const config = {
  // Discord
  botToken:  require('DISCORD_BOT_TOKEN'),
  clientId:  require('DISCORD_CLIENT_ID'),
  guildId:   process.env.DISCORD_GUILD_ID?.trim() || null,

  // Flowt — public API, no auth
  flowtApiBase: (process.env.FLOWT_API_BASE || 'https://flowtapi.duckdns.org').replace(/\/+$/, ''),

  // Bot behaviour
  prefix:          process.env.BOT_PREFIX?.trim()      || '!',
  defaultVolume:   Math.max(0, Math.min(100, Number(process.env.DEFAULT_VOLUME)  || 80)) / 100,
  defaultCrossfadeMs: Math.max(0, Math.min(12000, Number(process.env.DEFAULT_CROSSFADE_MS) || 0)),
};
