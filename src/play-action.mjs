/**
 * src/play-action.mjs
 * Shared "resolve source → join channel → enqueue" logic used by both
 * the slash command (/play) and the text command (!play / !p).
 *
 * Returns a result object rather than touching the interaction/message
 * directly, so both command layers can format replies their own way.
 */

import { getVoiceConnection }  from '@discordjs/voice';
import { EmbedBuilder }        from 'discord.js';
import { getOrCreatePlayer }    from './player.mjs';
import { joinChannel }          from './utils.mjs';
import {
  fetchDiscoverPlaylist,
  fetchUserPlaylist,
  urlToTrack,
  detectSourceType,
} from './flowt-api.mjs';

/**
 * @typedef {Object} PlayResult
 * @property {boolean}                      ok
 * @property {string}                       [error]     Human-readable error
 * @property {import('./flowt-api.mjs').FlowtTrack[]} [tracks]
 * @property {string}                       [label]     Source description
 * @property {import('discord.js').VoiceBasedChannel} [channel]
 */

const URL_RE = /^https?:\/\//i;

/**
 * Resolve a source string + member context into queued tracks.
 *
 * @param {object} opts
 * @param {string}  opts.source      Raw source string (@username, @discover, or URL)
 * @param {import('discord.js').GuildMember} opts.member
 * @param {import('discord.js').Guild}       opts.guild
 * @param {import('discord.js').TextChannel} opts.textChannel  For now-playing messages
 * @returns {Promise<PlayResult>}
 */
export async function playAction({ source, member, guild, textChannel }) {
  // ── 1. Resolve source to tracks ──────────────────────────────────────────

  let tracks = [];
  let label  = '';

  try {
    if (source.startsWith('@')) {
      const slug = source.slice(1).toLowerCase().trim();
      if (slug === 'discover' || slug === '') {
        tracks = await fetchDiscoverPlaylist();
        label  = '🌊 Flowt Discover feed';
      } else {
        tracks = await fetchUserPlaylist(slug);
        label  = `🌊 @${slug}'s Flowt playlist`;
      }
    } else if (URL_RE.test(source)) {
      const type = detectSourceType(source);
      if (!['youtube', 'suno', 'geoff', 'direct'].includes(type)) {
        return { ok: false, error: 'Unsupported URL. Paste a YouTube, Suno, or GEOFF link.' };
      }
      tracks = [urlToTrack(source)];
      label  = `Queued direct link`;
    } else {
      return {
        ok:    false,
        error: 'Unrecognised source. Use a URL, `@username`, or `@discover`.',
      };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!tracks.length) {
    return { ok: false, error: 'No playable tracks found for that source.' };
  }

  // ── 2. Join voice channel ─────────────────────────────────────────────────

  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    return { ok: false, error: 'Join a voice or stage channel first.' };
  }

  let conn;
  try {
    conn = await joinChannel(voiceChannel, guild);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── 3. Enqueue ────────────────────────────────────────────────────────────

  const player = getOrCreatePlayer(guild.id, conn);
  player.enqueue(...tracks);

  // Wire now-playing messages once per player instance
  if (!player._discordListenerAttached && textChannel) {
    player._discordListenerAttached = true;
    player._textChannel = textChannel;

    player.on('trackStart', (track) => {
      const ch = player._textChannel;
      if (!ch) return;
      ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x16C9C9)
            .setDescription(
              `▶️ **${track.title}** — ${track.artist}  \`${track.sourceType.toUpperCase()}\``
            ),
        ],
      }).catch(() => {});
    });

    player.on('error', (err, track) => {
      player._textChannel?.send(
        `⚠️ Playback error for **${track?.title ?? 'track'}**: ${err.message}`
      ).catch(() => {});
    });

    player.on('queueEnd', () => {
      player._textChannel?.send('✅ Queue finished.').catch(() => {});
    });
  }

  return { ok: true, tracks, label, channel: voiceChannel };
}
