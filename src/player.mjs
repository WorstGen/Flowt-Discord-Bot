/**
 * src/player.mjs
 * Per-guild audio player.
 *
 * Crossfade implementation is a direct port of the Android FlowtAudioService
 * (four curve styles, 0–12 s range, smooth ramp via volume API).
 *
 * One GuildPlayer per guild, managed by getOrCreatePlayer / getPlayer / destroyPlayer.
 */

import {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice';
import { EventEmitter }                        from 'node:events';
import { config }                              from './config.mjs';
import { resolveMediaUrl }                     from './flowt-api.mjs';

// ─── Crossfade curves (mirrors FlowtAudioService.resolveCrossfadeProgress) ────

const CROSSFADE_STYLES = Object.freeze(['smooth', 'linear', 'cinematic', 'quick']);

function crossfadeEase(p, style) {
  const t = Math.max(0, Math.min(1, p));
  switch (style) {
    case 'linear':    return t;
    case 'quick':     return Math.min(1, t * 1.65);
    case 'cinematic': return 0.5 - Math.cos(Math.PI * t) / 2;
    default:          return t * t * (3 - 2 * t); // smooth / hermite
  }
}

// ─── Stream factory ───────────────────────────────────────────────────────────

/**
 * Resolve a FlowtTrack to a discord.js AudioResource.
 * @param {import('./flowt-api.mjs').FlowtTrack} track
 * @returns {Promise<import('@discordjs/voice').AudioResource>}
 */
async function trackToResource(track) {
  switch (track.sourceType) {
    case 'youtube': {
      const ytdl   = (await import('ytdl-core')).default;
      const stream = ytdl(track.sourceUrl, {
        filter:         'audioonly',
        quality:        'highestaudio',
        highWaterMark:  1 << 25,
      });
      return createAudioResource(stream, {
        inputType:    StreamType.Arbitrary,
        inlineVolume: true,
        metadata:     { track },
      });
    }

    case 'geoff': {
      const streamUrl = track.streamUrl ?? await resolveMediaUrl('geoff', track.sourceUrl);
      const res = await fetch(streamUrl);
      if (!res.ok) throw new Error(`GEOFF fetch failed: ${res.status}`);
      return createAudioResource(res.body, {
        inputType:    StreamType.Arbitrary,
        inlineVolume: true,
        metadata:     { track },
      });
    }

    case 'suno':
    case 'direct': {
      // Suno CDN links are already direct audio streams
      const streamUrl = track.streamUrl || track.sourceUrl;
      const res = await fetch(streamUrl);
      if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
      return createAudioResource(res.body, {
        inputType:    StreamType.Arbitrary,
        inlineVolume: true,
        metadata:     { track },
      });
    }

    default:
      throw new Error(`Unknown sourceType: ${track.sourceType}`);
  }
}

// ─── GuildPlayer ──────────────────────────────────────────────────────────────

/**
 * Emits:
 *   'trackStart'  (track: FlowtTrack)
 *   'trackEnd'    (track: FlowtTrack)
 *   'queueEnd'    ()
 *   'error'       (err: Error, track: FlowtTrack | null)
 */
export class GuildPlayer extends EventEmitter {
  /**
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {string} guildId
   */
  constructor(connection, guildId) {
    super();
    this.guildId        = guildId;
    this.connection     = connection;
    this.queue          = [];        // FlowtTrack[]
    this.currentTrack   = null;      // FlowtTrack | null
    this.volume         = config.defaultVolume;
    this.crossfadeMs    = config.defaultCrossfadeMs;
    this.crossfadeStyle = 'smooth';
    this.loopQueue      = false;
    this.loopTrack      = false;

    this._player        = null;
    this._resource      = null;
    this._nextResource  = null;
    this._crossfadeTimer = null;
    this._historyTrack  = null;   // last played, for loop-track

    this._initPlayer();
  }

  _initPlayer() {
    this._player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this._player.on(AudioPlayerStatus.Idle, () => this._onIdle());
    this._player.on('error', (err) => {
      this.emit('error', err, this.currentTrack);
      this._onIdle();
    });
    this.connection.subscribe(this._player);
  }

  // ── Queue management ────────────────────────────────────────────────────────

  enqueue(...tracks) {
    this.queue.push(...tracks);
    if (this._player.state.status === AudioPlayerStatus.Idle) this._playNext();
  }

  insertNext(track) {
    this.queue.unshift(track);
    if (this._player.state.status === AudioPlayerStatus.Idle) this._playNext();
  }

  skip() {
    clearTimeout(this._crossfadeTimer);
    this.loopTrack = false;
    this._player.stop(true);
  }

  stop() {
    clearTimeout(this._crossfadeTimer);
    this.queue       = [];
    this.loopQueue   = false;
    this.loopTrack   = false;
    this._nextResource = null;
    this._player.stop(true);
    this.currentTrack = null;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  remove(index) {
    // 1-based index matching the !remove / /remove command
    const i = index - 1;
    if (i < 0 || i >= this.queue.length) return null;
    return this.queue.splice(i, 1)[0];
  }

  // ── Volume ──────────────────────────────────────────────────────────────────

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._resource?.volume?.setVolume(this.volume);
  }

  // ── Crossfade ───────────────────────────────────────────────────────────────

  setCrossfade(ms, style = 'smooth') {
    this.crossfadeMs    = Math.max(0, Math.min(12000, ms));
    this.crossfadeStyle = CROSSFADE_STYLES.includes(style) ? style : 'smooth';
  }

  // ── Loop ────────────────────────────────────────────────────────────────────

  toggleLoopTrack()  { this.loopTrack  = !this.loopTrack;  this.loopQueue = false; }
  toggleLoopQueue()  { this.loopQueue  = !this.loopQueue;  this.loopTrack = false; }

  // ── Playback controls ───────────────────────────────────────────────────────

  pause()  { this._player.pause();   }
  resume() { this._player.unpause(); }

  get isPlaying() { return this._player?.state?.status === AudioPlayerStatus.Playing; }
  get isPaused()  { return this._player?.state?.status === AudioPlayerStatus.Paused;  }

  // ── Internals ───────────────────────────────────────────────────────────────

  async _playNext() {
    // Loop single track
    if (this.loopTrack && this._historyTrack) {
      this.queue.unshift(this._historyTrack);
    }

    if (this.queue.length === 0) {
      this.currentTrack = null;
      this.emit('queueEnd');
      return;
    }

    const track = this.queue.shift();
    this._historyTrack = track;

    // Loop queue: re-add to end
    if (this.loopQueue) this.queue.push(track);

    this.currentTrack = track;
    this.emit('trackStart', track);

    try {
      let resource = null;

      // Use preloaded resource if it matches
      if (this._nextResource?.metadata?.track?.id === track.id) {
        resource = this._nextResource;
        this._nextResource = null;
      } else {
        resource = await trackToResource(track);
      }

      this._resource = resource;
      resource.volume?.setVolume(this.volume);
      this._player.play(resource);

      // Preload next in background
      if (this.queue.length > 0) {
        this._preloadNext(this.queue[0]).catch(() => {});
      }

      // Arm crossfade if a duration is known
      if (this.crossfadeMs > 0 && track.durationMs) {
        this._scheduleCrossfade(track.durationMs);
      }
    } catch (err) {
      this.emit('error', err, track);
      this._playNext();
    }
  }

  async _preloadNext(track) {
    try { this._nextResource = await trackToResource(track); }
    catch { this._nextResource = null; }
  }

  _scheduleCrossfade(durationMs) {
    clearTimeout(this._crossfadeTimer);
    const triggerAt = durationMs - this.crossfadeMs;
    if (triggerAt <= 0) return;
    this._crossfadeTimer = setTimeout(() => {
      this._rampVolume(this.volume, 0, this.crossfadeMs, () => this._player.stop(true));
    }, triggerAt);
  }

  _rampVolume(from, to, durationMs, onComplete) {
    const startAt  = Date.now();
    const resource = this._resource;
    const style    = this.crossfadeStyle;
    const tick = () => {
      if (this._resource !== resource) return; // guard: track changed mid-ramp
      const progress = Math.min(1, (Date.now() - startAt) / durationMs);
      const vol = from + (to - from) * crossfadeEase(progress, style);
      resource.volume?.setVolume(Math.max(0, Math.min(1, vol)));
      if (progress < 1) setTimeout(tick, 33);
      else onComplete?.();
    };
    tick();
  }

  _onIdle() {
    clearTimeout(this._crossfadeTimer);
    if (this.currentTrack) this.emit('trackEnd', this.currentTrack);
    this._playNext();
  }

  // ── State snapshot ──────────────────────────────────────────────────────────

  getState() {
    return {
      currentTrack:   this.currentTrack,
      queue:          this.queue.slice(),
      volume:         this.volume,
      crossfadeMs:    this.crossfadeMs,
      crossfadeStyle: this.crossfadeStyle,
      loopTrack:      this.loopTrack,
      loopQueue:      this.loopQueue,
      isPlaying:      this.isPlaying,
      isPaused:       this.isPaused,
    };
  }

  destroy() {
    clearTimeout(this._crossfadeTimer);
    this._player.stop(true);
    try { this.connection.destroy(); } catch { /* already gone */ }
  }
}

// ─── Guild player registry ────────────────────────────────────────────────────

const _players = new Map(); // guildId → GuildPlayer

export function getOrCreatePlayer(guildId, connection) {
  if (_players.has(guildId)) {
    const existing = _players.get(guildId);
    if (existing.connection !== connection) {
      existing.connection = connection;
      connection.subscribe(existing._player);
    }
    return existing;
  }
  const player = new GuildPlayer(connection, guildId);
  _players.set(guildId, player);
  connection.on(VoiceConnectionStatus.Destroyed, () => _players.delete(guildId));
  return player;
}

export function getPlayer(guildId) {
  return _players.get(guildId) ?? null;
}

export function destroyPlayer(guildId) {
  const p = _players.get(guildId);
  if (p) { p.destroy(); _players.delete(guildId); }
}
