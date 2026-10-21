# ==========================================================
# server/server.py - 整合資安驗證的 Python 伺服器 (範例)
# ==========================================================
import http.server
import socketserver
import urllib.parse
import json
import datetime
import hashlib

PORT = 8000
ADMIN_PASSWORD = "5Pj6xul68"  # 您的管理員密碼

# 簡易的記憶體 Token 庫，用來儲存本週已驗證通過的授權 Key
VALID_TOKENS = set()

# 計算本週密碼的函數 (與前端演算法一致)
def get_weekly_password():
    # 這裡實作您原本在前端的密碼產生邏輯
    # 鎖在後端 Python 中，使用者不論如何按 F12 都絕對看不到這段密碼計算演算法
    today = datetime.date.today()
    yr = str(today.year)[-2:]
    # 取得 ISO 週別
    wk = today.isocalendar()
    wk_str = f"0{wk}" if wk < 10 else str(wk)
    raw = f"{yr}{wk_str}5pj6fm4"
    
    # 簡易雜湊生成 6 碼
    h = hashlib.md5(raw.encode()).hexdigest()
    return h[:6].upper()

class SecurePortalHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        # 處理登入驗證
        if self.path == '/api/login':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            params = json.loads(post_data.decode('utf-8'))
            
            user_input = params.get('password', '').strip().upper()
            weekly_pwd = get_weekly_password()
            
            if user_input == weekly_pwd:
                # 驗證成功，產生一個隨機的安全 Token
                session_token = hashlib.sha256(f"{user_input}{datetime.datetime.now()}".encode()).hexdigest()
                VALID_TOKENS.add(session_token)
                
                # 回傳成功並發放 Token
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success", "token": session_token}).encode())
            else:
                self.send_response(401)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "fail", "message": "授權碼錯誤"}).encode())
            return
            
        super().do_POST()

    def do_GET(self):
        # 核心防護：如果使用者嘗試直接讀取 modules/ 底下的工具網頁
        if "modules/" in self.path:
            # 檢查其請求中是否帶有我們認可的有效 Token (例如讀取 Cookie)
            cookie_header = self.headers.get('Cookie', '')
            has_valid_token = False
            
            if cookie_header:
                cookies = dict(urllib.parse.parse_qsl(cookie_header.replace('; ', '&')))
                token = cookies.get('portal_token', '')
                if token in VALID_TOKENS:
                    has_valid_token = True
            
            # 如果沒有安全 Token，直接回傳 403 拒絕存取，或者強行導回入口首頁
            if not has_valid_token:
                self.send_response(403) # 403 Forbidden
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write("<h1>⚠️ 存取被拒絕 Access Denied</h1><p>您未經授權。請先透過主入口網頁 (index.html) 輸入本週授權碼登入。</p>".encode('utf-8'))
                return

        # 其他靜態檔案 (如 index.html, assets/) 正常允許讀取
        super().do_GET()

if __name__ == '__main__':
    # 啟動伺服器
    with socketserver.TCPServer(("", PORT), SecurePortalHandler) as httpd:
        print(f"Taigene Portal 安全伺服器已啟動於 http://localhost:{PORT}")
        httpd.serve_forever()
