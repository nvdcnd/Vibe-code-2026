# MailCraft AI

Trình soạn email marketing: nhập thông tin chiến dịch → nhận **3 mẫu email** khác hướng
(tiêu đề + nội dung + CTA) → biên tập, viết lại theo tông giọng, đính ảnh, xuất HTML/mailto.

- **Frontend**: HTML/CSS/JS thuần, không framework, không build step. Ba "trang" (`#home`,
  `#studio`, `#guide`) nằm trong một `index.html`, điều hướng bằng hash.
- **Backend**: Cloudflare Pages Functions (`functions/`), gọi Gemini. Không có khoá AI thì
  app tự chạy **chế độ trải nghiệm** với nội dung mẫu và ghi rõ trạng thái trên UI — không
  bao giờ giả vờ là AI.

> Tài liệu phân tích bản gốc + lịch sử thay đổi: [`DOCUMENT.md`](./DOCUMENT.md).  
> Minh chứng sử dụng AI: [`AI_EVIDENCE.md`](./AI_EVIDENCE.md).  
> Tài liệu kiểm thử chi tiết: [`TESTING.md`](./TESTING.md).  
> README này là tài liệu dành cho người phát triển.

---

## Bắt đầu nhanh

```bash
npm ci                # cài dependency (đã có package-lock.json)
npm run dev           # wrangler pages dev . --port 8788  → http://127.0.0.1:8788
```

Không muốn cài wrangler? Chạy frontend thuần (demo mode, không có `/api`):

```bash
npm run dev:static    # node scripts/serve-static.mjs --port 8787 → http://127.0.0.1:8787
```

Bật AI thật: copy `.dev.vars.example` → `.dev.vars`, điền `GEMINI_API_KEY`
([Google AI Studio](https://aistudio.google.com/app/apikey)), rồi `npm run dev`.
Nhãn ở Studio đổi thành **"AI đã cấu hình"**.

### Biến môi trường

| Biến               | Loại       | Bắt buộc             | Ý nghĩa                                                     |
| ------------------ | ---------- | -------------------- | ----------------------------------------------------------- |
| `GEMINI_API_KEY`   | Secret     | không (thiếu → demo) | Khoá Google AI Studio                                       |
| `GEMINI_MODEL`     | Var        | không                | Mặc định `gemini-3.8-flash`                                 |
| `RATE_LIMIT_DAILY` | Var        | không                | Số lượt/ngày/IP cho mỗi endpoint (mặc định `30`, `0` = tắt) |
| `RATE_LIMIT_KV`    | KV binding | không                | Thiếu binding = không giới hạn (chỉ nên dùng khi dev)       |
| `MEDIA_BUCKET`     | R2 binding | không                | Thiếu → ảnh nhúng base64 thay vì URL                        |

`.dev.vars` đã nằm trong `.gitignore` và **không** được copy vào `dist/` (có test canh).

---

## Cấu trúc

```
index.html            # toàn bộ 3 trang + markup wizard 3 bước
styles.css            # design tokens + layout + responsive
app.js                # toàn bộ logic UI (classic script, không module)
favicon.svg
functions/
  _lib.js             # helper dùng chung: validate, clamp, prompt, Gemini client, rate limit
  api/status.js       # GET  → {mode:"ai"|"demo"}
  api/generate.js     # POST → {emails:[3 × {subject,body,cta}]}
  api/rewrite.js      # POST → {email:{subject,body,cta}}
  api/upload.js       # POST → {url:"/media/…"} (cần R2)
  media/[[path]].js   # GET  → phục vụ ảnh từ R2
_headers              # CSP + security headers (Cloudflare Pages đọc lúc deploy)
robots.txt
scripts/
  serve-static.mjs    # server tĩnh cho dev/e2e (thay python http.server), áp cả _headers
  verify-dist.mjs     # chốt chặn trước deploy: đủ file, không lẫn secret, CSP còn nguyên
tests/unit/           # unit test backend (node:test, không cần thư viện)
e2e/                  # Playwright: luồng demo, điều hướng, biên tập, AI (giả lập)
build-dist.mjs        # dựng dist/ sạch để deploy
```

### Hợp đồng API (đã có test canh)

| Endpoint             | Vào                                        | Ra                  | Lỗi                         |
| -------------------- | ------------------------------------------ | ------------------- | --------------------------- |
| `GET /api/status`    | —                                          | `{mode}`            | luôn 200 JSON               |
| `POST /api/generate` | `{brand, goal, offer, industry, audience}` | `{emails}` (đúng 3) | 400 · 429 · 500 · 502 · 504 |
| `POST /api/rewrite`  | `{campaign, email, tone}`                  | `{email}`           | như trên                    |
| `POST /api/upload`   | body nhị phân + `Content-Type`             | `{url}`             | 405 · 413 · 415 · 501       |
| `GET /media/*`       | —                                          | ảnh                 | 400 · 404 · 501             |

Mọi lỗi đều là `{error:"<tiếng Việt>"}` và frontend đưa thẳng lên toast. Backend **cố ý
không trả `schedule`**: frontend tự dùng bảng giờ gửi tĩnh theo ngành.

---

## Kiểm thử

Hai tầng, chạy độc lập, không cần mạng và không cần khoá AI:

```bash
npm run test:unit     # node:test — backend + helper thuần
npm run test:e2e      # Playwright — trình duyệt thật
npm test              # cả hai
npm run check         # lint + format + unit (nhanh, dùng trước khi commit)
npm run ci            # đúng những gì CI chạy
```

### Tầng 1 — Unit test backend (`tests/unit/`, `node --test`)

Chạy bằng test runner có sẵn của Node nên **không thêm dependency**. Phạm vi:

- `lib.test.mjs` — validate/clamp đầu vào, dựng prompt, `cleanKeepNewlines`, nhận diện ảnh
  bằng magic bytes, rate limit theo IP/ngày, và toàn bộ `askGeminiJson` (bóc JSON fence,
  retry hạ temperature, 429/401/5xx/timeout/SAFETY → status + thông điệp đúng).
- `handlers.test.mjs` — hợp đồng HTTP của từng Pages Function: status code, shape JSON,
  **không gọi upstream khi đầu vào sai**, 405 cho phương thức lạ, hành vi 501/413/415,
  chặn path traversal ở `/media`.

`fetch` và KV/R2 binding được giả lập, nên test tất định và không tốn quota Gemini.

### Tầng 2 — E2E (`e2e/`, Playwright + Chromium)

| File                  | Nội dung                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `app.spec.mjs`        | luồng demo: validate form → 3 mẫu → viết lại theo tông → preview → giờ gửi                            |
| `navigation.spec.mjs` | hash router, tiêu đề tab, skip-link, menu di động, preset                                             |
| `editor.spec.mjs`     | bộ đếm, ảnh (kể cả từ chối/giới hạn), HTML tuỳ chỉnh, cờ "chưa khớp", XSS, tải file, clipboard, reset |
| `ai-mode.spec.mjs`    | nhánh AI với `/api/*` giả lập: payload gửi lên, lỗi 429/JSON hỏng, ảnh R2                             |
| `pure.spec.mjs`       | "unit" cho hàm frontend ngay trong trình duyệt (`escapeHTML`, `buildMailtoUrl`, `normalizeEmails`…)   |
| `headers.spec.mjs`    | security headers, CSP có hiệu lực thật, CSP không phá preview, `robots.txt`, `_headers` không public  |

Server cho E2E là `scripts/serve-static.mjs` (Node, không cần Python) và **không** có `/api`
— chính là điều kiện để kiểm tra fallback demo. Nhánh AI được kiểm tra bằng `page.route()`
nên chạy được trong CI mà không cần secret.

Server này đọc luôn `_headers` và gắn CSP/security headers như Cloudflare Pages, nên toàn bộ
suite E2E chạy dưới đúng policy production. Muốn thử nhanh không có header:
`node scripts/serve-static.mjs --port 8790 --no-headers`.

Playwright lấy Chromium của chính nó (`npx playwright install chromium`). Máy nào muốn dùng
Chrome cài sẵn: `PW_CHANNEL=chrome npm run test:e2e`.

---

## CI (`.github/workflows/ci.yml`)

Bốn job chạy song song cho mỗi push/PR:

1. **Lint & format** — `eslint .` + `prettier --check .`.
2. **Unit** — trên Node 20, 22, 24.
3. **E2E** — cài Chromium (có cache), chạy toàn bộ spec, upload report khi fail.
4. **Build & deploy readiness** — `npm run build`, `verify-dist` (không lẫn `.dev.vars`,
   tài liệu, test vào `dist/`), và bundle `functions/` bằng wrangler để bắt lỗi import.

CI **không** deploy. Deploy là bước có chủ đích:

```bash
npm run deploy        # build → verify:dist → wrangler pages deploy dist
```

Trên dashboard Cloudflare Pages: thêm Secret `GEMINI_API_KEY`, (khuyến nghị) tạo KV
namespace cho `RATE_LIMIT_KV` và R2 bucket cho `MEDIA_BUCKET`.

### Header bảo mật (`_headers`)

`_headers` ở gốc repo (được copy vào `dist/`) gắn cho mọi asset tĩnh:

- **CSP**: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`, `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (cho trình duyệt cũ),
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` tắt camera/mic/geo…

Hai điểm **cố ý**, đừng "dọn dẹp" mà không đọc `_headers`:

1. `style-src` phải có `'unsafe-inline'`. Khung xem trước email là `iframe srcdoc` và kế
   thừa CSP của trang cha; email dựng layout bằng `style="…"`. Bỏ `'unsafe-inline'` thì
   preview mất toàn bộ style — `e2e/headers.spec.mjs` sẽ fail đúng chỗ đó.
2. Trang vẫn cho phép hai CDN ngoài (`fonts.googleapis.com`, `cdn.jsdelivr.net`). Muốn tự
   chủ 100% thì tải font/icon về local rồi siết lại `style-src`/`font-src`.

**`_headers` không áp cho Pages Functions** — đó là quy tắc của Cloudflare. Vì vậy
`/api/*` và `/media/*` tự đặt header trong code (`nosniff`), và dev server cũng không áp
`_headers` cho `/api/*` để khớp hành vi thật.

Bộ test khoá cả hai chiều: `verify:dist` fail nếu mất CSP, chứa `'unsafe-eval'` hoặc
`script-src` quá rộng; `headers.spec.mjs` chứng minh CSP **thật sự chặn** script nội tuyến
và script từ miền lạ, đồng thời không phá preview.

### `SITE_URL` và `sitemap.xml`

Miền production không được đoán trong repo. Khi deploy, đặt `SITE_URL` để build sinh
`sitemap.xml` đúng miền (không đặt thì bỏ qua, và `robots.txt` vẫn hợp lệ):

```bash
SITE_URL=https://mailcraft.example npm run deploy
```

---

## Quy ước

- Prettier định dạng `tests/`, `scripts/`, `e2e/`, config…; **`app.js`, `styles.css`,
  `index.html`, `functions/` được giữ nguyên định dạng gốc** (xem `.prettierignore`) để
  review không bị nhiễu. ESLint áp dụng cho tất cả.
- Nội dung người dùng chỉ được chèn vào DOM qua `textContent`/`replaceChildren`; mọi chỗ
  nối chuỗi HTML phải đi qua `escapeHTML()`.
- Không bịa số liệu marketing (deadline, % giảm giá, khan hiếm): prompt và template demo
  đều cấm, và có test canh cho tông "khẩn cấp".

## Giới hạn đã biết

- State chỉ sống trong tab (refresh là mất chiến dịch) — đúng thiết kế gốc.
- `mailto:` chỉ mang văn bản + link (RFC 2368); ảnh phải đi qua file HTML tải về.
- Ảnh base64 làm file HTML nặng (~1.3× dung lượng gốc); nên cấu hình R2 để dùng URL.
- Hai CDN ngoài (Google Fonts, jsDelivr Remix Icon): nếu cần tự chủ 100%, tải về local và
  sửa hai thẻ `<link>` trong `index.html`.
- `sitemap.xml` chỉ có khi deploy kèm `SITE_URL`; app một trang nên giá trị SEO của nó nhỏ.
- HSTS không đặt trong `_headers`: nó là policy cấp miền, nên bật ở zone Cloudflare để
  không tự khoá mình khi thử nghiệm trên HTTP.
- CSP dùng `style-src 'unsafe-inline'` (lý do ở mục Header bảo mật); `script-src` thì vẫn
  khoá chặt nên rủi ro XSS chèn script không tăng.
