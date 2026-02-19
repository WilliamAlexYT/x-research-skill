#!/usr/bin/env bun
/**
 * One-time OAuth 2.0 PKCE flow to get a user access token with bookmark.read scope.
 * Run: bun run scripts/auth/get-bookmark-token.ts
 *
 * Prerequisites:
 * 1. Go to developer.twitter.com → your app → User authentication settings
 * 2. Enable OAuth 2.0
 * 3. Set callback URL: http://localhost:3000/callback
 * 4. Enable scopes: bookmark.read, tweet.read, users.read
 * 5. Set X_CLIENT_ID and X_CLIENT_SECRET in ~/.config/env/global.env
 *    (these are the OAuth 2.0 Client ID and Client Secret, different from consumer key)
 */

import * as crypto from "crypto";
import * as http from "http";
import { execSync } from "child_process";

const CLIENT_ID = process.env.X_CLIENT_ID || process.env.X_CONSUMER_KEY!;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || process.env.X_CONSUMER_SECRET;
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = ["bookmark.read", "tweet.read", "users.read", "offline.access"];

// Generate PKCE code verifier + challenge
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);
const state = crypto.randomBytes(16).toString("hex");

const authUrl = new URL("https://twitter.com/i/oauth2/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

console.log("\n🔑 Twitter OAuth 2.0 PKCE Auth Flow\n");
console.log("Opening browser to authorize...");
console.log("\nURL:", authUrl.toString(), "\n");

// Try to open browser
try {
  execSync(`open "${authUrl.toString()}"`);
} catch {
  console.log("Couldn't auto-open browser. Copy the URL above and paste it manually.");
}

console.log("Waiting for callback on http://localhost:3000/callback ...\n");

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost:3000");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (!code) {
    res.writeHead(400);
    res.end("No code received");
    return;
  }

  if (returnedState !== state) {
    res.writeHead(400);
    res.end("State mismatch — possible CSRF");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h1>✅ Auth successful! You can close this tab.</h1>");

  // Exchange code for tokens
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
      client_id: CLIENT_ID,
    }),
  });

  const tokens = await tokenRes.json() as any;

  if (tokens.error) {
    console.error("❌ Token exchange failed:", tokens);
    server.close();
    process.exit(1);
  }

  console.log("✅ Success! Add these to ~/.config/env/global.env:\n");
  console.log(`export X_OAUTH2_ACCESS_TOKEN="${tokens.access_token}"`);
  if (tokens.refresh_token) {
    console.log(`export X_OAUTH2_REFRESH_TOKEN="${tokens.refresh_token}"`);
  }
  console.log(`export X_OAUTH2_TOKEN_EXPIRY="${Date.now() + (tokens.expires_in * 1000)}"`);
  console.log("\n📋 Copy those lines into your env file and you're set.");

  server.close();
  process.exit(0);
});

server.listen(3000, () => {
  console.log("Listening on port 3000...");
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
  if ((err as any).code === "EADDRINUSE") {
    console.log("Port 3000 is in use. Kill whatever's on it and retry.");
  }
  process.exit(1);
});
