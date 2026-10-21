
const COOKIE_NAME = "__Host-engineeringportal_session";
const SESSION_SECONDS = 8 * 60 * 60;

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  );
}

async function createSession(secret) {
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })
    )
  );
  const signature = base64url(await sign(payload, secret));
  return `${payload}.${signature}`;
}

async function isAuthenticated(request, secret) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const prefix = `${COOKIE_NAME}=`;
  const cookie = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(prefix));

  if (!cookie) return false;

  const token = cookie.slice(prefix.length);
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  try {
    const expected = base64url(await sign(parts[0], secret));
    if (expected !== parts[1]) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64url(parts[0]))
    );

    return Number.isFinite(payload.exp) &&
      payload.exp > Math.floor(Date.now() / 1000);
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

function loginPage(message = "") {
  return response(`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>EngineeringPortal 登入</title>
<style>
body{font-family:Arial,sans-serif;max-width:420px;margin:12vh auto;padding:24px;color:#222}
h1{font-size:24px}label{display:block;margin:16px 0 6px}
input{box-sizing:border-box;width:100%;padding:12px;font-size:16px}
button{margin-top:20px;width:100%;padding:12px;font-size:16px;cursor:pointer}
.error{color:#b00020}
</style>
</head>
<body>
<h1>EngineeringPortal</h1>
<p>請登入以存取工程資料。</p>
<p class="error" role="alert">${message}</p>
<form method="post" action="/api/login">
<label for="username">帳號</label>
<input id="username" name="username" autocomplete="username" required maxlength="128">
<label for="password">密碼</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024">
<button type="submit">登入</button>
</form>
</body>
</html>`, 200, {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/login") {
      return loginPage();
    }

    if (request.method === "POST" && path === "/api/login") {
      if (!env.PORTAL_USERNAME || !env.PORTAL_PASSWORD || !env.SESSION_SECRET) {
        return response("登入設定尚未完成。", 503);
      }

      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.includes("application/x-www-form-urlencoded")) {
        return response("不支援的請求格式。", 415);
      }

      let form;
      try {
        form = await request.formData();
      } catch {
        return response("登入資料格式錯誤。", 400);
      }

      const username = String(form.get("username") || "");
      const password = String(form.get("password") || "");

      if (
        username !== env.PORTAL_USERNAME ||
        password !== env.PORTAL_PASSWORD
      ) {
        return loginPage("帳號或密碼錯誤。");
      }

      const token = await createSession(env.SESSION_SECRET);

      return response("", 303, {
        "Location": "/",
        "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
      });
    }

    if (request.method === "POST" && path === "/api/logout") {
      return response("", 303, {
        "Location": "/login",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      });
    }

    if (!env.SESSION_SECRET) {
      return response("伺服器登入設定尚未完成。", 503);
    }

    if (!(await isAuthenticated(request, env.SESSION_SECRET))) {
      if (request.method === "GET" || request.method === "HEAD") {
        return response("", 302, { "Location": "/login" });
      }
      return response("需要登入才能存取此資源。", 401);
    }

    if (path === "/login" || path === "/api/login") {
      return response("", 404);
    }

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
