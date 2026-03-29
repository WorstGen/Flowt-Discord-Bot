/**
 * src/flowt-api.mjs
 * Public Flowt API client.
 *
 * No authentication is required — all playlist and ripple data accessed
 * here is publicly visible on flowt-umber.vercel.app.
 *
 * Sources supported (mirrors web/Android clients):
 *   YouTube  – resolved via POST /api/v1/media/resolve/youtube
 *   Suno     – direct CDN link, no resolution needed
 *   GEOFF    – resolved via POST /api/v1/media/resolve/geoff
 */

import { config } from './config.mjs';

const BASE = config.flowtApiBase;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FlowtTrack
 * @property {string}      id
 * @property {string}      title
 * @property {string}      artist        @username or display name
 * @property {'youtube'|'suno'|'geoff'|'direct'} sourceType
 * @property {string}      sourceUrl     Original embed / page URL
 * @property {string|null} streamUrl     Pre-resolved CDN/stream URL if known
 * @property {number|null} durationMs    Track duration if known
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Flowt API ${res.status} at ${path}: ${text.slice(0, 120)}`);
  }
  return res.json();
}

/** Pull the first http(s) URL from a plain-text string. */
function extractFirstUrl(text = '') {
  const m = text.match(/https?:\/\/[^\s"'<>)]+/);
  return m ? m[0] : null;
}

function isLikelyDirectAudioUrl(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!/^https?:\/\//i.test(text)) return false;
  if (text.includes('/api/proxy-audio')) return true;
  if (/\.(mp3|m4a|aac|ogg|wav|flac|opus|m3u8)(\?|#|$)/i.test(text)) return true;
  if (text.includes('googlevideo.com/videoplayback')) return true;
  if (text.includes('mime=audio')) return true;
  return false;
}

/**
 * Detect source type from a URL.
 * @param {string} url
 * @returns {'youtube'|'suno'|'geoff'|'direct'}
 */
export function detectSourceType(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('suno.ai') || u.includes('suno.com'))     return 'suno';
  if (u.includes('geoff'))                                   return 'geoff';
  return 'direct';
}

/**
 * Convert raw Flowt ripple objects into FlowtTrack shape.
 * Filters to ripples that contain a recognisable media URL.
 * @param {any[]} ripples
 * @returns {FlowtTrack[]}
 */
function ripplesToTracks(ripples) {
  const tracks = [];
  for (const r of ripples) {
    const rawUrl =
      r.mediaUrl     ||
      r.mediaEmbed   ||
      r.youtubeUrl   ||
      r.sunoUrl      ||
      extractFirstUrl(r.content || '');

    if (!rawUrl) continue;

    const sourceType = detectSourceType(rawUrl);
    tracks.push({
      id:         String(r.id ?? `r-${Date.now()}-${Math.random()}`),
      title:      r.title || (r.content?.slice(0, 60)) || 'Untitled',
      artist:     r.author?.username
                    ? `@${r.author.username}`
                    : (r.author?.displayName || 'Flowt'),
      sourceType,
      sourceUrl:  rawUrl,
      // Suno CDN links are direct audio — no further resolution needed
      streamUrl:  sourceType === 'suno' ? rawUrl : null,
      durationMs: r.durationMs || null,
    });
  }
  return tracks;
}

/**
 * Convert Flowt musicPlaylist items into FlowtTrack shape.
 * @param {any[]} items
 * @param {string} ownerUsername
 * @returns {FlowtTrack[]}
 */
function playlistItemsToTracks(items, ownerUsername = '') {
  const tracks = [];
  const username = String(ownerUsername || '').trim();
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item || typeof item !== 'object') continue;
    const provider = String(item.provider || '').trim().toLowerCase();
    const sourceUrl = String(item.sourceUrl || item.url || '').trim();
    const embedUrl = String(item.embedUrl || '').trim();
    const candidate = sourceUrl || embedUrl;
    if (!candidate) continue;

    const sourceType = provider || detectSourceType(candidate);
    const streamUrl = (sourceType === 'suno' || sourceType === 'direct' || isLikelyDirectAudioUrl(embedUrl))
      ? (embedUrl || sourceUrl)
      : null;

    tracks.push({
      id:         String(item.id || `pl-${Date.now()}-${Math.random()}`),
      title:      String(item.title || `${sourceType} track`).trim(),
      artist:     username ? `@${username}` : 'Flowt',
      sourceType,
      sourceUrl:  sourceUrl || embedUrl,
      streamUrl,
      durationMs: item.durationMs || null,
    });
  }
  return tracks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function rippleAuthorMatches(ripple, username) {
  const target = normalizeUsername(username);
  if (!target) return false;
  const candidates = [
    ripple?.author?.username,
    ripple?.authorUsername,
    ripple?.username,
    ripple?.user?.username,
    ripple?.sender?.username,
  ];
  return candidates.some((u) => normalizeUsername(u) === target);
}

/**
 * Fetch the discover feed (all users, combined).
 * Maps to GET /api/v1/state (ripples list in payload)
 * @returns {Promise<FlowtTrack[]>}
 */
export async function fetchDiscoverPlaylist() {
  const data    = await apiFetch('/api/v1/state');
  const users   = Array.isArray(data?.users) ? data.users : [];
  const playlistTracks = users.flatMap((u) => playlistItemsToTracks(u?.musicPlaylist, u?.username));
  const tracks  = playlistTracks.length ? playlistTracks : ripplesToTracks(Array.isArray(data?.ripples) ? data.ripples : []);
  if (!tracks.length) throw new Error('No playable tracks found in the Flowt discover feed.');
  return tracks;
}

/**
 * Fetch ripples for a specific Flowt user (public profile).
 * Maps to GET /api/v1/state?username=<username> (then filter by author)
 * @param {string} username  With or without the leading @
 * @returns {Promise<FlowtTrack[]>}
 */
export async function fetchUserPlaylist(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!clean) throw new Error('Username cannot be empty.');

  const data       = await apiFetch(`/api/v1/state?username=${encodeURIComponent(clean)}`);
  const userRecord = data?.user || (Array.isArray(data?.users) ? data.users.find((u) => normalizeUsername(u?.username) === clean) : null);
  const playlistTracks = playlistItemsToTracks(userRecord?.musicPlaylist, userRecord?.username || clean);
  const allRipples = Array.isArray(data?.ripples) ? data.ripples : [];
  const userRipples = allRipples.filter((r) => rippleAuthorMatches(r, clean));
  const tracks   = playlistTracks.length ? playlistTracks : ripplesToTracks(userRipples);
  if (!tracks.length) throw new Error(`No playable tracks found for @${clean}.`);
  return tracks;
}

/**
 * Ask the Flowt backend to resolve a YouTube or GEOFF URL to a stream URL.
 * @param {'youtube'|'geoff'} provider
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function resolveMediaUrl(provider, url) {
  const endpoint = provider === 'youtube'
    ? '/api/v1/media/resolve/youtube'
    : '/api/v1/media/resolve/geoff';

  const data = await apiFetch(endpoint, {
    method: 'POST',
    body:   JSON.stringify({ url }),
  });

  const resolved = data.url || data.streamUrl || null;
  if (!resolved) throw new Error(`No stream URL returned by Flowt for ${url}`);
  return resolved;
}

/**
 * Parse a raw URL pasted by a Discord user into a FlowtTrack.
 * @param {string} url
 * @returns {FlowtTrack}
 */
export function urlToTrack(url) {
  const sourceType = detectSourceType(url);
  let title = url;
  try {
    const u = new URL(url);
    if (sourceType === 'youtube') {
      title = `YouTube – ${u.searchParams.get('v') || u.pathname.split('/').pop()}`;
    } else if (sourceType === 'suno') {
      title = `Suno – ${u.pathname.split('/').filter(Boolean).pop() || 'track'}`;
    } else if (sourceType === 'geoff') {
      title = `GEOFF – ${u.pathname.split('/').filter(Boolean).pop() || 'track'}`;
    } else {
      title = u.hostname;
    }
  } catch { /* keep raw url */ }

  return {
    id:        `manual-${Date.now()}`,
    title,
    artist:    'Direct link',
    sourceType,
    sourceUrl: url,
    streamUrl: sourceType === 'suno' ? url : null,
    durationMs: null,
  };
}
