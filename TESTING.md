# Kiểm thử (Testing)

Tài liệu mô tả hệ thống kiểm thử của **MailCraft AI** dựa trên cấu hình và mã nguồn hiện có trong kho (`package.json`, `playwright.config.mjs`, `tests/`, `e2e/`, `.github/workflows/ci.yml`).

## 1. Tổng quan

| Hạng mục                    | Công cụ / lệnh                                      | Phạm vi                                                                     |
| --------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Unit test (backend/helpers) | `node --test` (`npm run test:unit`)                 | `tests/unit/*.test.mjs` (Node test runner có sẵn, không thêm thư viện test) |
| E2E (trình duyệt)           | Playwright (`npm run test:e2e`)                     | `e2e/*.spec.mjs`, chạy trên Chromium do Playwright quản lý                  |
| Lint                        | ESLint (`npm run lint`)                             | Toàn bộ repo theo `eslint.config.mjs`                                       |
| Định dạng                   | Prettier (`npm run format`, `npm run format:check`) | Theo `.prettierrc.json` / `.prettierignore`                                 |
| Kiểm tra nhanh              | `npm run check`                                     | `lint` + `format:check` + `test:unit`                                       |
| Kiểm tra đầy đủ (local/CI)  | `npm run ci`                                        | `check` + `test:e2e` + `build` + `verify:dist`                              |

Yêu cầu môi trường: Node `>=20.19.0` (khai báo trong `package.json`).

## 2. Unit test (`tests/unit/`)

### 2.1. Cách chạy

```bash
npm run test:unit
```

Lệnh thực thi: `node --test` (Node quét các tệp test theo mặc định). Kết quả đo thực tế trong môi trường kiểm tra tài liệu này: **111 test, 111 pass, 0 fail** (2 tệp: `tests/unit/handlers.test.mjs`, `tests/unit/lib.test.mjs`).

### 2.2. Phạm vi theo tệp

- **`tests/unit/lib.test.mjs`** — kiểm thử helper trong `functions/_lib.js` (ví dụ: validate/clamp đầu vào, xử lý prompt/chuỗi, nhận diện loại ảnh bằng magic bytes, rate limit theo IP/ngày với KV giả lập, và `askGeminiJson` gồm các nhánh bóc JSON, retry, lỗi 429/401/5xx/timeout/SAFETY với thông điệp và mã phù hợp).
- **`tests/unit/handlers.test.mjs`** — kiểm thử hợp đồng HTTP của Pages Functions (`/api/status`, `/api/generate`, `/api/rewrite`, `/api/upload`, `/media/*`): mã trạng thái, hình dạng JSON, không gọi upstream khi đầu vào sai, trả 405 cho phương thức không hợp lệ, các nhánh 501/413/415, và chặn path traversal ở `/media`.

`fetch` và các binding (KV/R2) được giả lập trong test nên chạy tất định, không cần mạng và không tiêu tốn quota Gemini.

## 3. Kiểm thử E2E (`e2e/`, Playwright)

### 3.1. Cấu hình (`playwright.config.mjs`)

- Thư mục test: `./e2e`, timeout 30s/test, expect 5s.
- Trình duyệt: project `chromium` (`Desktop Chrome` device). Mặc định dùng Chromium do Playwright cài; có thể đặt `PW_CHANNEL=chrome` để dùng Chrome cài sẵn.
- `baseURL`: `http://127.0.0.1:${E2E_PORT||8790}`; locale `vi-VN`, timezone `Asia/Ho_Chi_Minh`, viewport 1360×900.
- Retry: 1 lần trên CI, 0 lần local. Reporter: `list` (+ `github` trên CI) và `html` (thư mục `e2e-report/`, không tự mở). Trace/screenshot/video: lần retry đầu, khi fail, giữ khi fail.
- `webServer`: `node scripts/serve-static.mjs --port ${PORT} --root . --quiet`, chờ URL sẵn sàng (timeout 20s). Server tĩnh **không** có `/api/*`, giúp kiểm tra nhánh rơi về “Chế độ trải nghiệm”; nhánh AI được kiểm thử bằng `page.route()` (giả lập `/api/*`) nên không cần secret.

Server tĩnh đọc `_headers` để áp CSP/security headers giống production trong quá trình dev/E2E (xem `scripts/serve-static.mjs`).

### 3.2. Cách chạy

```bash
npx playwright install chromium   # lần đầu (CI dùng --with-deps)
npm run test:e2e                  # playwright test
npm run test:e2e:ui               # chế độ UI
```

Danh sách test hiện có (`npx playwright test --list`): **94 test trong 6 tệp** (project `chromium`).

### 3.3. Phạm vi theo tệp spec

| Tệp                       | Nội dung chính                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/app.spec.mjs`        | Luồng demo: validate form, tạo 3 mẫu, viết lại theo tông, preview, gợi ý giờ gửi                                                     |
| `e2e/navigation.spec.mjs` | Hash router, tiêu đề tab, skip-link, menu di động, preset                                                                            |
| `e2e/editor.spec.mjs`     | Bộ đếm, ảnh (từ chối/giới hạn), HTML tuỳ chỉnh, cờ “chưa khớp”, XSS, tải file, clipboard, reset                                      |
| `e2e/ai-mode.spec.mjs`    | Nhánh AI với `/api/*` giả lập: payload, lỗi 429/JSON hỏng, ảnh R2                                                                    |
| `e2e/pure.spec.mjs`       | Kiểm tra hàm frontend trong trình duyệt (`escapeHTML`, `buildMailtoUrl`, `normalizeEmails`, `normalizeSchedule`, …)                  |
| `e2e/headers.spec.mjs`    | Security headers, CSP có hiệu lực (chặn script nội tuyến/ngoài allowlist, không phá preview), `robots.txt`, không phục vụ `_headers` |

## 4. Lệnh kiểm tra khác

- `npm run lint` — ESLint.
- `npm run format:check` — kiểm tra định dạng Prettier (đã áp dụng cho `tests/`, `scripts/`, `e2e/`, config; các tệp gốc được giữ nguyên theo `.prettierignore`).
- `npm run build` / `npm run verify:dist` — dựng `dist/` sạch và chốt chặn (đủ file, không lẫn secret/tệp nội bộ, kiểm tra CSP trong `_headers` theo script).
- `npm run dev` — chạy Pages Functions + frontend tại `http://127.0.0.1:8788` (có `/api`); dùng để thử thủ công chế độ AI/đầy đủ khi đã cấu hình biến môi trường.
- `npm run dev:static` — server tĩnh tại `http://127.0.0.1:8787` (không `/api`, demo).

## 5. CI (`.github/workflows/ci.yml`)

Kích hoạt: `push`/`pull_request` vào `main`, `master` và `workflow_dispatch`. Quyền `contents: read`, có `concurrency` huỷ run trùng nhánh.

| Job                          | Nội dung                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lint & format**            | Node 22: `npm ci`, `npm run lint`, `npm run format:check`                                                                                      |
| **Unit tests**               | Ma trận Node **20, 22, 24**: `npm ci`, `npm run test:unit`                                                                                     |
| **E2E (Chromium)**           | Node 22: cài Chromium Playwright (có cache), `npm run test:e2e`, upload `e2e-report/` và `test-results/` khi có                                |
| **Build & deploy readiness** | Node 22: `npm run build`, `npm run verify:dist`, `npx wrangler pages functions build --outdir .wrangler/ci-functions`, upload artifact `dist/` |

CI **không** thực hiện deploy.

## 6. Ghi chú

- E2E mặc định chạy ở chế độ demo (không `/api`) và/hoặc với API giả lập; không yêu cầu khoá Gemini thật.
- Một số kịch bản phụ thuộc quyền trình duyệt (clipboard, tải file) có thể được xử lý theo cơ chế/cấu hình của từng spec; chi tiết nằm trong các tệp `e2e/*.spec.mjs`.
- Các con số trong tài liệu (111 unit, 94 E2E) phản ánh trạng thái đo được từ kho mã tại thời điểm lập tài liệu; khi thêm/sửa test cần cập nhật lại tài liệu cho khớp.
