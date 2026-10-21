
const PROTECTED_PATHS = [
  "/modules/",
  "/data/",
  "/assets/js/"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 首頁與登入頁面維持公開
    if (path === "/" || path === "/index.html") {
      return env.ASSETS.fetch(request);
    }

    // 阻擋工程檔案的直接存取
    if (PROTECTED_PATHS.some(prefix => path.startsWith(prefix))) {
      return new Response(
        "需要授權才能存取此工程檔案。",
        {
          status: 403,
          headers: {
            "Content-Type": "text/plain; charset=UTF-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
