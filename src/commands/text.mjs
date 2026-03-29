/**
 * src/commands/text.mjs
 * Text command handler — mirrors every slash command via !prefix.
 *
 * Supported commands:
 *   !play / !p     <URL | @username | @discover>
 *   !queue / !q
 *   !skip / !s
 *   !pause
 *   !resume / !r
 *   !stop
 *   !np / !nowplaying
 *   !volume / !vol  <0-100>
 *   !shuffle
 *   !loop           <off|track|queue>
 *   !crossfade / !cf  <seconds> [style]
 *   !remove / !rm   <position>
 *   !discover
 *   !help
 */

import { config }                      from '../config.mjs';
import { playAction }                  from '../play-action.mjs';
import { getPlayer, destroyPlayer }    from '../player.mjs';
import { parseTextCommand, addedEmbed, queueEmbed, nowPlayingEmbed, errorEmbed } from '../utils.mjs';
import { EmbedBuilder }                from 'discord.js';

const BRAND_CYAN = 0x16C9C9;

// ─── Reply helper ─────────────────────────────────────────────────────────────

async function reply(message, content) {
  if (typeof content === 'string') {
    return message.reply(content).catch(() => {});
  }
  return message.reply(content).catch(() => {});
}

// ─── Individual handlers ──────────────────────────────────────────────────────

async function handlePlay(message, args) {
  const source = args.join(' ').trim();
  if (!source) {
    return reply(message, { embeds: [errorEmbed(`Usage: \`${config.prefix}play <URL | @username | @discover>\``)] });
  }

  const result = await playAction({
    source,
    member:      message.member,
    guild:       message.guild,
    textChannel: message.channel,
  });

  if (!result.ok) return reply(message, { embeds: [errorEmbed(result.error)] });
  return reply(message, { embeds: [addedEmbed(result.tracks, result.label, result.channel)] });
}

async function handleQueue(message) {
  const player = getPlayer(message.guildId);
  if (!player || (!player.currentTrack && !player.queue.length)) {
    return reply(message, { embeds: [errorEmbed('The queue is empty.')] });
  }
  return reply(message, { embeds: [queueEmbed(player.getState())] });
}

async function handleSkip(message) {
  const player = getPlayer(message.guildId);
  if (!player?.currentTrack) return reply(message, { embeds: [errorEmbed('Nothing is playing.')] });
  const title = player.currentTrack.title;
  player.skip();
  return reply(message, `⏭ Skipped **${title}**.`);
}

async function handlePause(message) {
  const player = getPlayer(message.guildId);
  if (!player?.isPlaying) return reply(message, { embeds: [errorEmbed('Not playing.')] });
  player.pause();
  return reply(message, '⏸ Paused.');
}

async function handleResume(message) {
  const player = getPlayer(message.guildId);
  if (!player?.isPaused) return reply(message, { embeds: [errorEmbed('Not paused.')] });
  player.resume();
  return reply(message, '▶️ Resumed.');
}

async function handleStop(message) {
  if (!getPlayer(message.guildId)) return reply(message, { embeds: [errorEmbed('Nothing is playing.')] });
  destroyPlayer(message.guildId);
  return reply(message, '⏹ Stopped and disconnected.');
}

async function handleNowPlaying(message) {
  const player = getPlayer(message.guildId);
  if (!player?.currentTrack) return reply(message, { embeds: [errorEmbed('Nothing is currently playing.')] });
  return reply(message, { embeds: [nowPlayingEmbed(player.currentTrack, player.getState())] });
}

async function handleVolume(message, args) {
  const level = parseInt(args[0], 10);
  if (isNaN(level) || level < 0 || level > 100) {
    return reply(message, { embeds: [errorEmbed(`Usage: \`${config.prefix}volume <0-100>\``)] });
  }
  const player = getPlayer(message.guildId);
  if (!player) return reply(message, { embeds: [errorEmbed('Nothing is playing.')] });
  player.setVolume(level / 100);
  return reply(message, `🔊 Volume set to **${level}%**.`);
}

async function handleShuffle(message) {
  const player = getPlayer(message.guildId);
  if (!player?.queue.length) return reply(message, { embeds: [errorEmbed('Queue is empty.')] });
  player.shuffle();
  return reply(message, `🔀 Shuffled **${player.queue.length}** tracks.`);
}

async function handleLoop(message, args) {
  const mode   = (args[0] || '').toLowerCase();
  const player = getPlayer(message.guildId);
  if (!player) return reply(message, { embeds: [errorEmbed('Nothing is playing.')] });

  if (mode === 'track') {
    player.loopTrack = true; player.loopQueue = false;
    return reply(message, '🔂 Looping current track.');
  }
  if (mode === 'queue') {
    player.loopQueue = true; player.loopTrack = false;
    return reply(message, '🔁 Looping queue.');
  }
  if (mode === 'off' || !mode) {
    player.loopTrack = false; player.loopQueue = false;
    return reply(message, '➡️ Loop disabled.');
  }
  return reply(message, { embeds: [errorEmbed(`Usage: \`${config.prefix}loop <off|track|queue>\``)] });
}

async function handleCrossfade(message, args) {
  const seconds = parseFloat(args[0]);
  if (isNaN(seconds) || seconds < 0 || seconds > 12) {
    return reply(message, { embeds: [errorEmbed(`Usage: \`${config.prefix}crossfade <0-12> [smooth|linear|cinematic|quick]\``)] });
  }
  const style  = args[1] || 'smooth';
  const player = getPlayer(message.guildId);
  if (!player) return reply(message, { embeds: [errorEmbed('Nothing is playing.')] });
  player.setCrossfade(seconds * 1000, style);
  return reply(message,
    seconds === 0
      ? '🎛 Crossfade **disabled**.'
      : `🎛 Crossfade **${seconds}s** (${style}).`
  );
}

async function handleRemove(message, args) {
  const pos    = parseInt(args[0], 10);
  const player = getPlayer(message.guildId);
  if (!player?.queue.length) return reply(message, { embeds: [errorEmbed('Queue is empty.')] });
  if (isNaN(pos) || pos < 1) return reply(message, { embeds: [errorEmbed(`Usage: \`${config.prefix}remove <position>\``)] });
  const removed = player.remove(pos);
  if (!removed) return reply(message, { embeds: [errorEmbed(`No track at position ${pos}.`)] });
  return reply(message, `🗑 Removed **${removed.title}** from position ${pos}.`);
}

async function handleDiscover(message) {
  const result = await playAction({
    source:      '@discover',
    member:      message.member,
    guild:       message.guild,
    textChannel: message.channel,
  });
  if (!result.ok) return reply(message, { embeds: [errorEmbed(result.error)] });
  return reply(message, { embeds: [addedEmbed(result.tracks, '🌊 Flowt Discover feed', result.channel)] });
}

async function handleHelp(message) {
  const p = config.prefix;
  const embed = new EmbedBuilder()
    .setColor(BRAND_CYAN)
    .setTitle('🌊 Flowt Bot — Commands')
    .setDescription(
      'Streams YouTube, Suno, and GEOFF audio in voice and stage channels.\n' +
      'Every text command also has a `/slash` equivalent.'
    )
    .addFields(
      {
        name: 'Playback',
        value: [
          `\`${p}play <source>\` — Queue a URL, \`@username\`, or \`@discover\``,
          `\`${p}discover\` — Queue the Flowt discover feed`,
          `\`${p}skip\` / \`${p}s\` — Skip current track`,
          `\`${p}pause\` — Pause`,
          `\`${p}resume\` / \`${p}r\` — Resume`,
          `\`${p}stop\` — Stop and disconnect`,
          `\`${p}np\` — Now playing`,
        ].join('\n'),
      },
      {
        name: 'Queue',
        value: [
          `\`${p}queue\` / \`${p}q\` — Show queue`,
          `\`${p}shuffle\` — Shuffle remaining tracks`,
          `\`${p}remove <pos>\` — Remove track at position`,
          `\`${p}loop <off|track|queue>\` — Loop mode`,
        ].join('\n'),
      },
      {
        name: 'Settings',
        value: [
          `\`${p}volume <0-100>\` — Set volume`,
          `\`${p}crossfade <0-12> [style]\` — Crossfade (smooth/linear/cinematic/quick)`,
        ].join('\n'),
      },
      {
        name: 'Sources',
        value: [
          '`@discover` — Full Flowt feed',
          '`@alice` — A specific Flowt user's ripples',
          'YouTube / Suno / GEOFF URLs pasted directly',
        ].join('\n'),
      },
    );

  return reply(message, { embeds: [embed] });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const TEXT_HANDLERS = {
  play: handlePlay,    p:       handlePlay,
  queue: handleQueue,  q:       handleQueue,
  skip: handleSkip,    s:       handleSkip,
  pause: handlePause,
  resume: handleResume, r:      handleResume,
  stop: handleStop,
  nowplaying: handleNowPlaying, np: handleNowPlaying,
  volume: handleVolume, vol:    handleVolume,
  shuffle: handleShuffle,
  loop: handleLoop,
  crossfade: handleCrossfade, cf: handleCrossfade,
  remove: handleRemove, rm:     handleRemove,
  discover: handleDiscover,
  help: handleHelp,    h:       handleHelp,
};

/**
 * Handle a raw Discord message — returns true if it was a valid command.
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>}
 */
export async function handleTextCommand(message) {
  const prefix = config.prefix;
  if (!message.content.startsWith(prefix)) return false;
  if (message.author.bot) return false;
  if (!message.guild) return false; // DMs not supported

  const body = message.content.slice(prefix.length);
  const { command, args } = parseTextCommand(body);

  const handler = TEXT_HANDLERS[command];
  if (!handler) return false;

  try {
    await handler(message, args);
  } catch (err) {
    console.error(`[text] Error in ${prefix}${command}:`, err);
    message.reply({ embeds: [errorEmbed(`Something went wrong: ${err.message}`)] }).catch(() => {});
  }

  return true;
}
