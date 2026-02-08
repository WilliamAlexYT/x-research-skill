# x-research-skill

X/Twitter research skill for [Claude Code](https://code.claude.com) and [OpenClaw](https://openclaw.ai). Agentic search, thread following, deep-dives, sourced briefings.

## What it does

Turns Claude into an X/Twitter research agent. Ask questions like "what are people saying about BNKR" or "search X for Opus 4.6 trading" and get sourced briefings with engagement data, thread context, and linked resources.

## v2: CLI Tooling (New)

v2 adds `x-search.ts` — a Bun CLI that wraps the X API, so Claude doesn't need to assemble raw curl commands. Same research loop, much faster execution.

**What changed:**
- `x-search.ts` handles search, profiles, threads, single tweet lookups
- 15-minute result cache (saves API costs on repeated queries)
- Built-in engagement sorting and filtering (`--sort likes`, `--min-likes 50`)
- Watchlist for monitoring accounts
- Auto noise filtering (`-is:retweet` added by default)
- Clean Telegram + markdown formatters

**What didn't change:**
- Still uses the same agentic research loop (decompose → search → refine → synthesize)
- Still read-only (never posts)
- Still works as a pure prompt skill if you don't want the CLI

## Install

### Claude Code
```bash
# From your project
mkdir -p .claude/skills
cd .claude/skills
git clone https://github.com/rohunvora/x-research-skill.git x-research
```

### OpenClaw
```bash
# From your workspace
mkdir -p skills
cd skills
git clone https://github.com/rohunvora/x-research-skill.git x-research
```

## Setup

1. **X API Bearer Token** — Get one from the [X Developer Portal](https://developer.x.com)
2. **Set the env var:**
   ```bash
   export X_BEARER_TOKEN="your-token-here"
   ```
   Or save it to `~/.config/env/global.env`:
   ```
   X_BEARER_TOKEN=your-token-here
   ```
3. **Install Bun** (for CLI tooling): https://bun.sh

## Usage

### Natural language (just talk to Claude)
- "What are people saying about Opus 4.6?"
- "Search X for OpenClaw skills"
- "What's CT saying about BNKR today?"
- "Check what @frankdegods posted recently"

### CLI commands
```bash
cd skills/x-research

# Search (sorted by likes, auto-filters retweets)
bun run x-search.ts search "your query" --sort likes --limit 10

# Profile — recent tweets from a user
bun run x-search.ts profile username

# Thread — full conversation
bun run x-search.ts thread TWEET_ID

# Single tweet
bun run x-search.ts tweet TWEET_ID

# Watchlist
bun run x-search.ts watchlist add username "optional note"
bun run x-search.ts watchlist check

# Save research to file
bun run x-search.ts search "query" --save --markdown
```

### Search options
```
--sort likes|impressions|retweets|recent   (default: likes)
  --since 1h|3h|12h|1d|7d     Time filter (default: last 7 days)
--min-likes N              Filter minimum likes
--min-impressions N        Filter minimum impressions
--pages N                  Pages to fetch, 1-5 (default: 1, 100 tweets/page)
--limit N                  Results to display (default: 15)
--no-replies               Exclude replies
--save                     Save to ~/clawd/drafts/
--json                     Raw JSON output
--markdown                 Markdown research doc
```

## File structure

```
x-research/
├── SKILL.md              # Skill instructions (Claude reads this)
├── x-search.ts           # CLI entry point
├── lib/
│   ├── api.ts            # X API wrapper
│   ├── cache.ts          # File-based cache (15min TTL)
│   └── format.ts         # Telegram + markdown formatters
├── data/
│   ├── watchlist.json    # Accounts to monitor (create your own)
│   └── cache/            # Auto-managed
└── references/
    └── x-api.md          # X API endpoint reference
```

## API costs

X API charges ~$0.005/tweet read. A typical research session (5 queries × 100 tweets) ≈ $2.50. The cache avoids repeat charges for identical queries within 15 minutes.

## Limitations

- Search covers last 7 days only (X API restriction on Basic tier)
- Read-only — never posts or interacts
- Requires X API Basic tier ($200/mo) or higher
- `min_likes` / `min_retweets` operators unavailable on Basic tier (filtered post-hoc instead)
