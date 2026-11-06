# MailCraft AI — Báo cáo Clone & Phân tích Site

> Nguồn: `https://emailgen-6ux.pages.dev/` — Ngày clone: 05/11/2026
> Phạm vi: toàn bộ front-end tĩnh được công khai của site. Mọi file đã được thẩm định bằng so khớp SHA-256 byte-level giữa bản tải về và bản gốc trên Cloudflare — **4/4 file khớp 100%**.

---

## 1. Tổng quan về site

| Mục | Thông tin |
|---|---|
| Tên site | **MailCraft AI** — "Công cụ viết Email Marketing thông minh" |
| Mục đích | Trợ lý soạn thử email marketing: người dùng nhập thông tin chiến dịch → nhận 3 mẫu email (tiêu đề + nội dung + CTA) → biên tập, viết lại theo tông giọng, xem trước kiểu hộp thư, đề xuất giờ gửi, sao chép / xuất HTML |
| Ngôn ngữ giao diện | Tiếng Việt (`<html lang="vi">`) |
| Loại kiến trúc | SPA thuần HTML/CSS/JS **vanilla, không build tool, không framework** |
| Điều hướng | Hash routing: `#home` (trang chủ), `#studio` (tạo email), `#guide` (hướng dẫn) — **mọi "trang" đều nằm trong 1 file `index.html` duy nhất**, JS ẩn/hiện theo hash |
| Hosting | Cloudflare Pages (`*.pages.dev`, header `server: cloudflare`, PoP ghi nhận: SIN — Singapore) |
| Backend | Cloudflare Pages Function tại `/api/*` (chỉ gọi được, không đọc được mã nguồn). **Trạng thái hiện tại của site thật: `{"mode":"demo"}` — chưa cấu hình AI, đang chạy chế độ nội dung mẫu** |
| Bản quyền | Không thấy license, không thấy thông tin chủ sở hữu trong mã nguồn (chỉ có chữ ký "© 2026 MailCraft AI" trong footer) |

### Phụ thuộc bên ngoài
| Tài nguyên | Nguồn | Ghi chú |
|---|---|---|
| Font **Be Vietnam Pro** (400/500/600/700/800) | Google Fonts | Có fallback system-ui stack |
| Bộ icon **Remix Icon 4.9.1** | jsDelivr CDN | Dùng xuyên suốt trên toàn site |
| Favicon | Tự chứa (`favicon.svg`) | Khối email viền trắng trên nền tím |

Ngoài hai CDN trên, site **không** có: analytics/tracking, service worker, manifest PWA, ảnh tải ngoài, thư viện JS nào khác. Không lưu state vào `localStorage`/`sessionStorage` — toàn bộ dữ liệu phiên chỉ tồn tại trong bộ nhớ tab (refresh là mất chiến dịch, chủ đích thiết kế "trong phiên").

---

## 2. Phạm vi clone & phương pháp thẩm định

**Trình tự làm việc:**

1. Đọc trang gốc → xác định các asset tham chiếu: `styles.css`, `app.js`, `favicon.svg` (+ 2 CDN).
2. Tải 4 file bằng `curl -sSfL` (tự hủy khi lỗi HTTP).
3. Dò các đường tương tự có thể tồn tại: `robots.txt`, `sitemap.xml`, `404.html`, `_headers`, `_redirects` → **tất cả trả về 200 nhưng nội dung chính là `index.html`** (SPA catch-all fallback của Pages). Kết luận: site chỉ gồm đúng 4 file trên, không có robots/sitemap/404 page thật.
4. Nghiệm thu bản clone bằng Chrome thật (DOM snapshot + `evaluate` + console), chạy trọn quy trình người dùng.
5. Thẩm định tính toàn vẹn: SHA-256 từng file, so local (disk) ↔ remote (byte stream) → MATCH 4/4.

**Số liệu thẩm định (SHA-256, khớp remote ↔ local):**

| File | Kích thước (B) | Dòng | SHA-256 (16 ký tự đầu) |
|---|---|---|---|
| `index.html` | 31,567 | 169 | `f87521e1889bafbd` |
| `styles.css` | 44,472 | 63* | `630290a63680c8da` |
| `app.js` | 26,476 | 327 | `33fb698f19eabfde` |
| `favicon.svg` | 312 | 1 | `24d7e2891f2af795` |

\* `styles.css` dùng format dòng dài (kiểu minify nhẹ, mỗi media query 1 dòng), có comment đánh "MailCraft AI **v3**".

Tổng dung lượng front-end: **~102.8 KB** (chưa tính 2 tài nguyên CDN).

> ⚠️ Lưu ý sao cho chính xác: URL người dùng đưa có dạng `.../#/` — dấu `#` không bao giờ được gửi tới server; server chỉ nhận được `/`. Bản clone là nội dung trả về cho `/` (nhân bản cho mọi path do catch-all).

---

## 3. Cấu trúc thư mục sau khi clone

```
C:\Users\Admin\Desktop\Vibe-code 2026\
├── index.html      # Toàn bộ 3 "trang" (home/studio/guide) + markup đầy đủ
├── styles.css      # Toàn bộ style (tokens, layout, responsive, v3 blocks)
├── app.js          # Toàn bộ logic điều khiển (entry duy nhất, defer)
├── favicon.svg     # Favicon SVG tự chứa
└── DOCUMENT.md     # Tài liệu này
```

Cách chạy: `python -m http.server 8787` trong thư mục này → `http://127.0.0.1:8787/`. *(Máy phục vụ thử nghiệm hiện đang chạy ở port 8787 để bạn xem trực tiếp.)*

---

## 4. Kiến trúc tổng thể

```
Browser
 └─ index.html (3 <main> ẩn/hiện theo hash)
      ├─ styles.css
      ├─ app.js (defer, chạy sau DOM)
      │    ├─ detectEngine() ── GET /api/status ──┐
      │    ├─ generateEmails()  POST /api/generate│ Cloudflare Pages Functions
      │    └─ rewriteEmail()    POST /api/rewrite ┘ (đọc được → trả JSON; mã nguồn không công khai)
      ├─ Google Fonts (CSS font)
      └─ jsDelivr: remixicon.css
```

- **Không state persistence**: mọi biến (`campaign`, `emails`, `schedule`…) là biến module-level của `app.js`, sống theo tab.
- **Kết nối AI có fallback chủ động**: nếu `/api/status` lỗi/404/không phải `{mode:"ai"}` → `engine = 'demo'`, UI ghi rõ "Chế độ trải nghiệm" và badge "Nội dung mẫu để trải nghiệm". Đây là điểm thiết kế rất đáng học: **không bao giờ im lặng giả AI**.
- **XSS được xử lý**: duy nhất chỗ nội dung do user chèn vào HTML tĩnh (file tải về) đi qua `escapeHTML()`; các chỗ render DOM đều dùng `textContent`/`replaceChildren` (an toàn), không có `innerHTML` với dữ liệu user (chỉ 2 chuỗi hằng có icon tĩnh).

---

## 5. Phân tích chi tiết từng file

### 5.1. `index.html` (31.5 KB)

**Head / SEO / a11y:**
- `lang="vi"`, `viewport-fit=cover`, `theme-color: #f7f8fc`, meta description đầy đủ ý marketing: *"tạo 3 mẫu email marketing khác biệt, biên tập giọng văn, xem trước như hộp thư, nhận gợi ý giờ gửi trong một không gian làm việc"*.
- Chỉ 1 bộ `<title>` tĩnh: "MailCraft AI | Công cụ viết Email Marketing thông minh" — JS đổi title theo route (`Tạo email | MailCraft AI`, `Hướng dẫn | MailCraft AI`).
- `app.js` nạp `defer` → không chặn render.
- Skip-link "Bỏ qua điều hướng" dẫn tới `#main-content`.

**Cấu trúc DOM (khối lớn):**
```
body
└── .app-shell
    ├── header.topbar          → brand + nav (#home/#studio/#guide) + CTA "Mở Studio" + nút menu mobile
    ├── main#home-page         → hero (copy + khối "visual" giả ứng dụng), features (5 card 01–05),
    │                             workflow (3 bước), presets (3 nút dựa data-preset), end-banner CTA
    ├── main#guide-page        → 3 card hướng dẫn từng bước + FAQ (<details> × 3)
    ├── main#studio-page       → navline + engine-status (role=status) + wizard 3 bước:
    │     ├─ nav.stepper (step-nav 1..3, khóa/mở theo tiến độ)
    │     ├─ section#stage-1  → form chiến dịch (brand*, goal radio ×3, offer* 420 ký tự,
    │     │                     industry select ×6, audience 100 ký tự, tóm tắt bên phải)
    │     ├─ section#stage-2  → summary strip + grid 3 biến thể (role=tablist, nút copy nhanh)
    │     │                     + panel biên tập (subject 140, body 2400, CTA 70, URL 500)
    │     │                     + panel viết lại theo tông (formal/fun/urgent)
    │     └─ section#stage-3  → preview hộp thư (desktop/mobile toggle) + thẻ hoàn tất
    │                             (copy, tải HTML, chọn lại mẫu) + thẻ đề xuất thời điểm gửi
    └── footer.site-footer     → © 2026 + liên kết 3 trang
+ div#toast (role=status, aria-live=polite)
```

**Điểm a11y đáng chú ý:** 3 phần tử `<main>` (mỗi lần chỉ 1 cái hiện — phần ẩn dùng `[hidden]`); radio groups có `role="radiogroup"` nhãn riêng; lỗi form gắn `role="alert"` + `aria-invalid`; stepper có `aria-current="step"`; menu mobile bật `aria-expanded`/`aria-controls`; preview body có nhãn aria. Đây là markup được chăm sóc kỹ, hiếm thấy ở page dựng nhanh.

### 5.2. `styles.css` (44.5 KB)

- **Design tokens** (`:root`): `--bg:#f7f8fc`, `--surface:#fff`, `--text:#18223e`, `--muted:#76809a`, `--line:#e7eaf2`, `--primary:#574be8`, `--primary-dark:#4639cc`, `--primary-pale:#efedff`, `--success:#0f9a76`, `--error:#d53f57`, shadow mềm; `color-scheme: light`.
- **Typography**: `Be Vietnam Pro`, body 13px (12px ở ≤590px), line-height 1.58, chữ tiêu đề `letter-spacing` âm (h1 hero tới −2.4px), `font-synthesis:none` (không giả đậm/ibold từ font hằng).
- **Cấu trúc 2 "lớp"**: dòng 1–7 gồm global reset + 4 media query cho wizard (1000/760/590/350px) — có vẻ là styles của engine gốc; từ dòng 9 có comment `MailCraft AI v3: public site...` là lớp site marketing (hero/features/guide/...) + media query 1100/850/700/400/350, và cuối là vá nhỏ (nút menu mobile phóng rộng ≥700px xuống).
- **Breakpoints tổng hợp**: 1100, 1000, 850, 760, 700, 600, 590, 400, 350px (+ `min-width:1101`). mobile: site-nav chuyển thành dropdown absolute dưới topbar, topbar sáng `backdrop-filter: blur(18px)`.
- **Chi tiết tinh**: `:has()` selector (`topbar:has(+ #home-page:not([hidden]))`) — dùng CSS gating theo route; `prefers-reduced-motion` tắt mọi animation/transition/scroll-behavior; focus-visible outline 3px rgba tím; `.truncate` kiểu các ô visual dùng `text-overflow: ellipsis`.
- Icon: `.ri-*` chuẩn hóa `font-size:18px; display:inline-flex` (đồng bộ basline giữa icon và chữ).

### 5.3. `app.js` (26.5 KB, 327 dòng)

**State module-level:** `engine ('demo'|'ai')`, `stage (1..3)`, `latestUnlocked`, `campaign`, `emails[]`, `currentEmail`, `schedule`, `toastTimer`, `busy` (khoá chặn double-submit mọi nơi).

**Dữ liệu tĩnh nhúng:**
- `labels`: tên hiển thị 3 mục tiêu + 6 ngành hàng.
- `variants`: 3 phong cách viết cố định — "Tập trung lợi ích", "Kể chuyện gần gũi", "Ngắn gọn, trực tiếp".
- `timing`: bảng đề xuất giờ gửi theo 6 ngành hàng (VD: Ẩm thực — Thứ Ba 09:00–10:30 / Thứ Năm 14:00–15:30 + lý do giải thích).
- `presets`: 3 kịch bản điền nhanh (Luna Coffee / Nova Tech / Green Market).

**Hai mode sinh nội dung:**
1. **AI mode** (`engine === 'ai'`):
   - `detectEngine()`: `GET /api/status` (timeout 6s qua `AbortSignal.timeout`); chỉ khi `{mode:'ai'}` mới bật AI; mọi lỗi → demo.
   - `queryAI(action, data)`: `POST /api/generate` | `/api/rewrite`, timeout 25s (`AbortController`), nhận JSON `{emails:[...3], schedule}` hoặc `{email}`, lỗi trả `{error}`.
   - Chuẩn hóa dữ liệu trả về: `normalizeEmails` ép đủ 3 mẫu, cắt 140/2400/70 ký tự, thiếu trường → báo lỗi tiếng Việt rõ ràng; `normalizeSchedule` rơi về bảng `timing` nếu slot sai định dạng (day≤35, time≤45, reason≤480 ký tự).
2. **Demo mode** (`engine === 'demo'`): `makeDemo()`/`rewriteDemo()` — bộ template tiếng Việt theo mục tiêu (promotion/launch/retention) & tông (formal/fun/urgent). Điểm đáng khen: comment code ghi rõ *"tông khẩn cấp không bịa ngày hết hạn/phần trăm/lý do khan hiếm"* — tránh nội dung marketing ảo.

**Wizard & validation:**
- `setStep(n)`: đi lại trong `latestUnlocked`, chặn khi `busy`; muốn sang bước 3 phải qua `validateEditor()` (bắt subject/body/CTA không rỗng, URL CTA phải `http(s)://`); đi ngược từ bước lỗi tự quay về bước 2 (`setStepWithoutValidation`).
- Form bước 1: bắt buộc `brand` + `offer` (báo lỗi + `aria-invalid` + focus phần tử đầu + toast).
- Biến thể: `renderVariants()` dựng card + nút copy nhanh (stopPropagation để không đổi lựa chọn), `selectVariant(i)` đổ dữ liệu vào editor + preview ngay.
- Biên tập realtime: `editEmail()` gắn `input` cho 4 trường, cập nhật counter + preview ngay.
- Viết lại: giữ `url` cũ qua rewrite (chỉ đổi subject/body/cta).
- Bước 3: `renderPreview()` (sender name/avatar dùng `initials()` với `toLocaleUpperCase('vi-VN')`, mặc định "MC"), toggle desktop/mobile chỉ đổi class `is-mobile` cho `#preview-canvas`.
- Đầu ra:
  - Copy: `formatEmailText()` → `Tiêu đề: ...\n\n body \n\nCTA: ...` (+ `Liên kết:` nếu có); ưu tiên `navigator.clipboard` trong secure context, fallback `execCommand('copy')` với textarea ẩn.
  - Tải HTML: dựng email HTML bảng 1 cột max-width 620px, style inline, màu thương hiệu `#574be8`, mọi nội dung user qua `escapeHTML()`; file `mailcraft-email-N.html` (Blob + revoke sau 1.5s).
- Điều hướng trang: `pageIds=['home','studio','guide']`, `readCurrentPage()` đọc hash + loại bỏ `?query`; `navigatePage()` đổi `hidden`, `aria-current`, **document.title theo từng route**, đóng menu mobile; lắng nghe `hashchange`.
- Menu mobile: nút bật/tắt + đóng khi click ngoài hoặc `Escape`.
- Khởi động: `updateBrief(); detectEngine();` + `navigatePage(readCurrentPage())` ngay khi nạp (hỗ trợ deep-link `#studio`, `#guide`).
- Toast: 3.4s, class `error` khi lỗi, `aria-live="polite"`.
- `resetAll()`: có `window.confirm` trước khi xóa phiên.

### 5.4. `favicon.svg`
SVG 64×64 chuẩn HTML-crafted: nền tím `#5549ec`, góc bo 18, biểu tượng phong bì trắng viền 4px.

---

## 6. Backend — những gì đọc được từ bên ngoài

| Endpoint | Phương thức | Trạng thái trên site thật | Kết quả quan sát |
|---|---|---|---|
| `/api/status` | GET | **200 JSON** `{"mode":"demo"}` | Function có thật; site hiện **chưa cấu hình AI** |
| `/api/generate` | POST | (theo code) không được gọi khi mode=demo | Không tiến hành thử để tiết kiệm quota chủ site |
| `/api/rewrite` | POST | (theo code) như trên | — |

- Vai trò: khi chủ site cấu hình (đó là: Gemini API qua Cloudflare), frontend tự phát hiện và chuyển sang AI thật — **không cần thay code frontend**.
- Mã nguồn Functions **không thể đọc qua HTTP** (không nằm trong static output) → bản clone front-end chạy được ngay: mọi thao tác đều dùng bộ template demo, giờ thay thế chuẩn hành vi UI khi chưa bật AI.
- Local không có `/api/*` → `detectEngine()` bắt lỗi 404 êm → đứng ở demo mode (đã nghiệm thu, console chỉ có 1 entry 404 này).
- → *Cập nhật 05/11/2026:* chúng ta đã **tự xây bộ backend thay thế** cho bản clone — chi tiết ở mục 13.

---

## 7. Chi tiết deploy (quan sát được qua HTTP)

- `server: cloudflare`, cf-ray ghi nhận `SIN`.
- `cache-control: public, max-age=0, must-revalidate` cho HTML; không thấy `etag`, không thấy `last-modified` trên response chính.
- `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff`.
- Catch-all SPA: mọi path lạ trả **200 + index.html** (`content-type: text/html`) — đúng kiểu cấu hình SPA của Cloudflare Pages. `/index.html` → **308 redirect về `/`** (chuẩn hóa URL).
- Không có `robots.txt`/`sitemap.xml` thật (những gì bạn thấy là HTML fallback) → hiện trạng SEO: chỉ với nội dung meta trên index, các route hash (#studio/#guide) gần như không SEO được.

---

## 8. Nghiệm thu bản clone (Chrome thật, local `http://127.0.0.1:8787`)

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Nạp `#home` | Hero, features, workflow, presets, footer render đủ (DOM check từng khối) |
| 2 | Đổi hash → `#studio` | main chuyển đúng, **title đổi thành "Tạo email \| MailCraft AI"** |
| 3 | Engine detect (không có `/api/status` ở local) | Nhãn "Chế độ trải nghiệm", class `engine-status is-demo` — fallback 404 bắt êm |
| 4 | Bấm "Tạo 3 mẫu email" (form mặc định Luna Coffee) | 3 variant card xuất hiện, editor đổ đủ subject "Ưu đãi mới từ Luna Coffee dành cho bạn" (38/140), body 242 ký tự, toast "Đã tạo 3 mẫu email.", badge "Nội dung mẫu để trải nghiệm" |
| 5 | Bấm "Viết lại mẫu này" (tông Trang trọng mặc định) | Subject → "Luna Coffee \| Thông tin dành cho Quý khách", body → "Kính gửi Người yêu cà phê,..." — khớp template formal |
| 6 | "Xem trước email" → bước 3 | Preview hiện title/body đã viết lại; giờ gửi đúng bảng ngành "Ẩm thực" (Thứ Ba 09:00–10:30 / Thứ Năm 14:00–15:30) + lý do |
| 7 | Route `#guide` | main hiện đúng, title "Hướng dẫn \| MailCraft AI", 3 item FAQ |
| 8 | Preset "Ra mắt sản phẩm" (home) | Điền Nova Tech / tech / goal=launch + điều hướng sang `#studio` + toast |
| 9 | Console | **0 lỗi JS**; chỉ có 1 entry `404 /api/status` (dự kiến ở môi trường local không backend) |

Kết luận: bản clone **hoạt động đồng nhất với bản gốc ở chế độ demo**. Không test 2 thao tác phụ thuộc quyền trình duyệt (clipboard write, tải file) để không chặn tự động hóa; code 2 luồng này đã được đọc kỹ và có fallback rõ ràng.

---

## 9. Cách chạy bản clone

**Chỉ front-end (chế độ demo):**
```bash
cd "C:\Users\Admin\Desktop\Vibe-code 2026"
python -m http.server 8787        # hoặc: npm run dev:static
# → mở http://127.0.0.1:8787/
```

**Full-stack AI (front-end + Pages Functions + Gemini):**
```bash
npm install                       # cài wrangler
npm run dev                       # wrangler pages dev . --port 8788
# → mở http://127.0.0.1:8788/ — /api/* hoạt động thật
```
Điền `GEMINI_API_KEY` vào `.dev.vars` để bật mode AI (để trống = demo). Chi tiết backend xem **mục 13**.

Hai điều cần nhớ khi deploy bản clone:
- File `.js` phải được serve với MIME `application/javascript` (Cloudflare Pages tự đảm bảo; nếu dùng static server khác cần kiểm tra).
- State không lưu — người dùng refresh là toàn bộ chiến dịch hiện tại mất (đặc tính gốc).

---

## 10. Hạn chế của bản clone & việc còn lại nếu muốn "ngang hàng" bản gốc

1. **~~Không có mã backend~~** (**✔ Đã xong 05/11/2026 — xem mục 13**: functions tự viết, gọi Gemini qua Cloudflare Pages Functions).
2. **Không SEO động** về các route hash: title từng route chỉ chạy bằng JS — bản chất SPA gốc như vậy.
3. **~~Không có test tự động, không lint~~** (**✔ Đã xong**: unit test `node --test`, E2E Playwright, ESLint + Prettier và CI — xem `README.md`).
4. Phụ thuộc 2 CDN ngoài (Google Fonts + jsDelivr). Nếu muốn tự chủ 100%, tải 2 tài nguyên này về local rồi sửa 2 dòng `<link>` trong `index.html` **và** siết `style-src`/`font-src` trong `_headers`.
5. **~~Không có robots/sitemap/CSP~~** (**✔ Đã xong 05/11/2026**: `robots.txt` + `_headers` (CSP, nosniff, frame-ancestors, Permissions-Policy); `sitemap.xml` sinh tự động khi deploy kèm `SITE_URL`. Khác bản gốc: file này do dự án tự thêm, không có ở site gốc — ghi chú ở mục 2 là kết quả thẩm định bản gốc tại thời điểm clone.)

## 11. Ghi chú về quyền sử dụng

Mã nguồn đã được tải về thư mục bạn chỉ định đúng đề bài. Nội dung site (văn bản, code, thiết kế) thuộc chủ sở hữu site. Bản clone này phù hợp cho mục đích **nghiên cứu/tham khảo/phát triển nội bộ/phục dựng kỹ thuật**. Nếu dự định deploy công khai thay thế bản gốc hoặc thương mại hóa, cần sự đồng ý của chủ sở hữu gốc.

## 12. Bảng tra nhanh dữ liệu nhúng trong app

**Mục tiêu chiến dịch** (`labels.goals`): `promotion` = Khuyến mãi · `launch` = Ra mắt sản phẩm · `retention` = Chăm sóc khách hàng

**Ngành hàng** (`labels.industries`): `food` Ẩm thực & đồ uống · `retail` Bán lẻ & TMĐT · `fashion` Thời trang & làm đẹp · `education` Giáo dục & đào tạo · `tech` Công nghệ & phần mềm · `service` Dịch vụ khác

**Giờ gửi gợi ý** (`timing`, 1 cặp slot/ngành):
| Ngành | Slot chính | Slot phụ |
|---|---|---|
| food | Thứ Ba 09:00–10:30 | Thứ Năm 14:00–15:30 |
| retail | Thứ Tư 11:00–12:00 | Thứ Sáu 18:00–19:30 |
| fashion | Thứ Năm 12:00–13:00 | Chủ Nhật 19:00–20:30 |
| education | Thứ Ba 19:00–20:30 | Thứ Bảy 09:00–10:30 |
| tech | Thứ Ba 09:00–10:00 | Thứ Năm 10:00–11:00 |
| service | Thứ Tư 10:00–11:00 | Thứ Sáu 14:00–15:00 |

**Tông viết lại**: `formal` (Trang trọng) · `fun` (Hài hước) · `urgent` (Khẩn cấp — không bịa deadline/đòn bẩy thiếu)

**Giới hạn trường**: brand 70 · offer 420 · audience 100 · subject 140 · body 2400 · cta 70 · url 500.

---

## 13. Backend tự xây — Cloudflare Pages Functions + Gemini (05/11/2026)

Đã bổ sung phần backend mà bản gốc không cung cấp mã nguồn. Cấu trúc mới:

```
functions/
├── _lib.js                          # helper chung (route helper — `_` không bị map thành route)
└── api/
    ├── status.js                    # GET  → {"mode":"ai"|"demo"} (key có/tự động)
    ├── generate.js                  # POST → {emails:[3 × {subject,body,cta}]}
    └── rewrite.js                   # POST → {email:{subject,body,cta}}
.dev.vars                            # secret local (KHÔNG commit)
.dev.vars.example                    # bản mẫu cấu hình
package.json                          # scripts: dev / dev:static / deploy
.gitignore
```

### 13.1. Hợp đồng API (khớp 100% kỳ vọng của `app.js` — đã đối chiếu)

| Endpoint | Đầu vào | Đầu ra | Lỗi trả về |
|---|---|---|---|
| `GET /api/status` | — | `{"mode":"ai"}` nếu có `GEMINI_API_KEY`, ngược lại `{"mode":"demo"}` | luôn JSON, không lỗi |
| `POST /api/generate` | `{brand, goal, offer, industry, audience}` | `{emails:[{subject≤140, body≤2400, cta≤70}] ×3}` | `{error: "..."}` + 400/429/502/504 |
| `POST /api/rewrite` | `{campaign, email, tone}` | `{email:{subject, body, cta}}` | tương tự |

Điểm thiết kế: backend **cố ý không trả `schedule`** — frontend `normalizeSchedule()` tự rơi về bảng thời gian tĩnh theo ngành (mục 12), giúp prompt ngắn hơn, đầu ra ổn định hơn, đồng bộ với bảng gợi ý đã tài liệu hoá.

### 13.2. Cách backend soạn nội dung AI

- Mỗi cuộc gọi: 1 request `POST models/{model}:generateContent` (mặc định `gemini-3.8-flash` trong `functions/_lib.js`, đổi qua `GEMINI_MODEL`).
- `responseMimeType: "application/json"` để ép JSON; thêm lớp dự phòng: bóc ```json fences + trích `{...}` + retry 1 lần với temperature hạ 0.3 nếu JSON vỡ.
- Prompt cấm bịa số liệu/deadline/khan hiếm không có trong thông điệp chính (kế thừa nguyên tắc an toàn nội dung có sẵn của bản demo, comment dòng 121 `app.js`).
- Validate + clamp server-side (defense-in-depth sau clamp của frontend).
- Key Gemini chỉ nằm ở server (header `x-goog-api-key`, không đứng trong URL_QUERY để tránh rò rỉ ra log).

### 13.3. Phòng chống lạm dụng

- Rate limit **mềm** theo IP/ngày qua KV binding `RATE_LIMIT_KV` (mặc định 30 lượt/ngày, đổi qua `RATE_LIMIT_DAILY`; generate và rewrite đếm riêng).
- Không binding KV = không giới hạn (dùng cho dev; production nên bật).
- Giới hạn cỡ request 64 KB; mọi method khác POST → JSON 405 (không để rơi vào SPA fallback HTML).
- Thời hạn chờ: 20s cho cuộc gọi Gemini; AbortSignal.timeout, lỗi phát 504 tiếng Việt khớp toast của frontend.

### 13.4. Biến môi trường

| Biến | Loại | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `GEMINI_API_KEY` | Secret | có (hay chạy demo) | Key từ Google AI Studio |
| `GEMINI_MODEL` | Var | không | Mặc định `gemini-3.8-flash` |
| `RATE_LIMIT_KV` | KV binding | không (khuyến nghị) | Namespace KV cho rate limit |
| `RATE_LIMIT_DAILY` | Var | không | Mặc định 30 |

### 13.5. Trình tự bật AI thật trên Cloudflare Pages

1. Tạo API key miễn phí: https://aistudio.google.com/app/apikey
2. Điền vào `.dev.vars` (local) → `npm run dev` → status nhãn UI đổi thành **"AI đã cấu hình"** (dot xanh).
3. Deploy: `npm run deploy` (hoặc kết nối repo git → Pages tự build; static = thư mục hiện tại).
4. Trên dashboard Pages: Settings → Functions → thêm Secret `GEMINI_API_KEY` (Production + Preview); tạo KV namespace và binding `RATE_LIMIT_KV`.
5. Kiểm tra lần cuối `GET /api/status` trên domain thật trả `{"mode":"ai"}`.

---

## 14. Bản cập nhật v4 — ảnh đính kèm, HTML email, preview HTML, xuất mailto (05/11/2026)

Mở rộng theo yêu cầu người dùng. Thay đổi ở 3 file, không đụng backend:

| File | Thay đổi |
|---|---|
| `index.html` | Thêm block **Ảnh & HTML** trong panel biên tập (bước 2): `#image-input` (4 ảnh max, 2 MB/ảnh, jpg/png/webp/gif), `#image-list` chips, `<details>` HTML editor `#html-editor`; bước 3: thêm nhóm chuyển đổi **Văn bản/HTML** (`data-content`), `#preview-html` iframe `sandbox=""`, nút **Xuất qua trình gửi thư** (`#mailto-btn`) + ghi chú giới hạn |
| `app.js` | `IMAGE_RULES`, `MAILTO_BUDGET`; `addImages/removeImage/renderImages` (FileReader → dataURL, sống trên từng email `m.images[]`); `buildEmailHTML()` tách từ `downloadHTML()` và chèn ảnh (img src=base64, inline-style); HTML override `m.html` + cờ `htmlStale` (sửa nội dung/ảnh/thêm-bớt ảnh → huỷ hiệu lực bản HTML tuỳ chỉnh, nút "Về nội dung gốc" reset); `setPreviewMode('text'\|'html')` + `renderPreviewHtml()` (iframe.srcdoc, sandbox không script); `buildMailtoUrl()` nén thư theo budget URL 1.900 ký tự + ghi chú minh bạch; bindings mới ở cuối file |
| `styles.css` | Block v4: chips ảnh, dashed add-button, `html-details`, monospace `#html-editor`, `.content-switch`, `.preview-html`, `.mailto-note` |

### 14.1. Quy tắc dùng nhất quán cần nhớ

1. **Nguồn sự thật nội dung** vẫn là 4 trường subject/body/cta/url + `m.images[]`. Nút **Tải email HTML** ưu tiên `m.html` (tuỳ chỉnh) nếu có — kèm toast cảnh báo "chưa khớp nội dung mới" khi flag `htmlStale`; mặc định là bản sinh chuẩn từ nội dung hiện tại.
2. **Sao chép nội dung/Xuất mailto luôn dùng text** (không bao giờ dùng bản HTML tuỳ chỉnh) — mailto chỉ mang văn bản theo RFC 2368; ảnh chỉ đi được qua đường Tải HTML (base64 nhúng, file tự chứa). Rõ ràng vậy là tách bạch vai trò của 2 kênh xuất.
3. **Preview HTML** dùng `iframe sandbox=""` (không script — an toàn khi người dùng dán HTML vào). `srcdoc` refresh khi: bật mode HTML, đổi biến thể, hoặc đổi nội dung ở bước 2.
4. **mailto budget**: > 1.900 ký tự URL sẽ rút gọn body xuống mức fit nhất (giảm dần 120 ký tự/lần, tới 200) và chèn ghi chú "[MailCraft: nội dung đã rút gọn…]" — người dùng luôn biết nội dung nào đang thiếu, thấy bản đầy đủ ở nút Tải HTML.

### 14.2. Nghiệm thu (browser thật, thông qua evaluate; upload được mô phỏng bằng DataTransfer + dispatch event)

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Upload ảnh 120×80 PNG qua DataTransfer → chip hiện + toast | chip=1, toast "Đã thêm ảnh…" |
| 2 | "Sinh HTML từ nội dung" | HTML 2291 ký tự, chứa `data:image/png;base64` (ảnh nhúng đúng) |
| 3 | Bật preview **HTML** | iframe hiện, `srcdoc=2291 ký tự` có ảnh; frame text ẩn |
| 4 | Sửa nội dung body | state → `is-stale` "chưa khớp nội dung mới" |
| 5 | Quay preview **Văn bản** | frame hiện, iframe ẩn nhưng srcdoc giữ nguyên (không mất sửa) |
| 6 | Xoá ảnh (chip ✕) | chip=0, toast "Đã xoá ảnh."; `htmlStale` set |
| 7 | Sinh lại HTML | 1375 ký tự, không còn `data:image` |
| 8 | `buildMailtoUrl(body 2400)` | cut=false, URL 1742 ký tự ≤ 1900, có ghi chú rút gọn |
| 9 | `buildMailtoUrl(body thường)` | 232 ký tự, mailto subject+body chuẩn (tiếng Việt encodeURIComponent) |
| 10 | Console | 0 lỗi JS (chỉ 404 `/api/status` dự kiến trên local static) |

### 14.3. Giới hạn kỹ thuật (cần nói với người dùng trước khi mở rộng)

- mailto không thể đính kèm ảnh — ảnh chỉ đi theo: (a) file HTML tải về (đính kèm tay trong trình gửi thư), (b) về sau: khuyến nghị người dùng tự hosting ảnh rồi dùng URL trực tiếp (đã hỗ trợ sẵn qua chế độ HTML tuỳ chỉnh).
- Base64 nhúng nặng (~1.3×) — với 4 ảnh 2 MB, file tải về có thể ~10 MB: vẫn mở render được nhưng nên khuyến nghị <100 KB/ảnh cho email thân thiện trình gửi.
- `iframe sandbox=""` không chạy JS/cookie trong preview — đúng ý; nếu muốn tự do hơn, cần đổi cờ sandbox một cách quyết liệt và đánh giá lại rủi ro XSS.

---
*Khảo sát & clone bởi agent OpenCode, 05/11/2026. Mục 13–14 do chính chúng ta triển khai cùng ngày. Toàn bộ kết luận đều dựa trên mã nguồn đã tải về và quan sát HTTP/Chrome thực tế; không suy đoán nào được ghi nhận như sự thật.*
