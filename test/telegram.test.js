import test from "node:test";
import assert from "node:assert/strict";
import worker, { handleTelegramWebhook } from "../worker/index.js";

test("Telegram Webhook handles /start, /app, /status, /halt, and inline callback queries", async () => {
  const sentMessages = [];
  const answeredCallbacks = [];

  // Mock global fetch for Telegram Bot API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("api.telegram.org")) {
      if (urlStr.includes("/sendMessage")) {
        const body = JSON.parse(init.body);
        sentMessages.push(body);
        return new Response(JSON.stringify({ ok: true, result: { message_id: 100 } }), { status: 200 });
      }
      if (urlStr.includes("/answerCallbackQuery")) {
        const body = JSON.parse(init.body);
        answeredCallbacks.push(body);
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }
      if (urlStr.includes("/setWebhook") || urlStr.includes("/setMyCommands") || urlStr.includes("/setChatMenuButton")) {
        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      }
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { id: 123, username: "SniperTestBot", first_name: "Sniper Bot" } }), { status: 200 });
      }
    }
    return originalFetch(url, init);
  };

  try {
    const mockEnv = {
      TG_TOKEN: "TEST_TOKEN_123",
      TG_CHAT: "999999",
      APP_KEY: "APP_KEY_TEST_456",
      MINI_APP_URL: "https://sniper-relay.workers.dev/app",
    };

    // 1) Test /start message
    const startReq = new Request("https://worker.local/telegram-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 999999 },
          text: "/start",
        },
      }),
    });
    const startRes = await worker.fetch(startReq, mockEnv);
    assert.equal(startRes.status, 200);
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes("SOLANA SNIPER TERMINAL"));
    const webAppUrl = sentMessages[0].reply_markup.inline_keyboard[0][0].web_app.url;
    assert.ok(webAppUrl.includes("worker=https%3A%2F%2Fworker.local"));
    assert.ok(webAppUrl.includes("key=APP_KEY_TEST_456"));

    // 2) Test /status message
    const statusReq = new Request("https://worker.local/telegram-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: 999999 },
          text: "/status",
        },
      }),
    });
    const statusRes = await worker.fetch(statusReq, mockEnv);
    assert.equal(statusRes.status, 200);
    assert.equal(sentMessages.length, 2);
    assert.ok(sentMessages[1].text.includes("SNIPER RELAY STATUS"));

    // 3) Test /halt message
    const haltReq = new Request("https://worker.local/telegram-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 3,
        message: {
          message_id: 12,
          chat: { id: 999999 },
          text: "/halt",
        },
      }),
    });
    const haltRes = await worker.fetch(haltReq, mockEnv);
    assert.equal(haltRes.status, 200);
    assert.equal(sentMessages.length, 3);
    assert.ok(sentMessages[2].text.includes("EMERGENCY HALT ACTIVATED"));

    // 4) Test callback query
    const callbackReq = new Request("https://worker.local/telegram-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        update_id: 4,
        callback_query: {
          id: "cb_123",
          message: { chat: { id: 999999 } },
          data: "tma_resume",
        },
      }),
    });
    const callbackRes = await worker.fetch(callbackReq, mockEnv);
    assert.equal(callbackRes.status, 200);
    assert.equal(answeredCallbacks.length, 1);
    assert.equal(answeredCallbacks[0].callback_query_id, "cb_123");
    assert.ok(sentMessages[3].text.includes("EMERGENCY HALT CLEARED"));

    // 5) Test /telegram-setup endpoint requires valid x-key
    const unauthSetup = await worker.fetch(new Request("https://worker.local/telegram-setup", {
      method: "POST",
      headers: { "x-key": "WRONG_KEY" },
    }), mockEnv);
    assert.equal(unauthSetup.status, 401);

    const authSetup = await worker.fetch(new Request("https://worker.local/telegram-setup", {
      method: "POST",
      headers: { "x-key": "APP_KEY_TEST_456" },
    }), mockEnv);
    assert.equal(authSetup.status, 200);
    const setupJson = await authSetup.json();
    assert.equal(setupJson.ok, true);
    assert.equal(setupJson.bot.username, "SniperTestBot");
    assert.ok(setupJson.launchUrl.includes("APP_KEY_TEST_456"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
