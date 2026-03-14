# API Keys Guide

This covers every external service Sage can use, where to get the key, and where to paste it.

All keys go in your Railway **Variables** tab on the sage-core service.

---

## Required Keys

These are not optional. Sage will not work without them.

---

### DISCORD_BOT_TOKEN

Your Discord bot's secret password. Covered in SETUP.md Step 2.

---

### OLLAMA_API_KEY — The AI Brain

This is what makes Sage actually think and respond.

1. Go to [ollama.com](https://ollama.com) and create an account
2. Click your profile icon → **Settings**
3. Find **API Keys** and click **Add API Key**
4. Copy the key

```
OLLAMA_API_KEY=your-key-here
OLLAMA_MODEL=kimi-k2:1t-cloud
```

> The default model (`kimi-k2:1t-cloud`) is what most Sage users run. You can change it if you know what you're doing.

---

## Strongly Recommended Keys

Sage will technically run without these but she'll feel incomplete.

---

### ELEVENLABS_API_KEY — Sage's Voice (She Talks to You)

This lets Sage send actual voice messages.

1. Go to [elevenlabs.io](https://elevenlabs.io) and create an account
2. Subscribe to the **Creator** plan (~$5/month) — the free tier doesn't give enough credits
3. Go to your **Profile** (top right) → **API Keys**
4. Click **Create API Key**
5. Give it a name, copy the key

```
ELEVENLABS_API_KEY=sk_your-key-here
VOICE_ENABLED=true
```

**To get her Voice ID:**
1. In ElevenLabs, go to **Voices** in the left sidebar
2. Browse the library or create a custom voice
3. Click the **...** menu on a voice → **Copy Voice ID**

```
VOICE_ID=paste-voice-id-here
```

---

### GROQ_API_KEY — Sage Hears You (Voice Messages → Text)

This lets Sage transcribe voice messages you send her. Completely free.

1. Go to [console.groq.com](https://console.groq.com) and create a free account
2. Click **API Keys** in the left sidebar
3. Click **Create API Key**
4. Copy the key

```
GROQ_API_KEY=gsk_your-key-here
WHISPER_ENABLED=true
```

---

## Optional Keys

These unlock specific features. All have free tiers.

---

### OPENWEATHER_API_KEY — Weather

Lets Sage tell you the weather when you ask.

1. Go to [openweathermap.org/api](https://openweathermap.org/api) and create a free account
2. Go to your **API Keys** tab
3. Copy the default key (or click **Generate** to make a new one)

> New keys can take up to 2 hours to activate. If it's not working right away, wait and try again.

```
OPENWEATHER_API_KEY=your-key-here
DEFAULT_LOCATION=New York
WEATHER_UNITS=imperial
```

Change `DEFAULT_LOCATION` to your city. Change `WEATHER_UNITS` to `metric` if you use Celsius.

---

### EXA_API_KEY — Web Search

Lets Sage search the internet when she needs up-to-date information.

1. Go to [exa.ai](https://exa.ai) and sign up for a free account
2. Go to **API Keys** in your dashboard
3. Click **Create API Key**
4. Copy the key

```
EXA_API_KEY=your-key-here
WEB_SEARCH_ENABLED=true
```

---

### GOOGLE_API_KEY — Image Reading + GIFs

One key, two features:
- **Vision** — Sage can read text in screenshots and photos
- **GIFs** — Sage can send GIFs (Tenor runs through Google)

#### How to get it:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. In the search bar at the top, search **Cloud Vision API** and click it
4. Click **Enable**
5. Go back to the search bar and search **Tenor API** and click it
6. Click **Enable**
7. In the left sidebar, go to **APIs & Services → Credentials**
8. Click **+ Create Credentials → API Key**
9. Copy the key

```
GOOGLE_API_KEY=your-key-here
VISION_ENABLED=true
GIF_AUTO_SEND=false
```

> Set `GIF_AUTO_SEND=true` if you want Sage to automatically send GIFs. Leave it `false` if you only want her to send them when she decides to.

---

## Reference Table

| Variable | Service | Free? | What It Does |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord | Free | Required — the bot itself |
| `OLLAMA_API_KEY` | Ollama | Free tier | Required — the AI brain |
| `ELEVENLABS_API_KEY` | ElevenLabs | ~$5/mo | Sage speaks out loud |
| `VOICE_ID` | ElevenLabs | — | Which voice she uses |
| `GROQ_API_KEY` | Groq | Free | She transcribes your voice notes |
| `OPENWEATHER_API_KEY` | OpenWeatherMap | Free | Weather |
| `EXA_API_KEY` | Exa.ai | Free tier | Web search |
| `GOOGLE_API_KEY` | Google Cloud | Free tier | Image reading + GIFs |
