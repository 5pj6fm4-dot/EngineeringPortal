const PROTECTED_PREFIXES = ["/modules/", "/data/", "/assets/js/"];
const BLOCKED_FILES = new Set([
  "/worker.js",
  "/wrangler.jsonc",
  "/.assetsignore"
]);
const COOKIE_NAME = "ep_session";
const SESSION_SECONDS = 12 * 60 * 60;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache",
      ...extraHeaders
    }
  });
}

function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmac(keyText, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function quarterInfo(now = new Date()) {
  // Use Taiwan local calendar quarter (UTC+8), independent of the visitor's device clock.
  const taiwan = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = taiwan.getUTCFullYear();
  const quarter = Math.floor(taiwan.getUTCMonth() / 3) + 1;
  const nextMonth = quarter * 3; // 3, 6, 9, 12 => first month of next quarter, zero-based
  const nextQuarterTaiwanUtcMs = Date.UTC(year, nextMonth, 1) - 8 * 60 * 60 * 1000;
  const nextQuarter = quarter === 4 ? `${year + 1}-Q1` : `${year}-Q${quarter + 1}`;
  return {
    id: `${year}-Q${quarter}`,
    label: `${year} 年第 ${quarter} 季`,
    nextQuarter,
    expiresAt: new Date(nextQuarterTaiwanUtcMs).toISOString()
  };
}

async function currentCode(env, q = quarterInfo()) {
  if (!env.PORTAL_SEED) throw new Error("PORTAL_SEED is not configured");
  const digest = await hmac(env.PORTAL_SEED, `EngineeringPortal|${q.id}|v1`);
  let result = "";
  // 10 characters from a 32-character alphabet (50 bits of derived code).
  for (let i = 0; i < 10; i++) result += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return result;
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b)))
  ]);
  const aa = new Uint8Array(da), bb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function signSession(payload, secret) {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = base64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const cookieHeader = request.headers.get("Cookie") || "";
  const pair = cookieHeader.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return null;
  const token = pair.slice(COOKIE_NAME.length + 1);
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = base64url(await hmac(env.SESSION_SECRET, parts[0]));
  if (!(await safeEqual(expected, parts[1]))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    const q = quarterInfo();
    if (!payload || !payload.role || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000) || payload.q !== q.id) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

async function issueSession(role, env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  const q = quarterInfo();
  const exp = Math.min(Math.floor(Date.now() / 1000) + SESSION_SECONDS, Math.floor(Date.parse(q.expiresAt) / 1000));
  const token = await signSession({ role, exp, q: q.id }, env.SESSION_SECRET);
  return sessionCookie(token, Math.max(0, exp - Math.floor(Date.now() / 1000)));
}

function isProtected(path) {
  return PROTECTED_PREFIXES.some(prefix => path.startsWith(prefix));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Never publish repository internals or deployment configuration.
    if (path.startsWith("/.git/") || path === "/.git" ||
        path.startsWith("/.github/") || BLOCKED_FILES.has(path)) {
      return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST" && path === "/api/auth/login") {
      try {
        const body = await request.json();
        const submitted = String(body.code || "").trim().toUpperCase();
        const expected = await currentCode(env);
        if (!(await safeEqual(submitted, expected))) return json({ error: "授權碼錯誤或已過期。" }, 401);
        const cookie = await issueSession("user", env);
        return json({ ok: true, quarter: quarterInfo().label }, 200, { "Set-Cookie": cookie });
      } catch (e) {
        return json({ error: "伺服器登入設定不完整，請檢查 Cloudflare Secrets。" }, 500);
      }
    }

    if (request.method === "POST" && path === "/api/admin/login") {
      try {
        const body = await request.json();
        if (!env.ADMIN_PASSWORD || !(await safeEqual(String(body.password || ""), env.ADMIN_PASSWORD))) {
          return json({ error: "管理員密碼錯誤。" }, 401);
        }
        const q = quarterInfo();
        const code = await currentCode(env);
        const cookie = await issueSession("admin", env);
        return json({
          ok: true,
          quarter: q.label,
          code,
          expiresAt: q.expiresAt
        }, 200, { "Set-Cookie": cookie });
      } catch {
        return json({ error: "伺服器管理員設定不完整，請檢查 Cloudflare Secrets。" }, 500);
      }
    }

    if (path === "/api/admin/current-code") {
      const session = await readSession(request, env);
      if (!session || session.role !== "admin") return json({ error: "請先完成管理員驗證。" }, 401);
      const q = quarterInfo();
      return json({ ok: true, quarter: q.label, code: await currentCode(env), expiresAt: q.expiresAt });
    }

    if (path === "/api/auth/status") {
      const session = await readSession(request, env);
      return json({ ok: !!session, role: session?.role || null, quarter: quarterInfo().label });
    }

    if (request.method === "POST" && path === "/api/auth/logout") {
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie("", 0)
      });
    }

    // Every protected file request must have a valid, current-quarter session.
    if (isProtected(path)) {
      const session = await readSession(request, env);
      if (!session) {
        if (path.startsWith("/api/")) return json({ error: "需要授權。" }, 401);
        return new Response("需要有效的季度授權碼才能存取此工程檔案。", {
          status: 403,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }
    }

    // Admin API is not exposed to regular user sessions.
    if (path.startsWith("/api/admin/")) {
      const session = await readSession(request, env);
      if (!session || session.role !== "admin") return json({ error: "需要管理員驗證。" }, 401);
    }

    return env.ASSETS.fetch(request);
  }
};
