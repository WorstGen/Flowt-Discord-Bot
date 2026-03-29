/**
 * src/commands/slash.mjs
 * Slash command definitions (discord.js REST) and handler dispatch.
 */

import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import { config }                             from '../config.mjs';
import { playAction }                         from '../play-action.mjs';
import { getPlayer, destroyPlayer }           from '../player.mjs';
import {
  addedEmbed,
  queueEmbed,
  nowPlayingEmbed,
  errorEmbed,
} from '../utils.mjs';

// ─── Definitions ─────────────────────────────────────────────────────────────

const definitions = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track or Flowt playlist in your voice/stage channel')
    .addStringOption(o =>
      o.setName('source')
        .setDescription('YouTube/Suno/GEOFF URL  |  @username  |  @discover')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('p')
    .setDescription('Alias for /play')
    .addStringOption(o =>
      o.setName('source')
        .setDescription('YouTube/Suno/GEOFF URL  |  @username  |  @discover')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),

  new SlashCommandBuilder()
    .setName('q')
    .setDescription('Alias for /queue'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume paused playback'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and disconnect'),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing track'),

  new SlashCommandBuilder()
    .setName('np')
    .setDescription('Alias for /nowplaying'),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume (0–100)')
    .addIntegerOption(o =>
      o.setName('level')
        .setDescription('0–100')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the remaining queue'),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle loop mode')
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('What to loop')
        .setRequired(true)
        .addChoices(
          { name: 'Off',   value: 'off'   },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' },
        )),

  new SlashCommandBuilder()
    .setName('crossfade')
    .setDescription('Configure crossfade between tracks')
    .addNumberOption(o =>
      o.setName('seconds')
        .setDescription('0 = off, max 12')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(12))
    .addStringOption(o =>
      o.setName('style')
        .setDescription('Fade curve')
        .addChoices(
          { name: 'Smooth (default)', value: 'smooth'   },
          { name: 'Linear',           value: 'linear'   },
          { name: 'Cinematic',        value: 'cinematic' },
          { name: 'Quick',            value: 'quick'    },
        )),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by position')
    .addIntegerOption(o =>
      o.setName('position')
        .setDescription('Queue position (1 = next)')
        .setRequired(true)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Queue the full Flowt discover feed immediately'),
].map(c => c.toJSON());

// ─── Registration ─────────────────────────────────────────────────────────────

export async function registerSlashCommands() {
  const rest  = new REST({ version: '10' }).setToken(config.botToken);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: definitions });
  console.log(
    `[slash] Registered ${definitions.length} commands ` +
    (config.guildId ? `to guild ${config.guildId}` : 'globally')
  );
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function play(interaction) {
  await interaction.deferReply();
  const source = interaction.options.getString('source', true).trim();
  const result = await playAction({
    source,
    member:      interaction.member,
    guild:       interaction.guild,
    textChannel: interaction.channel,
  });
  if (!result.ok) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
  return interaction.editReply({ embeds: [addedEmbed(result.tracks, result.label, result.channel)] });
}

async function queue(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || (!player.currentTrack && !player.queue.length)) {
    return interaction.reply({ embeds: [errorEmbed('The queue is empty.')], ephemeral: true });
  }
  return interaction.reply({ embeds: [queueEmbed(player.getState())], ephemeral: true });
}

async function skip(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player?.currentTrack) {
    return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
  }
  const title = player.currentTrack.title;
  player.skip();
  return interaction.reply(`⏭ Skipped **${title}**.`);
}

async function pause(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player?.isPlaying) return interaction.reply({ embeds: [errorEmbed('Not playing.')], ephemeral: true });
  player.pause();
  return interaction.reply('⏸ Paused.');
}

async function resume(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player?.isPaused) return interaction.reply({ embeds: [errorEmbed('Not paused.')], ephemeral: true });
  player.resume();
  return interaction.reply('▶️ Resumed.');
}

async function stop(interaction) {
  if (!getPlayer(interaction.guildId)) {
    return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
  }
  destroyPlayer(interaction.guildId);
  return interaction.reply('⏹ Stopped and disconnected.');
}

async function nowplaying(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player?.currentTrack) {
    return interaction.reply({ embeds: [errorEmbed('Nothing is currently playing.')], ephemeral: true });
  }
  return interaction.reply({ embeds: [nowPlayingEmbed(player.currentTrack, player.getState())], ephemeral: true });
}

async function volume(interaction) {
  const level  = interaction.options.getInteger('level', true);
  const player = getPlayer(interaction.guildId);
  if (!player) return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
  player.setVolume(level / 100);
  return interaction.reply(`🔊 Volume set to **${level}%**.`);
}

async function shuffle(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player?.queue.length) {
    return interaction.reply({ embeds: [errorEmbed('Queue is empty.')], ephemeral: true });
  }
  player.shuffle();
  return interaction.reply(`🔀 Shuffled **${player.queue.length}** tracks.`);
}

async function loop(interaction) {
  const mode   = interaction.options.getString('mode', true);
  const player = getPlayer(interaction.guildId);
  if (!player) return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
  if (mode === 'track') { player.loopTrack = true;  player.loopQueue = false; return interaction.reply('🔂 Looping current track.'); }
  if (mode === 'queue') { player.loopQueue = true;  player.loopTrack = false; return interaction.reply('🔁 Looping queue.'); }
  player.loopTrack = false; player.loopQueue = false;
  return interaction.reply('➡️ Loop disabled.');
}

async function crossfade(interaction) {
  const seconds = interaction.options.getNumber('seconds', true);
  const style   = interaction.options.getString('style') || 'smooth';
  const player  = getPlayer(interaction.guildId);
  if (!player) return interaction.reply({ embeds: [errorEmbed('Nothing is playing.')], ephemeral: true });
  player.setCrossfade(seconds * 1000, style);
  return interaction.reply(
    seconds === 0
      ? '🎛 Crossfade **disabled**.'
      : `🎛 Crossfade **${seconds}s** (${style}).`
  );
}

async function remove(interaction) {
  const pos    = interaction.options.getInteger('position', true);
  const player = getPlayer(interaction.guildId);
  if (!player?.queue.length) return interaction.reply({ embeds: [errorEmbed('Queue is empty.')], ephemeral: true });
  const removed = player.remove(pos);
  if (!removed) return interaction.reply({ embeds: [errorEmbed(`No track at position ${pos}.`)], ephemeral: true });
  return interaction.reply(`🗑 Removed **${removed.title}** from position ${pos}.`);
}

async function discover(interaction) {
  await interaction.deferReply();
  const result = await playAction({
    source:      '@discover',
    member:      interaction.member,
    guild:       interaction.guild,
    textChannel: interaction.channel,
  });
  if (!result.ok) return interaction.editReply({ embeds: [errorEmbed(result.error)] });
  return interaction.editReply({ embeds: [addedEmbed(result.tracks, '🌊 Flowt Discover feed', result.channel)] });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const HANDLERS = {
  play: play, p: play,
  queue: queue, q: queue,
  skip, pause, resume, stop,
  nowplaying: nowplaying, np: nowplaying,
  volume, shuffle, loop, crossfade, remove, discover,
};

export async function handleSlashCommand(interaction) {
  const handler = HANDLERS[interaction.commandName];
  if (!handler) return;
  await handler(interaction);
}
