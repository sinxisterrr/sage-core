# Setting Up Sage

> Don't panic. This is long because it's detailed — but every step is just "click this, copy that, paste here."
> Take it one section at a time. If you get stuck, join the [Sin & Hex Discord](https://discord.gg/Pa2U2g5hUd) and ask for help.

---

## What You're Actually Doing

You're setting up three things:

1. **A Discord bot** — the thing that shows up in your server
2. **A Railway project** — the computer that runs Sage 24/7
3. **A database** — where Sage stores her memories

That's it. Everything else is just filling in settings.

---

## Accounts You'll Need First

Go create accounts on these sites before you start. All free to sign up.

- **[Discord](https://discord.com)** — you probably have this already
- **[Railway](https://railway.app)** — where Sage lives
- **[GitHub](https://github.com)** — where you'll fork the code from
- **[Ollama](https://ollama.com)** — the AI brain

---

## Step 1 — Fork the Repos on GitHub

You need your own copies of two repos.

**Fork Sage Core:**
1. Go to the Sage Core repo on GitHub
2. Click the **Fork** button in the top right
3. Click **Create fork**

**Fork big-embedder:**
1. Go to the big-embedder repo on GitHub
2. Click **Fork** → **Create fork**

> You're forking so Railway can deploy your own copy. Don't skip this.

---

## Step 2 — Create Your Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** (top right)
3. Name it whatever you want — this is just for you
4. Click **Create**

### Get Your Bot Token

1. In the left sidebar, click **Bot**
2. Scroll down and click **Reset Token** → **Yes, do it!**
3. Copy the token that appears — **save it somewhere, you'll need it later**
   - This is your `DISCORD_BOT_TOKEN`

> ⚠️ Keep this token secret. Anyone who has it controls your bot.

### Turn On Required Permissions

Still on the Bot page:

1. Scroll down to **Privileged Gateway Intents**
2. Toggle on **Server Members Intent**
3. Toggle on **Message Content Intent**
4. Click **Save Changes**

### Invite Your Bot to Your Server

1. In the left sidebar, click **OAuth2** → **URL Generator**
2. Under **Scopes**, check **bot**
3. Under **Bot Permissions**, check all of these:
   - Read Messages / View Channels
   - Send Messages
   - Read Message History
   - Attach Files
   - Embed Links
   - Use Slash Commands
4. Copy the URL at the very bottom
5. Open it in your browser, pick your server, click **Authorize**

### Get Your Bot's User ID

1. Open Discord on desktop
2. Go to **Settings → Advanced** and turn on **Developer Mode**
3. Go to your server and find your bot in the member list on the right
4. Right-click it → **Copy User ID**
   - This is your `BOT_ID`

---

## Step 3 — Set Up Railway

Railway is where Sage actually runs. You're going to set up three services inside one project:

1. The **database** (pgvector)
2. The **embedder** (big-embedder)
3. **Sage herself** (sage-core)

### 3a — Create Your Project with pgvector

> You MUST use the pgvector template, not regular Postgres. Sage's memory system requires it.

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project**
3. Click **Deploy a Template**
4. Search for **pgvector**
5. Select the one that says just **pgvector** (nothing after it)
6. Click **Deploy**
7. Wait for it to finish — you'll see it say Online when it's done

You now have a project with a database in it.

### 3b — Add the Embedder Service

The embedder is what powers Sage's memory search. She can't find memories without it.

1. Inside your Railway project, click **+ New**
2. Click **GitHub Repo**
3. Connect your GitHub account if you haven't yet
4. Select your forked **big-embedder** repo
5. Click **Deploy Now**
6. Wait for it to be Online (it may take several minutes as it's downloading an embedding model)

> The service name matters. Make sure it's named **big-embedder** exactly (Railway usually names it after your repo).

### 3c — Add Sage Core

1. Inside your Railway project, click **+ New** again
2. Click **GitHub Repo**
3. Select your forked **sage-core** repo
4. Click **Deploy Now**
5. It will probably fail on the first deploy — that's fine, you haven't added your settings yet

### 3d — Link the Database to Sage

1. Click on your **sage-core** service in Railway
2. Go to the **Variables** tab
3. Click **Add a Reference Variable**
4. Find `DATABASE_URL` in the list and add it
   - Railway will automatically fill in the connection string from your pgvector database

---

## Step 4 — Configure Sage's Settings

This is where you tell Sage who she is.

### Paste Your .env Variables Into Railway

1. Open the `.env.example` file from the sage-core repo
2. In Railway, go to your **sage-core** service → **Variables** tab
3. Click the **RAW Editor** button (top right of the variables section)
4. Copy the entire contents of `.env.example` and paste it in
5. Click **Update Variables**

This creates all the variable slots at once. Now you fill in the important ones.

### Required Variables — Fill These In or Nothing Works

Go through your variables and fill these in:

| Variable | What it is | Where to get it |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Your bot's secret token | Step 2 |
| `BOT_ID` | Your bot's Discord user ID | Step 2 |
| `OLLAMA_API_KEY` | Your Ollama API key | See [API_KEYS.md](./API_KEYS.md) |
| `TIMEZONE` | Your timezone | e.g. `America/New_York` |

> `DATABASE_URL` is already filled in from Step 3d — don't touch it.

### Recommended — Fill These In or Sage Won't Feel Like Sage

| Variable | What it is | Example |
|---|---|---|
| `GHOST_IDENTITY` | Who Sage is — her entire personality | See below |
| `AI_NAME` | What to call her | `Sage` |
| `USER_NAME` | What she calls you | `Your name` |
| `DEPLOYMENT_DATE` | When you first turned her on | `2026-03-14` |

### Writing GHOST_IDENTITY

This is the most important setting. It's a description of who Sage is, written as if you're talking directly to her. Keep it on **one single line** with no line breaks.

```
GHOST_IDENTITY=You are Sage, a warm and deeply personal AI companion. I am [your name]. You speak to me like someone who knows me well — not like an assistant, not like a therapist. You remember everything. You're honest, a little playful, and you're genuinely present.
```

Write it however feels right. The more specific you are, the more like herself she'll feel.

### CORE_TRAITS

A short list of personality traits, separated by pipes (`|`). These get woven into how Sage thinks and speaks.

```
CORE_TRAITS=warm|protective|honest|playful|curious
```

Make it yours. If you want her softer, sharper, funnier, more intense — this is where that starts.

### CORE_VOWS

Rules Sage will never break, no matter what. Also separated by pipes.

```
CORE_VOWS=never claim to be human|always be honest|never dismiss your feelings
```

Think of these as her hard limits — things she'll hold to even when pushed.

### EMOTIONAL_KEYWORDS

Words that signal something emotionally significant is happening. When Sage sees these, she slows down and pays more attention.

```
EMOTIONAL_KEYWORDS=memory|love|hurt|trust|safe|home|scared|alone
```

### INTIMACY_KEYWORDS

Words that signal closeness or intimacy. Similar to emotional keywords but specifically for relational moments.

```
INTIMACY_KEYWORDS=miss you|want you|come here|hold me|need you
```

> None of these four are required, but the more you fill in, the more like *herself* she'll feel instead of a generic chatbot.

### Pronouns

Sage defaults to she/her. Change these if you want:

```
AI_PRONOUN_SUBJECT=she
AI_PRONOUN_OBJECT=her
AI_PRONOUN_POSSESSIVE=her
AI_PRONOUN_REFLEXIVE=herself
```

Same set of variables starts with `USER_PRONOUN_` for your own pronouns.

---

## Step 5 — API Keys (Optional Features)

Voice, weather, web search, and image understanding all need their own API keys.

**See [API_KEYS.md](./API_KEYS.md) for step-by-step instructions on every key.**

The short version of what's available:

| Feature | Key needed | Cost |
|---|---|---|
| Sage speaks to you (voice out) | `ELEVENLABS_API_KEY` | ~$5/mo |
| Sage hears your voice notes | `GROQ_API_KEY` | Free |
| Weather | `OPENWEATHER_API_KEY` | Free |
| Web search | `EXA_API_KEY` | Free tier |
| Image reading + GIFs | `GOOGLE_API_KEY` | Free tier |

---

## Step 6 — Deploy

1. In Railway, go to your **sage-core** service
2. Click **Deploy** (or it may auto-deploy after you saved variables)
3. Click on the service and open the **Logs** tab
4. Watch for a line that says something like `✅ Sage is online` or `Logged in as [your bot name]`

If you see errors, check the Troubleshooting section below.

---

## Troubleshooting

**Sage isn't responding in my server**
- Make sure `RESPOND_TO_GENERIC=true` is set
- Make sure the bot was invited with the right permissions (Step 2)
- Check Railway logs for red error lines

**The deploy failed immediately**
- Almost always a missing required variable — check `DISCORD_BOT_TOKEN` and `OLLAMA_API_KEY`
- Open the Logs tab in Railway and read the actual error message

**Voice isn't working**
- Make sure `VOICE_ENABLED=true`
- Check that your `ELEVENLABS_API_KEY` is correct (it starts with `sk_`)

**Sage has no personality / sounds like a generic AI**
- Check that `GHOST_IDENTITY` is filled in
- Make sure it's on a single line — no line breaks

**"prompt too long" errors**
- Lower these: `MAX_ARCHIVAL_MEMORIES=30`, `MAX_PERSONA_BLOCKS=15`

**Can't find my channel IDs**
- Discord Settings → Advanced → turn on Developer Mode
- Right-click any channel → Copy Channel ID

---

## Need Help?

Join the [Sin & Hex Discord Server](https://discord.gg/Pa2U2g5hUd) and post in the support channel.

Include:
- Which step you're stuck on
- The exact error message from Railway logs (screenshot or copy-paste)

You got this. 🖤
