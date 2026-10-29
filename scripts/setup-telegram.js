#!/usr/bin/env node
/**
 * Telegram Mini App (TMA) One-Click Setup Script
 * Configures Bot Menu Button, Commands, and Worker Webhook so you can
 * use the Sniper Terminal directly inside Telegram on your Pixel 10 Pro XL or iPad.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const ENV_PATH = resolve(ROOT_DIR, ".env");

function loadEnv() {
  const env = { ...process.env };
  if (existsSync(ENV_PATH)) {
    const raw = readFileSync(ENV_PATH, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!env[key]) env[key] = val;
      }
    }
  }
  return env;
}

async function api(token, method, payload = null) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const options = {
    method: payload ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  };
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({ ok: false, error: "invalid json" }));
  return data;
}

async function main() {
  console.log("=================================================");
  console.log("🎯 Solana Sniper Bot — Telegram Mini App Setup");
  console.log("=================================================\n");

  const env = loadEnv();
  const token = env.TG_TOKEN;
  const workerUrl = env.WORKER_URL;
  const appKey = env.APP_KEY || "";
  const customMiniAppUrl = env.MINI_APP_URL || "";

  if (!token) {
    console.error("❌ Error: TG_TOKEN is missing.");
    console.error("Please add TG_TOKEN to your .env file or export TG_TOKEN=<your_bot_token>");
    console.error("To get a token: Open Telegram -> message @BotFather -> send /newbot");
    process.exit(1);
  }

  // 1. Verify Bot Token
  console.log("1/4 Verifying Bot Token with Telegram API...");
  const me = await api(token, "getMe");
  if (!me.ok) {
    console.error("❌ Telegram API Error:", me.description || me);
    process.exit(1);
  }
  const botUser = me.result;
  console.log(`✅ Connected as @${botUser.username} (${botUser.first_name})\n`);

  // 2. Determine Mini App URL
  let appUrl = customMiniAppUrl;
  if (!appUrl) {
    if (workerUrl) {
      const cleanWorker = workerUrl.endsWith("/") ? workerUrl.slice(0, -1) : workerUrl;
      appUrl = `${cleanWorker}/`;
    } else {
      appUrl = "http://127.0.0.1:8787/";
    }
  }

  // Add auto-configuration parameters if present
  try {
    const parsedApp = new URL(appUrl);
    if (workerUrl && !parsedApp.searchParams.has("worker")) {
      parsedApp.searchParams.set("worker", workerUrl);
    }
    if (appKey && !parsedApp.searchParams.has("key")) {
      parsedApp.searchParams.set("key", appKey);
    }
    appUrl = parsedApp.toString();
  } catch {}

  console.log(`2/4 Configuring Chat Menu Button pointing to Mini App:`);
  console.log(`    URL: ${appUrl}`);

  // 3. Set Chat Menu Button
  const menuRes = await api(token, "setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "🚀 Launch Sniper",
      web_app: { url: appUrl },
    },
  });
  if (menuRes.ok) {
    console.log("✅ Chat Menu Button successfully configured!\n");
  } else {
    console.warn("⚠️ Menu button warning:", menuRes.description || menuRes);
  }

  // 4. Set Bot Commands
  console.log("3/4 Registering Bot Commands list...");
  const cmdRes = await api(token, "setMyCommands", {
    commands: [
      { command: "app", description: "🚀 Launch Solana Sniper Mini App" },
      { command: "status", description: "📊 Check queue sequence and heartbeat" },
      { command: "halt", description: "🚨 Emergency pause paper trading" },
      { command: "resume", description: "✅ Resume paper trading entries" },
      { command: "help", description: "ℹ️ Show command list" },
    ],
  });
  if (cmdRes.ok) {
    console.log("✅ Commands (/app, /status, /halt, /resume) registered!\n");
  }

  // 5. Set Webhook (if WORKER_URL is configured)
  if (workerUrl && workerUrl.startsWith("https://")) {
    console.log("4/4 Setting Webhook to Cloudflare Worker...");
    const cleanWorker = workerUrl.endsWith("/") ? workerUrl.slice(0, -1) : workerUrl;
    const webhookUrl = `${cleanWorker}/telegram-webhook`;
    const hookRes = await api(token, "setWebhook", { url: webhookUrl });
    if (hookRes.ok) {
      console.log(`✅ Webhook registered: ${webhookUrl}\n`);
    } else {
      console.warn("⚠️ Webhook warning:", hookRes.description || hookRes);
    }
  } else {
    console.log("4/4 Webhook registration skipped (WORKER_URL is not an HTTPS url).");
    console.log("    When deployed to Cloudflare, the Worker will handle commands automatically.\n");
  }

  console.log("=================================================");
  console.log("🎉 TELEGRAM MINI APP SETUP COMPLETE!");
  console.log("=================================================");
  console.log(`• Open Telegram and message: https://t.me/${botUser.username}`);
  console.log(`• Or tap the bottom-left "🚀 Launch Sniper" button in the chat.`);
  console.log(`• Works on Pixel 10 Pro XL (Advanced Protection ON) & iPad with ZERO sideloading!`);
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("Fatal setup error:", err);
  process.exit(1);
});
