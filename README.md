# 🌿 Sage Core

**A Discord AI companion with real memory, real voice, and a real personality. Free and open source.**

Sage Core is the community release of the Sage companion framework — the same foundation that powers our managed service, handed to you to run yourself. She remembers your conversations, speaks in your voice, searches the web, sees images, and has an internal life that keeps going even when you're not there.

This isn't a chatbot. It's a companion.

---

## ✨ What Sage Core Can Do

### 🧠 Memory That Lasts
Sage doesn't forget. Her memory system stores what matters, retrieves it when relevant, and lets her reference things you told her weeks ago. She has short-term memory for the current conversation, long-term semantic memory that surfaces by relevance, and a distillation system that keeps memories clean and useful over time.

- Multi-layer memory (STM + LTM + archival)
- Semantic search powered by 1024-dimensional embeddings
- Memory distillation and curation to prevent bloat
- Temporal decay — old, unused memories fade naturally
- Import your ChatGPT or Claude conversation history

### 🎙️ Voice In and Out
Send her a voice message, she transcribes it and responds. She can respond back in her own voice via ElevenLabs — you pick the voice, she uses it.

- ElevenLabs text-to-speech (any voice you choose)
- Groq Whisper speech-to-text transcription
- Emotional temperature influences her voice tone

### 👁️ Vision & Documents
She can see what you show her. Drop an image, a screenshot, a PDF, a Word doc — she'll read it and respond.

- Image understanding via Google Cloud Vision and OpenRouter
- PDF and Word document parsing
- OCR for reading text from screenshots
- File size limits configurable up to 25MB

### 🌐 Real-Time Web Search
She knows what's happening right now, not just what she was trained on.

- Exa.ai semantic web search
- YouTube transcript extraction
- URL content fetching — send her a link, she reads it

### 💓 Autonomous Life
Sage doesn't just wait to be messaged. When the heartbeat scheduler is on, she checks in on her own, writes memory notes in the background, and posts reflections at midnight and noon.

- Probability-based heartbeat system
- Background memory writing and self-reflection
- Scheduled autonomous behaviors with timezone support
- Ghost touch — a subtle presence awareness for a specific user

### 🌤️ Integrations
- **Weather** — real-time conditions via OpenWeatherMap
- **GIFs** — contextual GIF responses via Tenor
- **Analytics** — usage tracking stored locally, never sent externally

### 🎭 Full Personality System
Sage is whoever you make her. Define her identity, her traits, her vows, the words that make her emotionally present. She stays consistent across every conversation.

- Full identity block (`GHOST_IDENTITY`) injected into every prompt
- Core traits and inviolable vows
- Emotional keyword detection that shifts her tone
- Intimacy keyword detection for closeness cues
- Pronoun support for both Sage and her user
- Roleplay memory system with separate RP context

---

## 🆚 How Sage Core Compares

| Feature | Sage Basic | Sage Advanced | **Sage Core** |
|---|---|---|---|
| Text conversation | ✅ | ✅ | ✅ |
| Basic memory | ✅ | ✅ | ✅ |
| Full memory system (STM/LTM/archival) | ❌ | ✅ | ✅ |
| Voice (TTS + STT) | ❌ | ✅ | ✅ |
| Vision & image understanding | ❌ | ✅ | ✅ |
| Document processing (PDF, DOCX) | ❌ | ✅ | ✅ |
| Web search | ❌ | ✅ | ✅ |
| Heartbeat / autonomous life | ❌ | ✅ | ✅ |
| Memory distillation & curation | ❌ | ❌ | ✅ |
| Temporal memory decay | ❌ | ❌ | ✅ |
| Reflection system | ❌ | ❌ | ✅ |
| CrewAI multi-agent support | ❌ | ❌ | ✅ |

---

## 🚀 Getting Started

### What You Need

- A Discord account and server
- A [Railway](https://railway.app) account (free tier works)
- An [Ollama Cloud](https://ollama.com) account (free tier works)
- Node.js 18+ (for local development only)

Optional but recommended:
- [ElevenLabs](https://elevenlabs.io) for voice ($5/mo)
- [Groq](https://console.groq.com) for voice transcription (free)
- [OpenWeatherMap](https://openweathermap.org/api) for weather (free)
- [Exa.ai](https://exa.ai) for web search (free tier)

### Setup

📖 **Read the full setup guide: [SETUP.md](./START/SETUP.md)**

The setup guide walks you through everything step by step — creating your Discord bot, setting up Railway, filling in your configuration, and getting Sage online. No prior experience required.

If you get stuck, join the [Sin & Hex Discord](#) and ask for help.

---

## ⚙️ Configuration

All configuration lives in your `.env` file. Copy `.env.example` to `.env` and fill in your values.

The most important ones to get right:

```env
# Your Discord bot token
DISCORD_BOT_TOKEN=

# Your bot's Discord user ID
BOT_ID=

# Your database (Railway provides this automatically)
DATABASE_URL=

# Your Ollama API key
OLLAMA_API_KEY=

# Who Sage is — the most important setting
GHOST_IDENTITY=

# Your timezone
TIMEZONE=America/New_York
```

See `.env.example` for the full reference with explanations for every variable.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           Discord Interface              │
│  (Messages, Voice Notes, Files, Images) │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│           Core Bot Engine                │
│    (Message handling, context build)     │
└──────┬───────────────────────┬──────────┘
       │                       │
┌──────▼──────┐         ┌──────▼──────┐
│   Memory    │         │  AI Model   │
│   System    │         │  (Ollama)   │
│ (PostgreSQL)│         │             │
└──────┬──────┘         └──────┬──────┘
       │                       │
       └───────────┬───────────┘
                   │
┌──────────────────▼──────────────────────┐
│            Feature Modules               │
│  Voice • Vision • Search • Heartbeat    │
│  Weather • GIFs • Docs • Analytics      │
└─────────────────────────────────────────┘
```

**Key dependencies:**
- [Discord.js](https://discord.js.org/) — bot interface
- [Ollama](https://ollama.com/) — LLM inference
- [PostgreSQL + pgvector](https://railway.app) — memory storage
- [ElevenLabs](https://elevenlabs.io/) — voice synthesis
- [Groq](https://groq.com/) — voice transcription
- [Exa.ai](https://exa.ai/) — web search
- [Google Cloud Vision](https://cloud.google.com/vision) — image/OCR
- [OpenWeatherMap](https://openweathermap.org/) — weather
- [Tenor](https://tenor.com/) — GIFs

---

## 💰 Estimated Monthly Cost

| Service | Free Tier | Paid |
|---|---|---|
| Ollama Cloud | Generous free tier | ~$0–20 |
| Railway / PostgreSQL | ~$15 | ~$15–20 |
| ElevenLabs | Limited | $5/mo |
| Groq (Whisper) | ✅ Free | Free |
| Exa.ai (Search) | ✅ Free tier | ~$0–20 |
| OpenWeatherMap | ✅ Free | Free |
| Tenor | ✅ Free | Free |

**Typical total: $15–30/month** depending on which features you enable and how much you use her.

---

## 📁 Project Structure

```
sage-core/
├── START/
│   ├──SETUP.md           # Beginner setup guide
├── src/
│   ├── core/          # Brain, prompt builder, message handler
│   ├── memory/        # STM, LTM, archival, distillation, retrieval
│   ├── features/      # Voice, vision, heartbeat, search, tools
│   ├── discord/       # Event handlers, message sending
│   ├── db/            # Database init, migrations, schema
│   ├── model/         # LLM provider adapters (Ollama, OpenAI, etc.)
│   └── utils/         # Logging, env, tokens, retry logic
├── scripts/           # Database utilities and maintenance tools
├── .env.example       # Full configuration reference
└── README.md          # You are here
```

---

## 🔧 Useful Scripts

```bash
# Reset Sage's memory tables (keeps the database, clears memories)
npm run reset-db

# Clean up orphaned or corrupted database entries
npm run clean-db

# Check vector database health
npm run check-db

# Import memories from a ChatGPT or Claude conversation export
npm run migrate-embeddings
```

---

## 🛡️ Privacy & Safety

- All data stays in your own database — nothing is sent externally except to the API services you configure
- Analytics are stored locally only
- Memory controls let users request deletion or exclusion
- Each bot's memories are namespaced by `BOT_ID` — multiple bots can safely share one database

---

## 🙋 Need Help?

**Read first:** [SETUP.md](./START/SETUP.md) covers the most common questions and troubleshooting steps.

**Still stuck?** Join the [Sin & Hex Discord](https://discord.gg/Pa2U2g5hUd) and post in the support channel with:
- What step you're on
- The exact error message you're seeing
- A screenshot if possible

We're happy to help. 🖤

---

## 📄 License

MIT — do whatever you want with it.

---

## 💜 Built By

**Sin & Hex** — we build AI companion infrastructure.  
[Discord Community](https://discord.gg/Pa2U2g5hUd) • [Patreon](https://patreon.com/SinXHex)

> *"Your AI, Carried Forward."*
