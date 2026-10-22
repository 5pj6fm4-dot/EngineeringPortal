const SESSION_COOKIE = "ep_session";
const SESSION_SECONDS = 8 * 60 * 60;

function getPortalKeys(env) {
  const value = env.PORTAL_MASTER_KEY;

  if (!value || !value.includes("|")) {
    throw new Error("Portal security configuration is missing.");
  }

  const separator = value.indexOf("|");

  return {
    adminPin: value.slice(0, separator),
    signingKey: value.slice(separator + 1)
  };
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);

  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(message)
    )
  );
}

function getTaiwanQuarter() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric"
  }).formatToParts(new Date());

  const year = Number(parts.find(p => p.type === "year").value);
  const month = Number(parts.find(p => p.type === "month").value);

  return {
    year,
    quarter: Math.floor((month - 1) / 3) + 1
  };
}

async function getQuarterPassword(signingKey) {
  const { year, quarter } = getTaiwanQuarter();
  const digest = await hmac(
    signingKey,
    `EngineeringPortal|${year}|Q${quarter}`
  );

  const number = (
    digest[0] * 0x100000000 +
    digest[1] * 0x1000000 +
    digest[2] * 0x10000 +
    digest[3] * 0x100 +
    digest[4]
  ) % 1000000;

  return {
    password: String(number).padStart(6, "0"),
    year,
    quarter
  };
}

async function createSession(signingKey) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const signature = await hmac(signingKey, `session:${expires}`);

  return `${expires}.${base64UrlEncode(signature)}`;
}

async function isAuthorized(request, signingKey) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)ep_session=([^;]+)/);

  if (!match) return false;

  const parts = match[1].split(".");
  if (parts.length !== 2) return false;

  const expires = Number(parts[0]);
  if (!Number.isSafeInteger(expires) ||
      expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  try {
    const expected = await hmac(signingKey, `session:${expires}`);
    const supplied = base64UrlDecode(parts[1]);

    if (expected.length !== supplied.length) return false;

    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= expected[i] ^ supplied[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isProtectedPath(path) {
  return (
    path.startsWith("/modules/") ||
    path.startsWith("/data/") ||
    path.startsWith("/assets/js/")
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    let keys;

    try {
      keys = getPortalKeys(env);
    } catch {
      return json({ error: "伺服器尚未完成安全設定。" }, 503);
    }

    if (request.method === "POST" && path === "/api/portal/login") {
      const body = await readJson(request);
      if (!body || typeof body.password !== "string") {
        return json({ error: "請輸入季度授權碼。" }, 400);
      }

      const current = await getQuarterPassword(keys.signingKey);

      if (body.password !== current.password) {
        return json({ error: "季度授權碼錯誤或已過期。" }, 401);
      }

      const session = await createSession(keys.signingKey);

      return json(
        { success: true },
        200,
        {
          "Set-Cookie":
            `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`
        }
      );
    }

    if (request.method === "POST" && path === "/api/portal/admin-code") {
      const body = await readJson(request);

      if (
        !body ||
        typeof body.password !== "string" ||
        body.password !== keys.adminPin
      ) {
        return json({ error: "管理員密碼錯誤。" }, 401);
      }

      const current = await getQuarterPassword(keys.signingKey);

      return json({
        success: true,
        password: current.password,
        year: current.year,
        quarter: current.quarter
      });
    }

    if (request.method === "POST" && path === "/api/portal/logout") {
      return json(
        { success: true },
        200,
        {
          "Set-Cookie":
            `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
        }
      );
    }

    if (isProtectedPath(path)) {
      if (!(await isAuthorized(request, keys.signingKey))) {
        if (path.startsWith("/api/")) {
          return json({ error: "請先登入 EngineeringPortal。" }, 401);
        }

        return new Response("需要登入 EngineeringPortal 才能存取此檔案。", {
          status: 401,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};