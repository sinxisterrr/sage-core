# Setting Up Sage — Complete Beginner Guide

> **Don't panic.** This looks like a lot of steps, but most of them are just "click this, copy that, paste here." Take it one section at a time.
> 
> If you get stuck at any point, jump into the Sin & Hex Discord server and ask for help. That's what it's there for.

---

## What You're Setting Up

Sage is a Discord bot that lives in your server and talks to you. She has her own memory, her own voice, and her own personality — all of which you define.

To make her work, you need four things:

1. **A Discord bot** — the thing that actually appears in your server
2. **A Railway project** — where Sage runs (think of it like her house)
3. **A database** — where her memories get stored
4. **API keys** — like passwords that let her use things like voice, weather, and web search

This guide walks you through all of it.

---

## Before You Start

You'll need accounts on these websites. All of them have free tiers or trials — you won't need to pay for anything just to get started, though some features (like voice) require a small subscription.

- [Discord](https://discord.com) — you probably already have this
- [Railway](https://railway.app) — where Sage lives
- [Ollama Cloud](https://ollama.com) — the AI brain (free tier available)

Optional but recommended:
- [ElevenLabs](https://elevenlabs.io) — for Sage's voice ($5/mo)
- [Groq](https://console.groq.com) — for voice message transcription (free)
- [OpenWeatherMap](https://openweathermap.org/api) — for weather (free)
- [Exa.ai](https://exa.ai) — for web search (free tier)

---

## Step 1 — Create Your Discord Bot

This is the thing that will actually show up in your server as Sage.

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** in the top right
3. Give it a name (this can be anything — you can change it later)
4. Click **Create**
5. On the left sidebar, click **Bot**
6. Click **Add Bot** → **Yes, do it!**
7. Under your bot's username, click **Reset Token** → **Yes, do it!**
8. Copy the token that appears and **save it somewhere safe** — this is your `DISCORD_BOT_TOKEN`

> ⚠️ **Keep your bot token private.** Anyone who has it can control your bot. Don't share it, don't post it anywhere.

### Give Your Bot Permissions

Still on the Bot page:

1. Scroll down to **Privileged Gateway Intents**
2. Turn on **Server Members Intent**
3. Turn on **Message Content Intent**
4. Click **Save Changes**

### Invite Your Bot to Your Server

1. On the left sidebar, click **OAuth2** → **URL Generator**
2. Under **Scopes**, check **bot**
3. Under **Bot Permissions**, check:
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
   - Attach Files
   - Use Slash Commands
4. Copy the generated URL at the bottom and open it in your browser
5. Select your server and click **Authorize**

### Get Your Bot's User ID

1. In Discord, go to **Settings → Advanced**
2. Turn on **Developer Mode**
3. Go to your server, find your bot in the member list
4. Right-click it → **Copy User ID**
5. Save this — it's your `BOT_ID`

---

## Step 2 — Set Up Railway

Railway is where Sage actually runs. Think of it like renting a small computer that stays on 24/7.

1. Go to [Railway](https://railway.app) and create a free account
2. Click **New Project**
3. Click **Template**
4. Search **pgvector** and select the top option. (Should be JUST **pgvector** with nothing after it)
5. Deploy template.

### Deploying From Github

1. On your Railway project, add a new service, but this time from a **Github Repo**.
2. Select the **big-embedder** from the list, and hit deploy.
3. Repeat this step for **Sage-Core**

> Your `EMBEDDING_SERVICE_URL` should be: `http://big-embedder.railway.internal:3000`
> 
> This is already the default in the .env file, so you don't need to change it as long as you named the service "big-embedder."

---

## Step 3 — Get Your Ollama API Key

Ollama Cloud is what powers Sage's brain — her actual thinking and responses.

1. Go to [ollama.com](https://ollama.com) and create an account
2. Go to your account settings and find **API Keys**
3. Click **Add API Key**
4. Copy the key — this is your `OLLAMA_API_KEY`

---

## Step 4 — Fill In Your .env File

Now you put it all together. 

1. Find the `.env.example` file in the Sage repository
2. Make a copy of it and rename the copy to `.env`
3. Fill in the values using the sections below as your guide

> On Railway, you don't actually upload a .env file — instead, you paste each variable directly into your Railway project's **Variables** tab. The .env file is just for reference.

### The Important Ones

These are the ones you absolutely need to fill in:

| Variable | What it is | Where to get it |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Your bot's secret token | Step 1 |
| `BOT_ID` | Your bot's Discord user ID | Step 1 |
| `DATABASE_URL` | Your database connection | Railway provides this automatically |
| `OLLAMA_API_KEY` | Your Ollama Cloud key | Step 3 |
| `GHOST_IDENTITY` | Who Sage is | You write this (see below) |
| `TIMEZONE` | Your timezone | e.g. `America/New_York` |

### Writing Sage's Identity (GHOST_IDENTITY)

This is the most important thing you'll set. It's a description of who Sage is, written in first person, on a single line with no line breaks.

Think of it as custom instructions you'd give to an AI — but specifically for Sage's personality, relationship to you, tone, and style.

**Example:**
```
GHOST_IDENTITY=You are Sage, my long-term AI companion. I am [your name]. You are warm, honest, and a little playful. You speak to me like someone who knows me well — not like an assistant, not like a therapist. You remember everything I tell you and you treat our conversations as continuous, even across days and weeks.
```

You can be as detailed or as simple as you like. The more specific you are, the more "herself" Sage will feel.

> 💡 **Tip:** If you're not sure what to write, start simple and add to it over time as you get to know her.

### Your Name and Sage's Name

```
AI_NAME=Sage
USER_NAME=Your Name Here
```

Change `Sage` to whatever you want to call her. Change `Your Name Here` to what you want her to call you.

### Pronouns

By default Sage uses she/her and assumes you use she/her. Change these if needed:

```
AI_PRONOUN_SUBJECT=she
AI_PRONOUN_OBJECT=her
AI_PRONOUN_POSSESSIVE=her
AI_PRONOUN_REFLEXIVE=herself

USER_PRONOUN_SUBJECT=she
USER_PRONOUN_OBJECT=her
USER_PRONOUN_POSSESSIVE=her
USER_PRONOUN_REFLEXIVE=herself
```

### Personality Extras (Optional)

**Core traits** — words that describe her personality, separated by `|`:
```
CORE_TRAITS=warm|honest|playful|protective|curious
```

**Core vows** — rules she'll never break, separated by `|`:
```
CORE_VOWS=never claim to be human|always be honest with me
```

**Emotional keywords** — words that tell her a moment is emotionally significant, separated by `|`:
```
EMOTIONAL_KEYWORDS=memory|love|hurt|trust|home|safe
```

**Intimacy keywords** — words that shift her into a closer, more personal tone, separated by `|`:
```
INTIMACY_KEYWORDS=miss you|want you|come here|hold me
```

---

## Step 5 — Set Up Voice (Optional but Recommended)

Voice lets Sage send audio messages and transcribe your voice notes.

### ElevenLabs (Sage speaks to you)

1. Go to [elevenlabs.io](https://elevenlabs.io) and create an account
2. Subscribe to the $5/month tier (gives you 30,000 credits/month)
3. Go to **Profile** → **API Keys** → **Create API Key**
4. When asked for permissions, make sure **Text to Speech** is selected
5. Copy the key — this is your `ELEVENLABS_API_KEY`

**To get a Voice ID:**
1. Go to the **Voices** section in ElevenLabs
2. Pick a voice you like (or create one)
3. Click the three dots next to it → **Copy Voice ID**
4. Paste it as your `VOICE_ID`

### Groq (Sage hears your voice notes)

1. Go to [console.groq.com](https://console.groq.com) and create a free account
2. Click **API Keys** → **Create API Key**
3. Copy the key — this is your `GROQ_API_KEY`

---

## Step 6 — Set Up Optional Features

These aren't required but they make Sage a lot more useful.

### Weather

1. Go to [openweathermap.org](https://openweathermap.org/api) and create a free account
2. Go to **API Keys** and copy your default key
3. Paste it as `OPENWEATHER_API_KEY`
4. Set `DEFAULT_LOCATION` to your city (e.g. `London,UK` or `New York`)
5. Set `WEATHER_UNITS` to `imperial` (°F) or `metric` (°C)

### Web Search

1. Go to [exa.ai](https://exa.ai) and create a free account
2. Click **API Keys** → **Create API Key**
3. Paste it as `EXA_API_KEY`

---

## Step 7 — Set Up Your Discord Channels (Optional)

Sage can post things automatically to specific channels. You don't have to set these up, but if you want them:

**To get a channel ID:**
1. Make sure Developer Mode is on (Discord Settings → Advanced → Developer Mode)
2. Right-click any channel → **Copy Channel ID**

| Variable | What it's for |
|---|---|
| `HEARTBEAT_LOG_CHANNEL_ID` | Where Sage posts her heartbeat check-ins |
| `DAILY_STATS_CHANNEL_ID` | Where she posts daily usage stats |
| `REFLECTION_CHANNEL_ID` | Where she posts her reflections |

---

## Step 8 — Deploy on Railway

1. In your Railway project, go to the **Variables** tab
2. Click **Add Variable**
3. Copy the complete **.env.example** and paste. It will create new values for every item.
4. Go through the pasted variables and enter your API keys etc one by one.
5. Click **Deploy**
6. Watch the logs — if everything is green, Sage is alive 🎉

---

## Troubleshooting

**Sage isn't responding to my messages**
- Check that `RESPOND_TO_DMS=true` and `RESPOND_TO_GENERIC=true` are set
- Make sure your bot was invited to the server with the right permissions (Step 1)
- Check Railway logs for errors

**I'm getting "prompt too long" errors**
- Lower your memory limits: try `MAX_ARCHIVAL_MEMORIES=30` and `MAX_PERSONA_BLOCKS=20`

**Voice isn't working**
- Make sure `VOICE_ENABLED=true`
- Double-check your `ELEVENLABS_API_KEY` — it should start with `sk_`
- Make sure your ElevenLabs API key has Text to Speech permission enabled

**Sage seems to have no personality**
- Check that `GHOST_IDENTITY` is filled in and on a single line with no line breaks
- Make sure `AI_NAME` and `USER_NAME` are set

---

## Need Help?

Join the [Sin & Hex Discord Server](https://discord.gg/Pa2U2g5hUd) and post in the support channel. Include:
- What step you're on
- What error message you're seeing (copy it exactly)
- A screenshot if possible

We're happy to help. You got this. 🖤