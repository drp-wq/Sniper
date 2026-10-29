#!/usr/bin/env node
/**
 * Telegram Setup & Test Verification Utility for Sniper Bot
 *
 * Usage:
 *   node scripts/test-telegram.js [options]
 *   npm run test:telegram
 *
 * Options:
 *   --token <token>   Telegram bot token (overrides TG_TOKEN from .env)
 *   --chat <id>       Telegram chat ID (overrides TG_CHAT from .env)
 *   --worker <url>    Worker URL to test relay (overrides WORKER_URL from .env)
 *   --key <key>       Worker APP_KEY (overrides APP_KEY from .env)
 *   --message <text>  Custom test message text
 *   --help            Show setup guide and options
 */

import { existsSync, readFileSync } from "node:fs";
import { parseEnvText } from "../src/config.js";

// Load .env if present
const env = { ...process.env };
if (existsSync(".env")) {
  try {
    parseEnvText(readFileSync(".env", "utf8"), env);
  } catch (err) {
    console.warn(`[!] Warning: Failed to parse .env: ${err.message}`);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let token = env.TG_TOKEN || "";
let chat = env.TG_CHAT || "";
let workerUrl = env.WORKER_URL || "";
let appKey = env.APP_KEY || "";
let customMessage = "";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    printGuide();
    process.exit(0);
  } else if (arg === "--token" && i + 1 < args.length) {
    token = args[++i];
  } else if (arg === "--chat" && i + 1 < args.length) {
    chat = args[++i];
  } else if (arg === "--worker" && i + 1 < args.length) {
    workerUrl = args[++i];
  } else if (arg === "--key" && i + 1 < args.length) {
    appKey = args[++i];
  } else if (arg === "--message" && i + 1 < args.length) {
    customMessage = args[++i];
  }
}

function printGuide() {
  console.log(`
======================================================================
           🎯 SNIPER BOT — TELEGRAM SETUP GUIDE
======================================================================

Follow these 4 simple steps to set up Telegram notifications:

Step 1: Create a Telegram Bot
-----------------------------
1. Open Telegram and search for: @BotFather (https://t.me/BotFather)
2. Send: /newbot
3. Follow the prompts:
   - Enter a name for your bot (e.g., "My Sniper Bot")
   - Enter a username ending in "bot" (e.g., "my_solana_sniper_bot")
4. BotFather will provide an HTTP API token formatted like:
   1234567890:ABCdefGHIJklm-NpQrSTuvWXyz123456789
   -> This is your TG_TOKEN.

Step 2: Get Your Chat ID
------------------------
1. Open your newly created bot in Telegram and click "START" (or send /start).
   (CRITICAL: The bot CANNOT message you until you send /start!)
2. Search for: @userinfobot (https://t.me/userinfobot) and send /start.
3. It will reply with your numeric "Id" (e.g., 987654321).
   -> This is your TG_CHAT.

Step 3: Save Configuration
--------------------------
A) On your local bot device (Android / Termux):
   Add to your .env file:
     TG_TOKEN=your_bot_token_here
     TG_CHAT=your_numeric_chat_id_here

B) On Cloudflare Worker (for watchdog dead-man alerts & relay):
   Run in your terminal:
     npx wrangler secret put TG_TOKEN
     (paste your bot token when prompted)
     npx wrangler secret put TG_CHAT
     (paste your chat ID when prompted)

Step 4: Verify
--------------
Run this test utility:
   npm run test:telegram
   or
   node scripts/verify-telegram.js
======================================================================
`);
}

async function run() {
  console.log("\n--- Sniper Bot Telegram Verification ---\n");

  const hasDirectConfig = Boolean(token && chat);
  const hasWorkerConfig = Boolean(workerUrl && appKey);

  if (!hasDirectConfig && !hasWorkerConfig) {
    console.error("❌ No Telegram credentials found in .env or arguments.\n");
    printGuide();
    process.exit(1);
  }

  let directSuccess = false;
  let workerSuccess = false;

  // 1. Direct Telegram verification
  if (token) {
    console.log("🔍 [1/2] Verifying Telegram Bot Token directly with Telegram API...");
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      const meData = await meRes.json().catch(() => ({}));
      if (meRes.ok && meData.ok) {
        const b = meData.result;
        console.log(`   ✓ Token valid! Connected to bot: @${b.username} (${b.first_name || "Sniper Bot"})`);
      } else {
        console.error(`   ✗ Token invalid! Telegram API response: ${meData.description || `HTTP ${meRes.status}`}`);
        if (meRes.status === 401) {
          console.error("     Hint: Check that TG_TOKEN matches the exact token given by @BotFather.");
        }
      }
    } catch (err) {
      console.error(`   ✗ Network error contacting api.telegram.org: ${err.message}`);
    }

    if (chat) {
      console.log(`🔍 [1/2] Sending test message to Chat ID: ${chat}...`);
      const text =
        customMessage ||
        `🎯 [Sniper Bot Paper-Only Alert]\n` +
        `Telegram notification channel verified successfully!\n` +
        `Time: ${new Date().toISOString()}\n` +
        `Status: READY`;

      try {
        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chat,
            text,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const sendData = await sendRes.json().catch(() => ({}));

        if (sendRes.ok && sendData.ok) {
          console.log("   ✓ Test message successfully delivered to Telegram!");
          directSuccess = true;
        } else {
          console.error(`   ✗ Failed to send message: ${sendData.description || `HTTP ${sendRes.status}`}`);
          if (sendRes.status === 400 && String(sendData.description).includes("chat not found")) {
            console.error("     Hint: Did you click START in your bot before testing? The bot cannot message you first.");
          }
        }
      } catch (err) {
        console.error(`   ✗ Network error sending message: ${err.message}`);
      }
    } else {
      console.warn("   ⚠️  TG_CHAT not provided; skipping direct message delivery test.");
    }
  } else {
    console.log("ℹ️  TG_TOKEN not provided; skipping direct Telegram API test.");
  }

  // 2. Cloudflare Worker relay verification
  if (hasWorkerConfig) {
    const cleanUrl = workerUrl.replace(/\/$/, "");
    console.log(`\n🔍 [2/2] Testing Worker /notify relay via ${cleanUrl}...`);
    try {
      const relayRes = await fetch(`${cleanUrl}/notify`, {
        method: "POST",
        headers: {
          "x-key": appKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: `🎯 [Sniper Worker Relay Test]\nTimestamp: ${new Date().toISOString()}`,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (relayRes.ok) {
        const relayData = await relayRes.json().catch(() => ({}));
        if (relayData.sent === true) {
          console.log("   ✓ Worker relay accepted request and forwarded alert to Telegram!");
          workerSuccess = true;
        } else {
          console.log("   ✓ Worker accepted notification request (HTTP 200).");
          console.log("   ℹ️  Note: Worker returned sent=false. If you want Cloudflare Worker to send dead-man alerts");
          console.log("       and relay notifications directly, add TG_TOKEN and TG_CHAT to Worker secrets:");
          console.log("       npx wrangler secret put TG_TOKEN");
          console.log("       npx wrangler secret put TG_CHAT");
          workerSuccess = true;
        }
      } else {
        console.error(`   ✗ Worker responded with HTTP ${relayRes.status}`);
        if (relayRes.status === 401) {
          console.error("     Hint: Check that APP_KEY in .env matches the APP_KEY secret configured on Cloudflare Worker.");
        }
      }
    } catch (err) {
      console.error(`   ✗ Network error reaching Worker: ${err.message}`);
    }
  } else {
    console.log("\nℹ️  WORKER_URL / APP_KEY not provided; skipping Worker relay test.");
  }

  console.log("\n======================================================================");
  if (directSuccess || workerSuccess) {
    console.log("🎉 SUCCESS: Telegram notification integration verified!");
    console.log("Your sniper bot will now send real-time alerts for:");
    console.log("  • Paper Buy executions");
    console.log("  • Paper Exit results (PnL & hold duration)");
    console.log("  • Trailing Stop armed & Take Profit triggers");
    console.log("  • Emergency Halt & watchdog alerts");
  } else {
    console.log("❌ Setup incomplete. Please review the errors above or run with --help.");
    process.exit(1);
  }
  console.log("======================================================================\n");
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
