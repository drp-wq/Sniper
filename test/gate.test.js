import test from "node:test";
import assert from "node:assert/strict";
import { runGate } from "../src/gate.js";
import { rpc, redactSecrets } from "../src/rpc.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const RAYDIUM_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

test("runGate rejects tokens when mintAuthority or freezeAuthority is still active", async () => {
  const res = await runGate(
    "mint-active-auth",
    { maxTop10Pct: 35 },
    {
      rpc: async (method) => {
        if (method === "getAccountInfo") {
          return {
            value: {
              data: {
                parsed: {
                  info: {
                    decimals: 6,
                    mintAuthority: "SomeAuthorityPubkey",
                    freezeAuthority: "SomeFreezePubkey",
                  },
                },
              },
            },
          };
        }
        if (method === "getTokenSupply") return { value: { uiAmount: 1000 } };
        if (method === "getTokenLargestAccounts") return { value: [] };
        return { value: [] };
      },
    },
  );

  assert.equal(res.pass, false);
  assert.ok(res.reasons.includes("mint authority not revoked"));
  assert.ok(res.reasons.includes("freeze authority not revoked"));
});

test("runGate aggregates multiple token accounts owned by the same wallet and excludes PDA vaults", async () => {
  // Supply = 1000.
  // Raydium PDA holds 500 (50% - should be excluded).
  // Wallet-A holds 3 token accounts of 80 each = 240 (24%).
  // Unfunded Wallet-B (null accountInfo) holds 150 (15%).
  // Combined wallet concentration = 39% (> 35% threshold).
  let callIndex = 0;
  const res = await runGate(
    "mint-sybil",
    { maxTop10Pct: 35 },
    {
      rpc: async (method) => {
        if (method === "getAccountInfo") {
          return {
            value: {
              data: {
                parsed: {
                  info: { decimals: 6, mintAuthority: null, freezeAuthority: null },
                },
              },
            },
          };
        }
        if (method === "getTokenSupply") {
          return { value: { uiAmount: 1000 } };
        }
        if (method === "getTokenLargestAccounts") {
          return {
            value: [
              { address: "ta-pda", uiAmount: 500 },
              { address: "ta-a1", uiAmount: 80 },
              { address: "ta-a2", uiAmount: 80 },
              { address: "ta-a3", uiAmount: 80 },
              { address: "ta-b1", uiAmount: 150 },
            ],
          };
        }
        if (method === "getMultipleAccounts") {
          callIndex += 1;
          if (callIndex === 1) {
            // Token account owners
            return {
              value: [
                { data: { parsed: { info: { owner: "owner-pda" } } } },
                { data: { parsed: { info: { owner: "wallet-A" } } } },
                { data: { parsed: { info: { owner: "wallet-A" } } } },
                { data: { parsed: { info: { owner: "wallet-A" } } } },
                { data: { parsed: { info: { owner: "wallet-B-unfunded" } } } },
              ],
            };
          }
          // Owner account info: owner-pda is owned by Raydium program, wallet-A by SYSTEM_PROGRAM, wallet-B-unfunded is null
          return {
            value: [
              { owner: RAYDIUM_PROGRAM },
              { owner: SYSTEM_PROGRAM },
              null,
            ],
          };
        }
        return { value: null };
      },
    },
  );

  assert.equal(res.top10Pct, 39);
  assert.equal(res.pass, false);
  assert.ok(res.reasons[0].includes("39.0%"));
});

test("rpc checks HTTP status (429/500), handles malformed JSON, and redacts API keys on network/RPC errors", async () => {
  const secretRpcUrl = "https://mainnet.helius-rpc.com/?api-key=SUPER_SECRET_HELIUS_KEY_999";

  // 1) HTTP 429 status check before JSON parsing
  await assert.rejects(
    () =>
      rpc("getAccountInfo", ["mint-1"], {
        rpcUrl: secretRpcUrl,
        fetch: async () => ({
          ok: false,
          status: 429,
          json: async () => {
            throw new Error("should not parse JSON on HTTP 429");
          },
        }),
      }),
    (err) => {
      assert.match(err.message, /getAccountInfo: HTTP 429/);
      assert.equal(err.message.includes("SUPER_SECRET_HELIUS_KEY_999"), false);
      return true;
    },
  );

  // 2) HTTP 500 status check
  await assert.rejects(
    () =>
      rpc("getTokenSupply", ["mint-1"], {
        rpcUrl: secretRpcUrl,
        fetch: async () => ({ ok: false, status: 500 }),
      }),
    /getTokenSupply: HTTP 500/,
  );

  // 3) Malformed JSON on HTTP 200
  await assert.rejects(
    () =>
      rpc("getTokenSupply", ["mint-1"], {
        rpcUrl: secretRpcUrl,
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token < in JSON");
          },
        }),
      }),
    /getTokenSupply: malformed JSON response/,
  );

  // 4) Network failure with URL & API key in error message + cause
  await assert.rejects(
    () =>
      rpc("getMultipleAccounts", [[]], {
        rpcUrl: secretRpcUrl,
        fetch: async () => {
          const e = new TypeError(`fetch failed for ${secretRpcUrl}`);
          e.cause = new Error("connect ECONNREFUSED ?api-key=SUPER_SECRET_HELIUS_KEY_999");
          throw e;
        },
      }),
    (err) => {
      assert.match(err.message, /getMultipleAccounts: network error:/);
      assert.equal(err.message.includes("SUPER_SECRET_HELIUS_KEY_999"), false);
      assert.ok(err.message.includes("[REDACTED]"));
      return true;
    },
  );

  // 5) JSON-RPC error object containing secret or authorization header
  const redacted = redactSecrets(
    "Upstream failed at https://mainnet.helius-rpc.com/?api-key=MY_KEY_12345 with authorization: Bearer SECRET_BEARER_TOKEN",
    [secretRpcUrl],
  );
  assert.equal(redacted.includes("MY_KEY_12345"), false);
  assert.equal(redacted.includes("SECRET_BEARER_TOKEN"), false);
});

test("rpc retries transient HTTP 429 and network errors up to rpcRetries and succeeds on recovery", async () => {
  let attempts = 0;
  const res = await rpc("getTokenLargestAccounts", ["mint-recover"], {
    rpcUrl: "http://127.0.0.1:8899",
    rpcRetries: 2,
    rpcRetryMs: 1,
    sleep: async () => {},
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, status: 429 };
      }
      if (attempts === 2) {
        throw new Error("socket hang up");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { value: [{ address: "ta-1", uiAmount: 42 }] },
        }),
      };
    },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(res, { value: [{ address: "ta-1", uiAmount: 42 }] });
});
