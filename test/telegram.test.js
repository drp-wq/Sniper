import test from "node:test";
import assert from "node:assert/strict";
import { tg } from "../worker/index.js";
import { sendTelegram, notify } from "../src/api.js";
import { loadConfig } from "../src/config.js";
import { redactSecrets } from "../src/rpc.js";

test("tg in worker/index.js requires TG_TOKEN and TG_CHAT", async () => {
  assert.equal(await tg({}, "test message"), false);
  assert.equal(await tg({ TG_TOKEN: "token-only" }, "test message"), false);
  assert.equal(await tg({ TG_CHAT: "chat-only" }, "test message"), false);
});

test("tg formats Telegram API request and truncates to 3500 chars", async () => {
  let calledUrl = null;
  let calledBody = null;
  let calledHeaders = null;

  const mockFetch = async (url, opts) => {
    calledUrl = url;
    calledHeaders = opts.headers;
    calledBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const env = { TG_TOKEN: "test-bot-token", TG_CHAT: "987654321" };
  const longText = "A".repeat(4000);

  const res = await tg(env, longText, { fetch: mockFetch });
  assert.equal(res, true);
  assert.equal(calledUrl, "https://api.telegram.org/bottest-bot-token/sendMessage");
  assert.equal(calledHeaders["content-type"], "application/json");
  assert.equal(calledBody.chat_id, "987654321");
  assert.equal(calledBody.text.length, 3500);
});

test("tg handles network failures gracefully without throwing", async () => {
  const mockFetch = async () => {
    throw new Error("DNS resolution failed");
  };

  const env = { TG_TOKEN: "token", TG_CHAT: "chat" };
  const res = await tg(env, "hello", { fetch: mockFetch });
  assert.equal(res, false);
});

test("sendTelegram in src/api.js validates credentials and handles delivery", async () => {
  // Missing credentials
  assert.equal(await sendTelegram("msg", { tgToken: "", tgChat: "" }), false);
  assert.equal(await sendTelegram("msg", { tgToken: "token", tgChat: "" }), false);

  // Successful dispatch
  let payload = null;
  const mockFetch = async (_url, opts) => {
    payload = JSON.parse(opts.body);
    return { ok: true };
  };

  const ok = await sendTelegram("Hello Telegram", {
    tgToken: "bot123",
    tgChat: "456",
    fetch: mockFetch,
  });
  assert.equal(ok, true);
  assert.equal(payload.chat_id, "456");
  assert.equal(payload.text, "Hello Telegram");
});

test("notify in src/api.js routes via worker and falls back to direct Telegram when worker relay is unconfigured", async () => {
  let workerCallCount = 0;
  let telegramCallCount = 0;

  const mockFetch = async (url) => {
    if (url.includes("/notify")) {
      workerCallCount++;
      // Worker accepted notification, but worker has no TG secrets (sent: false)
      return {
        ok: true,
        json: async () => ({ ok: true, sent: false }),
      };
    }
    if (url.includes("api.telegram.org")) {
      telegramCallCount++;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  await notify("Trade alert: PAPER BUY BONK", {
    fetch: mockFetch,
    workerUrl: "https://worker.test",
    appKey: "test-key",
    tgToken: "bot-token",
    tgChat: "chat-id",
  });

  assert.equal(workerCallCount, 1);
  assert.equal(telegramCallCount, 1);
});

test("notify skips direct Telegram when worker relay successfully delivers", async () => {
  let workerCallCount = 0;
  let telegramCallCount = 0;

  const mockFetch = async (url) => {
    if (url.includes("/notify")) {
      workerCallCount++;
      // Worker delivered to Telegram directly
      return {
        ok: true,
        json: async () => ({ ok: true, sent: true }),
      };
    }
    if (url.includes("api.telegram.org")) {
      telegramCallCount++;
      return { ok: true };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  await notify("Trade alert: PAPER EXIT BONK", {
    fetch: mockFetch,
    workerUrl: "https://worker.test",
    appKey: "test-key",
    tgToken: "bot-token",
    tgChat: "chat-id",
  });

  assert.equal(workerCallCount, 1);
  assert.equal(telegramCallCount, 0); // No duplicate message sent
});

test("notify falls back to direct Telegram when worker network request fails", async () => {
  let telegramCallCount = 0;

  const mockFetch = async (url) => {
    if (url.includes("/notify")) {
      throw new Error("Worker connection timeout");
    }
    if (url.includes("api.telegram.org")) {
      telegramCallCount++;
      return { ok: true };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  await notify("Urgent alert", {
    fetch: mockFetch,
    workerUrl: "https://worker.test",
    appKey: "test-key",
    tgToken: "bot-token",
    tgChat: "chat-id",
  });

  assert.equal(telegramCallCount, 1);
});

test("loadConfig extracts TG_TOKEN and TG_CHAT from env", () => {
  const loaded = loadConfig(
    {
      RPC_URL: "https://rpc.helius.xyz",
      WORKER_URL: "https://worker.dev",
      APP_KEY: "secret",
      TG_TOKEN: "  999:xyz  ",
      TG_CHAT: "  -100123456  ",
    },
    { allowPlaceholder: false },
  );

  assert.equal(loaded.tgToken, "999:xyz");
  assert.equal(loaded.tgChat, "-100123456");
});

test("redactSecrets sanitizes TG_TOKEN and TG_CHAT from logs and error messages", () => {
  const secretToken = "123456:SECRET_BOT_TOKEN_ABC";
  const secretChat = "987654321";

  const rawMsg = `Network error calling https://api.telegram.org/bot${secretToken}/sendMessage with chat_id=${secretChat}`;
  const sanitized = redactSecrets(rawMsg, [secretToken, secretChat]);

  assert.ok(!sanitized.includes(secretToken), "secretToken must not be visible in sanitized text");
  assert.ok(!sanitized.includes(secretChat), "secretChat must not be visible in sanitized text");
  assert.ok(sanitized.includes("[REDACTED]"), "Sanitized text must contain redaction placeholder");
});
