/**
 * src/utils.mjs
 * Shared helpers used by both slash-command and text-command handlers.
 */

import {
  EmbedBuilder,
  ChannelType,
} from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} from '@discordjs/voice';

export const BRAND_CYAN = 0x16C9C9;
export const BRAND_PINK = 0xEC4899;

export const SOURCE_EMOJI = {
  youtube: '▶️',
  suno:    '🎵',
  geoff:   '🌊',
  direct:  '🔗',
};

export const LOOP_EMOJI = {
  off:   '➡️',
  track: '🔂',
  queue: '🔁',
};

// ─── Voice channel helpers ────────────────────────────────────────────────────

/**
 * Return the voice/stage channel that a guild member is currently in.
 * Works for both interaction.member and message.member.
 * @param {import('discord.js').GuildMember} member
 * @returns {import('discord.js').VoiceBasedChannel | null}
 */
export function getMemberVoiceChannel(member) {
  return member?.voice?.channel ?? null;
}

/**
 * Join a voice or stage channel, wait for Ready, and handle stage-speak.
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
 */
export async function joinChannel(channel, guild) {
  // Reuse existing connection if already in this channel
  const existing = getVoiceConnection(guild.id);
  if (existing && existing.joinConfig?.channelId === channel.id
      && existing.state.status !== VoiceConnectionStatus.Destroyed) {
    return existing;
  }

  const conn = joinVoiceChannel({
    channelId:      channel.id,
    guildId:        guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf:       true,
    selfMute:       false,
  });

  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    conn.destroy();
    throw new Error('Could not connect to the voice channel within 20 s.');
  }

  // For Stage channels: request to speak (requires Stage Moderator role or mod approval)
  if (channel.type === ChannelType.GuildStageVoice) {
    await guild.members.me?.voice.setSuppressed(false).catch(() => {});
  }

  return conn;
}

// ─── Embed builders ───────────────────────────────────────────────────────────

export function nowPlayingEmbed(track, state) {
  const emoji = SOURCE_EMOJI[track.sourceType] ?? '🎵';
  const loopLabel = state?.loopTrack ? LOOP_EMOJI.track
                  : state?.loopQueue ? LOOP_EMOJI.queue
                  : LOOP_EMOJI.off;

  const embed = new EmbedBuilder()
    .setColor(BRAND_CYAN)
    .setTitle(`${emoji} Now Playing`)
    .setDescription(`**[${track.title}](${track.sourceUrl})**`)
    .addFields(
      { name: 'Artist',    value: track.artist,                    inline: true },
      { name: 'Source',    value: track.sourceType.toUpperCase(),  inline: true },
      { name: 'Loop',      value: loopLabel,                       inline: true },
    );

  if (state) {
    embed.addFields(
      { name: 'Volume',    value: `${Math.round(state.volume * 100)}%`, inline: true },
      {
        name:   'Crossfade',
        value:  state.crossfadeMs > 0
                  ? `${state.crossfadeMs / 1000}s (${state.crossfadeStyle})`
                  : 'Off',
        inline: true,
      },
      { name: 'Up next',   value: state.queue.length ? `${state.queue.length} track(s)` : 'Nothing', inline: true },
    );
  }

  return embed;
}

export function queueEmbed(state) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_CYAN)
    .setTitle('🎶 Flowt Queue');

  if (state.currentTrack) {
    const emoji = SOURCE_EMOJI[state.currentTrack.sourceType] ?? '🎵';
    const statusIcon = state.isPlaying ? '▶' : state.isPaused ? '⏸' : '⏹';
    embed.addFields({
      name:  `${statusIcon} Now Playing`,
      value: `${emoji} **${state.currentTrack.title}** — ${state.currentTrack.artist}`,
    });
  } else {
    embed.addFields({ name: 'Now Playing', value: '_Nothing_' });
  }

  if (state.queue.length === 0) {
    embed.addFields({ name: 'Up Next', value: '_Queue is empty_' });
  } else {
    const visible = state.queue.slice(0, 12);
    const lines = visible.map((t, i) => {
      const e = SOURCE_EMOJI[t.sourceType] ?? '🎵';
      return `\`${i + 1}.\` ${e} **${t.title}** — ${t.artist}`;
    });
    if (state.queue.length > 12) {
      lines.push(`_…and ${state.queue.length - 12} more_`);
    }
    embed.addFields({ name: `Up Next — ${state.queue.length} track(s)`, value: lines.join('\n') });
  }

  const loopLabel = state.loopTrack ? '🔂 Track' : state.loopQueue ? '🔁 Queue' : 'Off';
  embed.addFields(
    { name: 'Volume',    value: `${Math.round(state.volume * 100)}%`,                             inline: true },
    { name: 'Loop',      value: loopLabel,                                                         inline: true },
    { name: 'Crossfade', value: state.crossfadeMs > 0 ? `${state.crossfadeMs / 1000}s` : 'Off',   inline: true },
  );

  return embed;
}

export function addedEmbed(tracks, label, channel) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_CYAN)
    .setTitle(`✅ Added ${tracks.length} track${tracks.length !== 1 ? 's' : ''}`)
    .setDescription(label);

  if (tracks.length === 1) {
    const t     = tracks[0];
    const emoji = SOURCE_EMOJI[t.sourceType] ?? '🎵';
    embed.addFields(
      { name: 'Track',   value: `${emoji} ${t.title}`, inline: true },
      { name: 'Artist',  value: t.artist,               inline: true },
    );
  }

  if (channel) embed.addFields({ name: 'Channel', value: channel.name, inline: true });
  return embed;
}

export function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(BRAND_PINK)
    .setDescription(`❌ ${message}`);
}

// ─── Argument parsing for text commands ──────────────────────────────────────

/**
 * Parse a text command invocation like "!play @alice" into parts.
 * @param {string} content  Raw message content (after prefix stripped)
 * @returns {{ command: string, args: string[], rest: string }}
 */
export function parseTextCommand(content) {
  const parts   = content.trim().split(/\s+/);
  const command = (parts[0] || '').toLowerCase();
  const args    = parts.slice(1);
  return { command, args, rest: args.join(' ') };
}
