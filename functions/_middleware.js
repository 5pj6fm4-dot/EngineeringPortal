// functions/_middleware.js

// 1. 與前端一致的 CRC32 演算法
function crc32(s) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  let crc = -1;
  for (let i = 0; i < s.length; i++) crc = (crc >>> 8) ^ t[(crc ^ s.charCodeAt(i)) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

// 2. 取得 3 個月自動更新的授權碼 (按季度 Q1~Q4 更新)
function getQuarterPassword() {
  const d = new Date();
  const yr = String(d.getFullYear()).slice(-2); // 例如 "24"
  const quarter = Math.floor(d.getMonth() / 3) + 1; // 1, 2, 3, 4
  
  const raw = yr + "Q" + quarter + "taigene5pj6"; // 自訂鹽值
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
        return parts[1].trim();
      }
    }
  }
  return null;
}

// 4. 中介軟體主邏輯：攔截對 modules 資料夾的所有請求
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 如果使用者請求的是 modules 資料夾底下的任何網頁
  if (url.pathname.startsWith('/modules/')) {
    const expectedPwd = getQuarterPassword();
    const authCookie = getCookie(request, 'portal_auth_token');

    // 驗證失敗：拒絕存取並引導至首頁
    if (authCookie !== expectedPwd) {
      return new Response(
        `<html>
          <head><meta charset="UTF-8"><title>未經授權</title></head>
          <body style="font-family:sans-serif; text-align:center; padding:50px; background:#f3f6fb; color:#1e293b;">
            <h2>⚠️ 存取被拒絕</h2>
            <p>您未經授權，無法直接存取此工程模組。請回到首頁輸入最新授權碼登入。</p>
            <a href="/" style="display:inline-block; margin-top:20px; padding:10px 20px; background:#2563eb; color:white; text-decoration:none; border-radius:6px; font-weight:bold;">返回首頁</a>
          </body>
        </html>`, 
        {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
      );
    }
  }

  // 驗證成功：繼續讀取原本的靜態網頁
  return next();
}
