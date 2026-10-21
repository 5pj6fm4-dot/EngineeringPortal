
const COOKIE_NAME = "__Host-engineeringportal_gate";
const CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

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
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(value)
    )
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

function nextMonthBoundary(period) {
  const [year, month] = period.split("-").map(Number);

  // Taiwan time is UTC+8.
  return Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000;
}

async function monthlyCode(secret, period) {
  const bytes = await hmac(secret, `EngineeringPortal|${period}`);

  return Array.from(
    { length: 6 },
    (_, i) => CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  ).join("");
}

async function createSession(secret, period) {
  const exp = Math.floor(nextMonthBoundary(period) / 1000);

  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ exp, period }))
  );

  const signature = base64url(await hmac(secret, payload));

  return { token: `${payload}.${signature}`, exp };
}

async function isAuthenticated(request, secret) {
  const header = request.headers.get("Cookie") || "";
  const prefix = `${COOKIE_NAME}=`;

  const cookie = header
    .split(";")
    .map(s => s.trim())
    .find(s => s.startsWith(prefix));

  if (!cookie) return false;

  const parts = cookie.slice(prefix.length).split(".");
  if (parts.length !== 2) return false;

  try {
    const expected = base64url(await hmac(secret, parts[0]));
    if (expected !== parts[1]) return false;

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

function isProtectedPath(path) {
  return (
    path === "/modules" ||
    path.startsWith("/modules/") ||
    path === "/data" ||
    path.startsWith("/data/") ||
    path === "/assets/js" ||
    path.startsWith("/assets/js/")
  );
}

function isInternalFile(path) {
  return new Set([
    "/worker.js",
    "/wrangler.jsonc",
    "/.gitignore",
    "/.assetsignore",
    "/package.json",
    "/package-lock.json",
    "/README.md"
  ]).has(path) || path === "/.git" || path.startsWith("/.git/");
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

    if (isInternalFile(path)) {
      return reply("Not found", 404);
    }

    // Verify the monthly code submitted by index.html.
    if (path === "/api/verify" && request.method === "POST") {
      if (!env.SESSION_SECRET) {
        return reply("Server configuration error", 503);
      }

      if (request.headers.get("Origin") !== url.origin) {
        return reply("Forbidden", 403);
      }

      if (
        !(request.headers.get("Content-Type") || "")
          .toLowerCase()
          .includes("application/json")
      ) {
        return reply("Unsupported content type", 415);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return reply("Invalid request", 400);
      }

      if (
        typeof body.password !== "string" ||
        body.password.length > 128
      ) {
        return reply("Incorrect password", 401);
      }

      const period = currentPeriod();
      const expected = await monthlyCode(env.SESSION_SECRET, period);

      if (body.password !== expected) {
        return reply("Incorrect password", 401);
      }

      const session = await createSession(env.SESSION_SECRET, period);
      const maxAge = Math.max(
        0,
        session.exp - Math.floor(Date.now() / 1000)
      );

      return reply(JSON.stringify({ ok: true }), 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie":
          `${COOKIE_NAME}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
      });
    }

    // Only engineering resources require the monthly verification.
    if (isProtectedPath(path)) {
      if (!env.SESSION_SECRET) {
        return reply("Server configuration error", 503);
      }

      if (!(await isAuthenticated(request, env.SESSION_SECRET))) {
        return reply("", 302, { Location: "/?reauth=1" });
      }
    }

    // Homepage and ordinary public files remain accessible.
    return env.ASSETS.fetch(request);
  }
};
