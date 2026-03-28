# flowt-discord-bot

Streams **YouTube**, **Suno**, and **GEOFF** audio in Discord voice and stage channels, with direct access to public Flowt user playlists — no auth required.

```
/play source: @discover        ← Full Flowt feed
/play source: @alice           ← @alice's public ripples
/play source: https://youtu.be/... ← YouTube
/play source: https://suno.ai/...  ← Suno
/play source: https://geoff.fm/... ← GEOFF
```

Both **slash commands** (`/play`) and **text commands** (`!play`) are supported, with full parity.

---

## Getting started

### 1 — Create a Discord application

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name it *Flowt*
2. **Bot** tab → **Add Bot** → copy the **Token**
3. **General Information** tab → copy the **Application (Client) ID**
4. **Bot** tab → enable **Message Content Intent** (required for `!` text commands)
5. **OAuth2 → URL Generator** — select:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Mute Members`, `Send Messages`, `Embed Links`, `Read Message History`
6. Copy the generated URL → paste in browser → invite the bot to your server

### 2 — Clone and configure

```bash
git clone https://github.com/your-org/flowt-discord-bot
cd flowt-discord-bot
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-server-id     # optional — makes commands register instantly

FLOWT_API_BASE=https://flowtapi.duckdns.org  # or your self-hosted URL

BOT_PREFIX=!           # text command prefix
DEFAULT_VOLUME=80      # 0–100
DEFAULT_CROSSFADE_MS=0 # 0 = off
```

No `FLOWT_ADMIN_TOKEN` needed — playlists are fetched from the public API.

### 3 — Install

```bash
npm install
```

> **System dependency:** `ffmpeg` must be available. `ffmpeg-static` bundles it automatically on most platforms; if you see errors, install it manually: `apt install ffmpeg` / `brew install ffmpeg`.

### 4 — Deploy slash commands (once)

```bash
DEPLOY_COMMANDS=1 node src/bot.mjs
```

- With `DISCORD_GUILD_ID` set: registers instantly to that server (great for dev)
- Without it: registers globally (takes up to 1 hour to propagate)

### 5 — Start the bot

```bash
npm start          # production
npm run dev        # development (auto-restarts on file changes)
```

---

## Command reference

All commands work as both `/slash` and `!text` form.

### Playback

| Slash | Text | Description |
|-------|------|-------------|
| `/play <source>` | `!play <source>` `!p` | Queue a source (see below) |
| `/discover` | `!discover` | Queue the full Flowt discover feed |
| `/skip` | `!skip` `!s` | Skip current track |
| `/pause` | `!pause` | Pause |
| `/resume` | `!resume` `!r` | Resume |
| `/stop` | `!stop` | Stop and disconnect |
| `/nowplaying` | `!np` `!nowplaying` | Show current track |

### Sources for `/play`

| Source | What it plays |
|--------|--------------|
| `@discover` | Combined feed of all Flowt users |
| `@alice` | Everything @alice has posted on Flowt |
| YouTube URL | That video's audio stream |
| Suno URL | That Suno track |
| GEOFF URL | That GEOFF track |

### Queue management

| Slash | Text | Description |
|-------|------|-------------|
| `/queue` | `!queue` `!q` | Show queue (up to 12 entries) |
| `/shuffle` | `!shuffle` | Shuffle remaining tracks |
| `/remove <pos>` | `!remove <pos>` `!rm` | Remove track at position |
| `/loop <mode>` | `!loop <off\|track\|queue>` | Loop mode |

### Settings

| Slash | Text | Description |
|-------|------|-------------|
| `/volume <0-100>` | `!volume <0-100>` `!vol` | Set playback volume |
| `/crossfade <seconds> [style]` | `!crossfade <seconds> [style]` `!cf` | Crossfade between tracks |

### Crossfade styles

| Style | Curve |
|-------|-------|
| `smooth` | Hermite S-curve (default — matches Android app) |
| `linear` | Straight ramp |
| `cinematic` | Cosine ease |
| `quick` | Accelerated (1.65× linear) |

```
!crossfade 4 cinematic    ← 4-second cinematic fade
!crossfade 0              ← Disable crossfade
/crossfade 6 smooth
```

---

## Stage channel setup

1. Create a **Stage** channel (e.g. *Flowt Radio*)
2. Give the bot the **Stage Moderator** role so it can speak without manual approval
3. Use `/play @discover` or `!discover` to start the feed
4. Members join as audience and listen live

Without Stage Moderator, the bot will request to speak — a moderator must approve it manually each time.

---

## How source resolution works

The bot reuses the same pipeline as the Flowt web and Android clients:

| Source | Resolution method |
|--------|------------------|
| **YouTube** | `ytdl-core` extracts the highest-quality audio-only stream |
| **Suno** | CDN link is already a direct audio URL — streamed directly |
| **GEOFF** | `POST /api/v1/media/resolve/geoff` → CDN URL → streamed |
| **@username** | `GET /api/v1/ripples?username=<u>` → extract media URLs from ripples |
| **@discover** | `GET /api/v1/ripples` → same extraction, all users |

Crossfade is ported directly from `FlowtAudioService.kt` (four curve styles, 0–12 s range, per-frame volume ramp via discord.js inline volume API).

---

## Project structure

```
flowt-discord-bot/
├── src/
│   ├── bot.mjs           Discord client, event wiring, graceful shutdown
│   ├── config.mjs        Typed env-var config
│   ├── flowt-api.mjs     Public Flowt API client (no auth)
│   ├── player.mjs        GuildPlayer — queue, streams, crossfade, volume
│   ├── play-action.mjs   Shared play logic (slash + text share one path)
│   ├── utils.mjs         Embeds, voice-channel helpers, text arg parsing
│   └── commands/
│       ├── slash.mjs     Slash command definitions + handlers
│       └── text.mjs      Text command router + handlers
├── .env.example
├── .gitignore
└── package.json
```

---

## Troubleshooting

**Bot joins but no audio**
- Run `node -e "require('ffmpeg-static')"` — if it throws, reinstall: `npm install ffmpeg-static`
- Run `npm rebuild` to recompile `@discordjs/opus`

**"Could not connect within 20s"**
- Check the bot has `Connect` + `Speak` permissions in the channel

**Text commands not working**
- Ensure **Message Content Intent** is enabled in the Discord Developer Portal → Bot tab

**`@username` returns no tracks**
- That user may have no ripples with media embeds yet
- Try `@discover` to confirm the API is reachable

**Slash commands not appearing**
- Rerun `DEPLOY_COMMANDS=1 node src/bot.mjs`
- For global commands, wait up to 1 hour
- Use `DISCORD_GUILD_ID` for instant guild registration

**YouTube errors / stream failures**
- `ytdl-core` sometimes needs updating after YouTube changes: `npm update ytdl-core`
