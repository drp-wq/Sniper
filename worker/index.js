// Cloudflare Worker relay + Telegram Mini App panel (paste into the dashboard editor).
// Helius webhook -> KV queue -> phone polls /signals. Mini App at /app. Telegram alerts, watchdog, kill switch.
// Bindings: KV (KV namespace). Secrets: APP_KEY, HELIUS_AUTH, TG_TOKEN, TG_CHAT (your own numeric Telegram user id).
// Cron trigger: * * * * *

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const IGNORE = new Set([WSOL, USDC, USDT]);
const QMAX = 50;                    // keep the last 50 signals
const HB_LATE_MS = 12 * 60 * 1000;  // alert if the phone is silent this long

// Editable from the Mini App. [min, max] per rule; anything else is rejected.
export const RULE_LIMITS = {
  stopLoss: [1, 95], bandDown: [0, 50], bandUp: [0, 100], timeStopSec: [10, 3600],
  maxHoldMin: [1, 720], takeProfit: [10, 1000], trailArm: [10, 1000], trail: [1, 90], liqDrop: [5, 95],
};

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

async function tg(env, text) {
  if (!env.TG_TOKEN || !env.TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT, text: String(text).slice(0, 3500) }),
  }).catch(() => {});
}

// ADAPT THIS after you have seen real payloads (Worker logs). Default: any non-SOL/stable token in transfers.
function extractMints(tx) {
  const out = new Set();
  for (const t of tx.tokenTransfers ?? []) if (t.mint && !IGNORE.has(t.mint)) out.add(t.mint);
  return [...out];
}

const readQ = async (env) => (await env.KV.get("queue", "json")) ?? { seq: 0, items: [] };
const readCtl = async (env) => (await env.KV.get("ctl", "json")) ?? { halt: false, rules: {} };

async function setHalt(env, on) {
  const ctl = await readCtl(env);
  ctl.halt = on;
  await env.KV.put("ctl", JSON.stringify(ctl));
  await tg(env, on ? "HALT set: no new entries" : "HALT cleared");
  return ctl;
}

export function cleanRules(input) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RULE_LIMITS)) {
    const v = Number(input?.[k]);
    if (input && k in input && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

export async function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(ha);
  const ub = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= ua[i] ^ ub[i];
  return diff === 0 && a.length === b.length;
}

// ---- Telegram Mini App auth: validates initData per Telegram's HMAC scheme, owner only ----
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function verifyInit(env, initData) {
  if (!initData || !env.TG_TOKEN || !env.TG_CHAT) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), env.TG_TOKEN);
  const sig = [...(await hmac(secret, dcs))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!(await timingSafeEqualString(sig, hash))) return false;
  const authDate = Number(params.get("auth_date"));
  const nowSec = Date.now() / 1000;
  if (!Number.isFinite(authDate) || authDate > nowSec + 300 || nowSec - authDate > 86400) return false;
  try {
    return String(JSON.parse(params.get("user")).id) === String(env.TG_CHAT);
  } catch {
    return false;
  }
}

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Sniper Panel</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:var(--tg-theme-bg-color,#fff);--fg:var(--tg-theme-text-color,#111);--hint:var(--tg-theme-hint-color,#777);
--card:var(--tg-theme-secondary-bg-color,#f2f3f5);--btn:var(--tg-theme-button-color,#2481cc);--btnfg:var(--tg-theme-button-text-color,#fff)}
*{box-sizing:border-box}
body{margin:0;padding:12px 12px 24px;font:15px/1.4 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.card{background:var(--card);border-radius:12px;padding:12px;margin-bottom:10px}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--hint);margin:0 0 8px}
.row{display:flex;justify-content:space-between;gap:8px;padding:3px 0}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.good{color:#1a9f4b}.bad{color:#d93025}.hint{color:var(--hint)}
button{background:var(--btn);color:var(--btnfg);border:0;border-radius:10px;padding:11px 14px;font-size:15px;width:100%;margin-top:8px}
button.red{background:#d93025;color:#fff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
input{width:100%;padding:8px;border-radius:8px;border:1px solid var(--hint);background:var(--bg);color:var(--fg);font-size:15px}
label{font-size:12px;color:var(--hint);display:block;margin-bottom:2px}
.small{font-size:12px;word-break:break-word}
</style></head><body>
<div class="card" id="status"></div>
<div class="card"><h2>Open paper positions</h2><div id="open"></div></div>
<div class="card"><h2>Results (paper)</h2><div id="stats"></div></div>
<div class="card"><h2>Recent gate checks</h2><div id="gates"></div></div>
<div class="card"><h2>Exit rules</h2><div class="grid" id="rules"></div><button id="save">Save rules</button></div>
<div class="hint small" style="text-align:center" id="foot"></div>
<script>
var tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
var init = tg ? tg.initData : "";
var RULES = [["stopLoss","Stop-loss %"],["timeStopSec","Time-stop sec"],["bandDown","Band down %"],["bandUp","Band up %"],
  ["maxHoldMin","Max hold min"],["takeProfit","Take-profit %"],["trailArm","Trail arm %"],["trail","Trail %"],["liqDrop","Liq drop %"]];
var rulesShown = false;
function $(id){ return document.getElementById(id); }
function el(tag, text, cls){ var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function row(a, b, cls){ var r = el("div", undefined, "row"); r.appendChild(el("span", a)); r.appendChild(el("span", b, cls)); return r; }
function api(path, method, body){
  return fetch(path, { method: method || "GET", headers: { "x-init": init, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }).then(function(r){ if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
}
function ago(ts){ var s = Math.round((Date.now() - ts) / 1000); if (s < 90) return s + "s ago"; if (s < 5400) return Math.round(s / 60) + "m ago"; return Math.round(s / 3600) + "h ago"; }
function short(m){ return m.slice(0, 4) + "..." + m.slice(-4); }
function pc(x){ return (x === null || x === undefined) ? "n/a" : (x > 0 ? "+" : "") + Number(x).toFixed(1) + "%"; }
function clear(id){ var e = $(id); e.textContent = ""; return e; }

function render(s){
  var hb = s.hb || {};
  var online = hb.ts && (Date.now() - hb.ts) < 8 * 60000;
  var st = clear("status");
  st.appendChild(row("Phone", online ? "online" : (hb.ts ? "offline" : "never seen"), online ? "good" : "bad"));
  st.appendChild(row("Last heartbeat", hb.ts ? ago(hb.ts) : "n/a"));
  st.appendChild(row("New entries", s.halt ? "HALTED" : "running", s.halt ? "bad" : "good"));
  var b = el("button", s.halt ? "Resume new entries" : "Halt new entries", s.halt ? "" : "red");
  b.onclick = function(){ api("/api/halt?on=" + (s.halt ? 0 : 1), "POST").then(load).catch(err); };
  st.appendChild(b);

  var op = clear("open"), list = hb.open || [];
  if (!list.length) op.appendChild(el("div", "None", "hint"));
  list.forEach(function(p){
    op.appendChild(row(short(p.mint) + (p.half ? " (half sold)" : ""), pc(p.pct) + " / " + Math.round(p.ageSec / 60) + "m", p.pct >= 0 ? "good" : "bad"));
  });

  var sx = clear("stats"), t = hb.stats || {};
  sx.appendChild(row("Signals gated / passed", (t.gated || 0) + " / " + (t.passed || 0)));
  sx.appendChild(row("Closed trades", String(t.closed || 0)));
  if (t.closed) {
    sx.appendChild(row("Win rate", Number(t.winRate).toFixed(1) + "%"));
    sx.appendChild(row("Mean / median pnl", pc(t.mean) + " / " + pc(t.median), t.median >= 0 ? "good" : "bad"));
    sx.appendChild(row("Best / worst", pc(t.best) + " / " + pc(t.worst)));
    Object.keys(t.byReason || {}).forEach(function(k){
      sx.appendChild(row("  " + k, "n=" + t.byReason[k].n + "  " + pc(t.byReason[k].mean), "hint"));
    });
  }
  if (t.lagMedian !== null && t.lagMedian !== undefined) sx.appendChild(row("Relay lag (median)", Math.round(t.lagMedian / 1000) + "s"));

  var gx = clear("gates"), gs = (hb.gates || []).slice().reverse();
  if (!gs.length) gx.appendChild(el("div", "None yet", "hint"));
  gs.forEach(function(g){
    gx.appendChild(row(short(g.mint), g.pass ? "PASS" : "FAIL", g.pass ? "good" : "bad"));
    if (!g.pass && g.reasons && g.reasons.length) gx.appendChild(el("div", g.reasons.join("; "), "hint small"));
  });

  if (!rulesShown) {
    var rx = clear("rules");
    RULES.forEach(function(r){
      var w = el("div"); w.appendChild(el("label", r[1]));
      var i = el("input"); i.type = "number"; i.id = "r_" + r[0]; i.value = (s.rules || {})[r[0]]; w.appendChild(i); rx.appendChild(w);
    });
    rulesShown = true;
  }
  $("foot").textContent = "Paper mode only. Data is the phone's last heartbeat (every 3 min).";
}
function err(e){ $("foot").textContent = "Error: " + e.message; }
function load(){ return api("/api/state").then(render).catch(err); }
$("save").onclick = function(){
  var body = {};
  RULES.forEach(function(r){ body[r[0]] = Number($("r_" + r[0]).value); });
  api("/api/rules", "POST", body).then(function(){ rulesShown = false; $("foot").textContent = "Saved. Phone applies it within seconds."; return load(); }).catch(err);
};
load(); setInterval(load, 15000);
</script></body></html>`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Mini App page (no secrets inside; all data comes from authenticated /api calls).
    if (path === "/app" && req.method === "GET") {
      return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    // Mini App API: Telegram initData must validate AND belong to the owner.
    if (path.startsWith("/api/")) {
      if (!(await verifyInit(env, req.headers.get("x-init")))) return json({ error: "unauthorized" }, 401);
      if (path === "/api/state" && req.method === "GET") {
        const [ctl, hb] = await Promise.all([readCtl(env), env.KV.get("hb", "json")]);
        return json({ halt: ctl.halt, rules: { ...(hb?.rules ?? {}), ...ctl.rules }, hb: hb ?? {} });
      }
      if (path === "/api/halt" && req.method === "POST") {
        const ctl = await setHalt(env, url.searchParams.get("on") === "1");
        return json({ halt: ctl.halt });
      }
      if (path === "/api/rules" && req.method === "POST") {
        const rules = cleanRules(await req.json().catch(() => ({})));
        const ctl = await readCtl(env);
        ctl.rules = { ...ctl.rules, ...rules };
        await env.KV.put("ctl", JSON.stringify(ctl));
        return json({ rules: ctl.rules });
      }
      return json({ error: "not found" }, 404);
    }

    // Helius webhook (its own auth header).
    if (path === "/hook" && req.method === "POST") {
      const authHeader = req.headers.get("authorization");
      if (!env.HELIUS_AUTH || !(await timingSafeEqualString(authHeader, env.HELIUS_AUTH))) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await req.json().catch(() => []);
      const txs = Array.isArray(body) ? body : [body];
      const q = await readQ(env);
      let changed = false;
      for (const tx of txs) {
        for (const mint of extractMints(tx)) {
          if (q.items.some((i) => i.mint === mint)) continue;
          q.seq += 1;
          q.items.push({ id: q.seq, mint, sig: tx.signature ?? "", ts: Date.now() });
          changed = true;
        }
      }
      if (changed) {
        q.items = q.items.slice(-QMAX);
        await env.KV.put("queue", JSON.stringify(q));
      }
      return json({ ok: true });
    }

    // Phone-facing endpoints require the app key.
    const keyHeader = req.headers.get("x-key");
    if (!env.APP_KEY || !(await timingSafeEqualString(keyHeader, env.APP_KEY))) {
      return json({ error: "unauthorized" }, 401);
    }

    if (path === "/signals") {
      const since = Number(url.searchParams.get("since") ?? -1);
      const [q, ctl] = await Promise.all([readQ(env), readCtl(env)]);
      const signals = since < 0 ? [] : q.items.filter((i) => i.id > since);
      return json({ signals, seq: q.seq, halt: ctl.halt, rules: ctl.rules });
    }

    if (path === "/heartbeat" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      await env.KV.put("hb", JSON.stringify({ ...b, ts: Date.now() }));
      return json({ ok: true });
    }

    if (path === "/notify" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      await tg(env, b.text ?? "");
      return json({ ok: true });
    }

    // Kill switch via curl: POST /halt?on=1 stops new entries, on=0 resumes.
    if (path === "/halt" && req.method === "POST") {
      const ctl = await setHalt(env, url.searchParams.get("on") === "1");
      return json({ halt: ctl.halt });
    }

    return json({ error: "not found" }, 404);
  },

  // Dead-man's switch: runs every minute via cron.
  async scheduled(_event, env) {
    const hb = await env.KV.get("hb", "json");
    if (!hb) return;
    const late = Date.now() - hb.ts > HB_LATE_MS;
    const alerted = await env.KV.get("alerted");
    if (late && !alerted) {
      const mins = Math.round((Date.now() - hb.ts) / 60000);
      await tg(env, `Phone silent for ${mins} min. Open paper positions at last heartbeat: ${hb.open?.length ?? 0}`);
      await env.KV.put("alerted", "1", { expirationTtl: 3600 });
    } else if (!late && alerted) {
      await env.KV.delete("alerted");
    }
  },
};
