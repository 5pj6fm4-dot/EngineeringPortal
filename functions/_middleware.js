// functions/_middleware.js

// 1. 與前端一致的 CRC32 演算法
function crc32(s) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  let crc = -1;
  for (let i = 0; i < s.length; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ s.charCodeAt(i)) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

// 2. 取得 3 個月自動更新的授權碼 (按季度 Q1~Q4 更新)
function getQuarterPassword() {
  const d = new Date();
  const yr = String(d.getFullYear()).slice(-2); // 例如 "26"
  const quarter = Math.floor(d.getMonth() / 3) + 1; // 1, 2, 3, 4
  
  const raw = yr + "Q" + quarter + "taigene5pj6"; // 自訂鹽值，必須與前端 index.html 保持一致
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let res = "";
  for (let i = 1; i <= 6; i++) {
    res += chars.charAt(Math.abs(crc32(raw + i)) % chars.length);
  }
  return res;
}

// 3. 取得 Cookie 的值
function getCookie(request, name) {
  const cookieString = request.headers.get('Cookie');
  if (cookieString) {
    const cookies = cookieString.split(';');
    for (let cookie of cookies) {
      const parts = cookie.split('=');
      if (parts[0].trim() === name) {
        return parts.trim();
      }
    }
  }
  return null;
}

// 4. 中介軟體主邏輯：嚴格限定只攔截 modules 目錄下的 HTML 檔案
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 【核心修正】：我們只在路徑明確指向 /modules/ 開頭的資源時才進行攔截
  if (url.pathname.startsWith('/modules/')) {
    const expectedPwd = getQuarterPassword();
    const authCookie = getCookie(request, 'portal_auth_token');

    // 驗證失敗：拒絕存取，回傳未授權提示。
    if (authCookie !== expectedPwd) {
      return new Response(
        `<html>
          <head>
            <meta charset="UTF-8">
            <title>未經授權</title>
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #cbd5e1; }
              .card { max-width: 450px; margin: 0 auto; background: #1e293b; padding: 30px; border-radius: 8px; border: 1px solid #334155; }
              a { display: inline-block; margin-top: 20px; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
              a:hover { background: #1d4ed8; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>⚠️ 存取被拒絕</h2>
              <p>您未經授權，無法直接存取此工程模組檔案。請先回到入口首頁輸入當季授權碼登入。</p>
              <a href="/">返回工程首頁</a>
            </div>
          </body>
        </html>`, 
        {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      );
    }
  }

  // 只要不是 /modules/ 開頭（例如首頁 /、css/*、assets/*），一律直接放行，完全不作任何干涉
  return next();
}
