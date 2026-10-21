
const COOKIE_NAME = "__Host-engineeringportal_session";

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload, secret) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return base64url(new Uint8Array(signature));
}

async function verifySignature(payload, signature, secret) {
  const key = await importHmacKey(secret);

  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64url(signature),
    new TextEncoder().encode(payload)
  );
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;

  return `${year}-${month}`;
}

function monthEndEpoch(period) {
  const [year, month] = period.split("-").map(Number);

  // 下個月 1 日台灣時間 00:00，換算成 Unix 秒數
  return Math.floor(
    (Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000) / 1000
  );
}

async function createSession(secret) {
  const period = currentPeriod();

  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        period,
        exp: monthEndEpoch(period)
      })
    )
  );

  const signature = await signPayload(payload, secret);

  return {
    token: `${payload}.${signature}`,
    exp: monthEndEpoch(period)
  };
}

async function isAuthenticated(request, secret) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const prefix = `${COOKIE_NAME}=`;

  const cookie = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(prefix));

  if (!cookie) return false;

  const parts = cookie.slice(prefix.length).split(".");
  if (parts.length !== 2) return false;

  try {
    const valid = await verifySignature(
      parts[0],
      parts[1],
      secret
    );

    if (!valid) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64url(parts[0]))
    );

    return (
      payload.period === currentPeriod() &&
      Number.isFinite(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function reply(body, status = 200, headers = {}) {
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

function jsonReply(data, status = 200, headers = {}) {
  return reply(JSON.stringify(data), status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
}

function isInternalFile(path) {
  const blockedFiles = new Set([
    "/worker.js",
    "/wrangler.jsonc",
    "/package.json",
    "/package-lock.json",
    "/.dev.vars",
    "/README.md"
  ]);

  return (
    blockedFiles.has(path) ||
    path.split("/").some(part => part.startsWith("."))
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path;

    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return reply("Bad request", 400);
    }

    // 不公開 Worker、設定檔及隱藏檔案。
    if (isInternalFile(path)) {
      return reply("Not found", 404);
    }

    // 登入：使用 Cloudflare Secret PORTAL_PASSWORD 驗證。
    if (path === "/api/login" && request.method === "POST") {
      if (!env.PORTAL_PASSWORD || !env.SESSION_SECRET) {
        return jsonReply(
          { error: "伺服器尚未完成登入設定。" },
          503
        );
      }

      if (request.headers.get("Origin") !== url.origin) {
        return jsonReply({ error: "Forbidden" }, 403);
      }

      const contentType =
        request.headers.get("Content-Type") || "";

      if (!contentType.toLowerCase().includes("application/json")) {
        return jsonReply({ error: "Invalid content type" }, 415);
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return jsonReply({ error: "Invalid request" }, 400);
      }

      if (
        typeof body.password !== "string" ||
        body.password.length > 256
      ) {
        return jsonReply({ error: "密碼錯誤。" }, 401);
      }

      if (body.password !== env.PORTAL_PASSWORD) {
        return jsonReply({ error: "密碼錯誤。" }, 401);
      }

      const session = await createSession(env.SESSION_SECRET);
      const maxAge = Math.max(
        0,
        session.exp - Math.floor(Date.now() / 1000)
      );

      return jsonReply(
        { authenticated: true },
        200,
        {
          "Set-Cookie":
            `${COOKIE_NAME}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
        }
      );
    }

    // 首頁載入時，檢查是否已有有效登入狀態。
    if (path === "/api/session" && request.method === "GET") {
      if (!env.SESSION_SECRET) {
        return jsonReply(
          { error: "伺服器尚未完成登入設定。" },
          503
        );
      }

      const authenticated = await isAuthenticated(
        request,
        env.SESSION_SECRET
      );

      return jsonReply({ authenticated });
    }

    // 不允許其他 API 路徑直接存取。
    if (path.startsWith("/api/")) {
      return reply("Not found", 404);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply("Method not allowed", 405, {
        Allow: "GET, HEAD"
      });
    }

    // 只有首頁可以公開；其他檔案都需要有效登入狀態。
    const isPublicPage = path === "/" || path === "/index.html";

    if (!isPublicPage) {
      if (!env.SESSION_SECRET) {
        return reply("伺服器尚未完成登入設定。", 503);
      }

      const authenticated = await isAuthenticated(
        request,
        env.SESSION_SECRET
      );

      if (!authenticated) {
        // iframe 內的模組顯示拒絕訊息，避免巢狀載入首頁。
        if (request.headers.get("Sec-Fetch-Dest") === "iframe") {
          return reply("請返回 EngineeringPortal 首頁登入後再使用。", 401);
        }

        return reply("", 302, {
          Location: "/?reauth=1"
        });
      }
    }

    // 將請求交給 Cloudflare 靜態資產服務。
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
