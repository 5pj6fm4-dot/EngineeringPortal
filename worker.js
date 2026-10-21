const COOKIE_NAME = "__Host-engineeringportal_session";

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(payload, secret) {
  return b64url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(payload)
  )));
}

async function verifySig(payload, signature, secret) {
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    fromB64url(signature),
    new TextEncoder().encode(payload)
  );
}

function taipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}

function currentWeekInfo() {
  const p = taipeiDateParts();
  const date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

  // 格式：兩位年 + 兩位週數（例如 2643）
  const period = `${String(p.year).slice(-2)}${String(week).padStart(2, "0")}`;

  // 計算下週一 00:00 台北時間（即週日 16:00 UTC）
  const todayUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const today = new Date(todayUtc);
  const daysToMonday = ((8 - (today.getUTCDay() || 7)) % 7) || 7;
  const nextMondayUtc = todayUtc + daysToMonday * 86400000;
  const exp = Math.floor(nextMondayUtc / 1000) - 8 * 60 * 60;

  return { period, exp };
}

function crc32(s) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  let crc = -1;
  for (let i = 0; i < s.length; i++) crc = (crc >>> 8) ^ table[(crc ^ s.charCodeAt(i)) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function weeklyPassword(seed) {
  const { period } = currentWeekInfo();
  const raw = period + seed;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let result = "";
  for (let i = 1; i <= 6; i++) result += chars.charAt(Math.abs(crc32(raw + i)) % chars.length);
  return result;
}

async function createSession(secret) {
  const { period, exp } = currentWeekInfo();
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ period, exp })));
  return { token: `${payload}.${await sign(payload, secret)}`, exp };
}

async function authenticated(request, secret) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const prefix = `${COOKIE_NAME}=`;
  const cookie = cookieHeader.split(";").map(s => s.trim()).find(s => s.startsWith(prefix));
  if (!cookie) return false;

  const parts = cookie.slice(prefix.length).split(".");
  if (parts.length !== 2) return false;

  try {
    if (!(await verifySig(parts[0], parts, secret))) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return payload.period === currentWeekInfo().period &&
      Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function response(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      ...headers
    }
  });
}

function json(data, status = 200, headers = {}) {
  return response(JSON.stringify(data), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
}

function hiddenPath(path) {
  const lower = path.toLowerCase();
  return path.split("/").some(part => part.startsWith(".")) ||
    lower.endsWith(".bat") ||
    lower.endsWith(".ps1") ||
    lower.endsWith(".py") ||
    ["/worker.js", "/wrangler.jsonc", "/wrangler.toml", "/package.json", "/package-lock.json", "/.dev.vars", "/readme.md"].includes(lower);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path;
    try { path = decodeURIComponent(url.pathname); }
    catch { return response("Bad request", 400); }

    // 內部檔案阻擋
    if (hiddenPath(path)) return response("Not found", 404);

    // 診斷端點：只檢查 Secret 是否存在
    if (path === "/api/debug-config" && request.method === "GET") {
      return json({
        has_ADMIN_PASSWORD: !!env.ADMIN_PASSWORD,
        has_PORTAL_SEED: !!env.PORTAL_SEED,
        has_SESSION_SECRET: !!env.SESSION_SECRET,
        has_ASSETS: !!env.ASSETS
      });
    }

    // 登入與管理員取得授權碼 API
    if (request.method === "POST" && ["/api/login", "/api/admin-code"].includes(path)) {
      if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
        return json({ error: "Forbidden" }, 403);
      }
      if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
        return json({ error: "Invalid content type" }, 415);
      }

      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }

      if (typeof body.password !== "string" || body.password.length > 256) {
        return json({ error: "密碼錯誤。" }, 401);
      }

      if (path === "/api/admin-code") {
        if (!env.ADMIN_PASSWORD || !env.PORTAL_SEED) return json({ error: "伺服器尚未完成管理員設定。" }, 503);
        if (body.password !== env.ADMIN_PASSWORD) return json({ error: "管理員密碼錯誤。" }, 401);
        return json({ password: weeklyPassword(env.PORTAL_SEED) });
      }

      if (!env.PORTAL_SEED || !env.SESSION_SECRET) return json({ error: "伺服器尚未完成登入設定。" }, 503);
      if (body.password !== weeklyPassword(env.PORTAL_SEED)) return json({ error: "密碼錯誤。" }, 401);

      const session = await createSession(env.SESSION_SECRET);
      const maxAge = Math.max(0, session.exp - Math.floor(Date.now() / 1000));
      return json({ authenticated: true }, 200, {
        "Set-Cookie": `${COOKIE_NAME}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
      });
    }

    // 檢查 Session 狀態 API
    if (path === "/api/session" && request.method === "GET") {
      if (!env.SESSION_SECRET) return json({ error: "伺服器尚未完成登入設定。" }, 503);
      return json({ authenticated: await authenticated(request, env.SESSION_SECRET) });
    }

    if (path.startsWith("/api/")) return response("Not found", 404);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return response("Method not allowed", 405, { Allow: "GET, HEAD" });
    }

    // 首頁與公共圖示放行
    const isPublic = path === "/" || path === "/index.html" || path === "/favicon.ico" || path === "/robots.txt";
    if (!isPublic) {
      if (!env.SESSION_SECRET) return response("伺服器尚未完成登入設定。", 503);
      if (!(await authenticated(request, env.SESSION_SECRET))) {
        if (request.headers.get("Sec-Fetch-Dest") === "iframe") {
          return response("請返回 EngineeringPortal 首頁登入後再使用。", 401);
        }
        return response("", 302, { Location: "/?reauth=1" });
      }
    }

    // 靜態資源由 ASSETS 綁定提供
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers
    });
  }
};
