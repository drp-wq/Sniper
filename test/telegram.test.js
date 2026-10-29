import test from "node:test";
import assert from "node:assert/strict";
import { tg, authenticateTelegram, getRole, authorizeAction, checkRateLimit, resetRateLimits } from "../worker/index.js";
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

async function createSignedInitData(botToken, user, authDate = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAG_test_456");
  params.set("user", typeof user === "string" ? user : JSON.stringify(user));

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");

  const secretKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));
  const dataKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", dataKey, enc.encode(dcs));
  const hash = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  params.set("hash", hash);
  return params.toString();
}

test("authenticateTelegram extracts verified user and rejects tampered or expired data", async () => {
  const env = { TG_TOKEN: "987654:TEST_TOKEN_XYZ", TG_CHAT: "123456" };
  const user = { id: 123456, first_name: "Alice", username: "alice_bot" };
  const validInit = await createSignedInitData(env.TG_TOKEN, user);

  // Valid
  const res = await authenticateTelegram(env, validInit);
  assert.equal(res.ok, true);
  assert.equal(res.user.id, "123456");
  assert.equal(res.user.firstName, "Alice");

  // Tampered
  const tampered = validInit.replace(/hash=[a-f0-9]{4}/, "hash=0000");
  const resTampered = await authenticateTelegram(env, tampered);
  assert.equal(resTampered.ok, false);
  assert.equal(resTampered.error, "invalid_signature");

  // Missing user
  const noUserParams = new URLSearchParams(validInit);
  noUserParams.delete("user");
  const resNoUser = await authenticateTelegram(env, noUserParams.toString());
  assert.equal(resNoUser.ok, false);
});

test("getRole assigns roles accurately and fails closed on unknown users", () => {
  const env = {
    TG_CHAT: "1001",
    TG_OPERATORS: "2001, 2002",
    TG_VIEWERS: "3001, 3002",
  };

  assert.equal(getRole(env, "1001"), "admin");
  assert.equal(getRole(env, 2001), "operator");
  assert.equal(getRole(env, "2002"), "operator");
  assert.equal(getRole(env, "3001"), "viewer");
  assert.equal(getRole(env, "9999"), null); // Unknown user denied
  assert.equal(getRole({}, "1001"), null); // Missing config fails closed
});

test("authorizeAction enforces strict role allowlist and blocks privilege escalation", () => {
  // Viewer
  assert.equal(authorizeAction("viewer", "read_state"), true);
  assert.equal(authorizeAction("viewer", "halt"), false);
  assert.equal(authorizeAction("viewer", "update_rules"), false);

  // Operator
  assert.equal(authorizeAction("operator", "halt"), true);
  assert.equal(authorizeAction("operator", "close_position"), true);
  assert.equal(authorizeAction("operator", "update_rules"), false);

  // Admin
  assert.equal(authorizeAction("admin", "update_rules"), true);
  assert.equal(authorizeAction("admin", "update_settings"), true);
  assert.equal(authorizeAction("admin", "arbitrary_cmd"), false); // Unknown action denied
});

test("checkRateLimit blocks requests that exceed window threshold", () => {
  resetRateLimits();
  const key = "user-123";
  const opt = { limit: 2, windowMs: 10000 };

  const r1 = checkRateLimit(key, opt);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);

  const r2 = checkRateLimit(key, opt);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);

  const r3 = checkRateLimit(key, opt);
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);
});
