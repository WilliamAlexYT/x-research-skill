#!/usr/bin/env bun
/**
 * x-bookmarks — Heartbeat-compatible Twitter bookmark monitor.
 *
 * Checks for new bookmarks, scores relevance against active projects,
 * and writes alerts to data/bookmark-alerts.json.
 *
 * Usage:
 *   bun run scripts/bookmarks.ts           # Check for new, write alerts
 *   bun run scripts/bookmarks.ts --show    # Show current alerts
 *   bun run scripts/bookmarks.ts --clear   # Clear alerts
 *
 * Auth setup required (bookmarks need OAuth 2.0 user context):
 *   1. developer.twitter.com → your app → User authentication settings
 *   2. Enable OAuth 2.0, set callback: http://localhost:3000/callback
 *   3. Scopes: bookmark.read, tweet.read, users.read, offline.access
 *   4. Run: bun run scripts/auth/get-bookmark-token.ts
 *   5. Add X_OAUTH2_ACCESS_TOKEN to ~/.config/env/global.env
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data");
const SEEN_FILE = join(DATA_DIR, "seen-bookmarks.json");
const ALERTS_FILE = join(DATA_DIR, "bookmark-alerts.json");
const ACTIVE_PROJECTS_FILE = join(
  process.env.HOME!,
  "clawd/memory/active-projects.md"
);

// ── Auth ──────────────────────────────────────────────────────────────────────

function getOAuth2Token(): string | null {
  if (process.env.X_OAUTH2_ACCESS_TOKEN) return process.env.X_OAUTH2_ACCESS_TOKEN;
  try {
    const envFile = readFileSync(
      `${process.env.HOME}/.config/env/global.env`,
      "utf-8"
    );
    const match = envFile.match(/X_OAUTH2_ACCESS_TOKEN=["']?([^"'\n]+)/);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

function getUserId(): string | null {
  if (process.env.X_USER_ID) return process.env.X_USER_ID;
  try {
    const envFile = readFileSync(
      `${process.env.HOME}/.config/env/global.env`,
      "utf-8"
    );
    const match = envFile.match(/X_USER_ID=["']?([^"'\n]+)/);
    if (match) return match[1].trim();
  } catch {}
  return null;
}

// ── Bookmarks API ─────────────────────────────────────────────────────────────

async function lookupUserId(token: string): Promise<string> {
  const res = await fetch(
    "https://api.x.com/2/users/by/username/frankdegods?user.fields=id",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`User lookup failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as any;
  return json.data.id;
}

async function fetchBookmarks(
  token: string,
  userId: string
): Promise<Array<{ id: string; text: string; created_at: string }>> {
  const params = new URLSearchParams({
    max_results: "100",
    "tweet.fields": "created_at,text",
  });
  const res = await fetch(
    `https://api.x.com/2/users/${userId}/bookmarks?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new Error(
        `Auth failed (${res.status}). Your OAuth2 token may be expired.\n` +
        `Run: bun run scripts/auth/get-bookmark-token.ts to refresh.`
      );
    }
    throw new Error(`Bookmarks API error: ${res.status} ${body}`);
  }
  const json = (await res.json()) as any;
  return json.data || [];
}

// ── Relevance Scoring ─────────────────────────────────────────────────────────

interface ProjectKeywords {
  project: string;
  keywords: string[];
}

function extractProjectKeywords(): ProjectKeywords[] {
  const defaults: ProjectKeywords[] = [
    { project: "BNKR/Bankr", keywords: ["bankr", "bnkr", "clanker", "token launch", "onchain", "launchpad", "vesting", "earnings mechanism"] },
    { project: "belief-router", keywords: ["trade thesis", "belief router", "market thesis", "investment thesis", "options", "perp", "kalshi"] },
    { project: "x-research", keywords: ["x api", "twitter api", "bookmarks", "tweet search", "social media research"] },
    { project: "sell-radar", keywords: ["sell signal", "ladder", "mcap", "dexscreener", "portfolio management"] },
    { project: "Anthropic", keywords: ["anthropic", "claude", "llm", "ai agent", "solutions architect", "applied ai"] },
    { project: "trading", keywords: ["solana", "base", "memecoin", "fomo", "dex", "wallet", "defi", "pnl"] },
  ];

  try {
    if (!existsSync(ACTIVE_PROJECTS_FILE)) return defaults;
    const content = readFileSync(ACTIVE_PROJECTS_FILE, "utf-8");

    // Extract project names from ## headers
    const projectMatches = content.match(/^## (.+)$/gm) || [];
    const extracted: ProjectKeywords[] = projectMatches.map((m) => {
      const name = m.replace("## ", "").trim();
      // Extract keywords from the section below each header
      const sectionStart = content.indexOf(m);
      const nextSection = content.indexOf("\n## ", sectionStart + 1);
      const section = content.slice(sectionStart, nextSection > -1 ? nextSection : undefined);
      // Pull meaningful words (4+ chars, not common words)
      const stopWords = new Set(["with", "this", "that", "from", "have", "will", "been", "they", "their", "status", "next", "action", "last", "worked"]);
      const words = section
        .toLowerCase()
        .match(/\b[a-z]{4,}\b/g)
        ?.filter((w) => !stopWords.has(w))
        .slice(0, 10) || [];
      return { project: name, keywords: [...new Set(words)] };
    });

    return extracted.length > 0 ? extracted : defaults;
  } catch {
    return defaults;
  }
}

function scoreRelevance(
  tweetText: string,
  projects: ProjectKeywords[]
): { score: number; reason: string; project: string } {
  const text = tweetText.toLowerCase();
  let bestScore = 0;
  let bestReason = "";
  let bestProject = "";

  for (const { project, keywords } of projects) {
    const matched = keywords.filter((kw) => text.includes(kw.toLowerCase()));
    if (matched.length === 0) continue;
    const score = matched.length >= 3 ? 3 : matched.length >= 1 ? 2 : 1;
    if (score > bestScore) {
      bestScore = score;
      bestReason = `Matches ${project}: ${matched.slice(0, 3).join(", ")}`;
      bestProject = project;
    }
  }

  return { score: bestScore, reason: bestReason, project: bestProject };
}

// ── State Management ──────────────────────────────────────────────────────────

function loadSeen(): Set<string> {
  try {
    if (!existsSync(SEEN_FILE)) return new Set();
    const data = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2));
}

function loadAlerts(): any[] {
  try {
    if (!existsSync(ALERTS_FILE)) return [];
    return JSON.parse(readFileSync(ALERTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveAlerts(alerts: any[]) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--show")) {
  const alerts = loadAlerts();
  if (alerts.length === 0) {
    console.log("No bookmark alerts.");
  } else {
    console.log(`\n📌 ${alerts.length} bookmark alert(s):\n`);
    for (const a of alerts) {
      console.log(`[${a.relevance_score}/3] ${a.project}`);
      console.log(`  ${a.text.slice(0, 120)}...`);
      console.log(`  Reason: ${a.reason}`);
      console.log(`  URL: ${a.url}`);
      console.log(`  Saved: ${a.timestamp}\n`);
    }
  }
  process.exit(0);
}

if (args.includes("--clear")) {
  saveAlerts([]);
  console.log("Bookmark alerts cleared.");
  process.exit(0);
}

// Default: check for new bookmarks
const token = getOAuth2Token();

if (!token) {
  console.error(
    "\n❌ OAuth2 token not found. Bookmarks require user-context auth.\n\n" +
    "Setup steps:\n" +
    "1. Go to developer.twitter.com → your app → User authentication settings\n" +
    "2. Enable OAuth 2.0\n" +
    "3. Set callback URL: http://localhost:3000/callback\n" +
    "4. Enable scopes: bookmark.read, tweet.read, users.read, offline.access\n" +
    "5. Run: bun run scripts/auth/get-bookmark-token.ts\n" +
    "6. Add X_OAUTH2_ACCESS_TOKEN to ~/.config/env/global.env\n"
  );
  process.exit(1);
}

try {
  let userId = getUserId();
  if (!userId) {
    console.log("Looking up user ID for @frankdegods...");
    userId = await lookupUserId(token);
    console.log(`User ID: ${userId} (add X_USER_ID=${userId} to env to skip this step)`);
  }

  console.log("Fetching bookmarks...");
  const bookmarks = await fetchBookmarks(token, userId);
  console.log(`Got ${bookmarks.length} bookmarks.`);

  const seen = loadSeen();
  const newBookmarks = bookmarks.filter((b) => !seen.has(b.id));
  console.log(`${newBookmarks.length} new (unseen) bookmarks.`);

  if (newBookmarks.length === 0) {
    console.log("Nothing new.");
    process.exit(0);
  }

  const projects = extractProjectKeywords();
  const alerts: any[] = loadAlerts();
  let alertCount = 0;

  for (const bm of newBookmarks) {
    seen.add(bm.id);
    const { score, reason, project } = scoreRelevance(bm.text, projects);
    if (score >= 2) {
      alerts.push({
        id: bm.id,
        url: `https://x.com/i/web/status/${bm.id}`,
        text: bm.text,
        relevance_score: score,
        reason,
        project,
        timestamp: new Date().toISOString(),
      });
      alertCount++;
    }
  }

  saveSeen(seen);
  saveAlerts(alerts);

  console.log(
    alertCount > 0
      ? `✅ ${alertCount} relevant bookmark(s) added to alerts. Run --show to view.`
      : `✅ ${newBookmarks.length} bookmarks marked seen, none were relevant.`
  );
} catch (err: any) {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
}
