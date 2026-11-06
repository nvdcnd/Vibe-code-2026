/**
 * Test ở mức handler cho Cloudflare Pages Functions: kiểm tra hợp đồng HTTP
 * (status code, JSON shape, không gọi upstream khi đầu vào sai) chứ không chỉ
 * hàm thuần. Mọi lời gọi mạng và binding đều được giả lập.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { onRequestGet as statusGet } from '../../functions/api/status.js';
import {
  onRequest as generateFallback,
  onRequestPost as generatePost,
} from '../../functions/api/generate.js';
import { onRequest as rewriteFallback, onRequestPost as rewritePost } from '../../functions/api/rewrite.js';
import { onRequest as uploadFallback, onRequestPost as uploadPost } from '../../functions/api/upload.js';
import { onRequestGet as mediaGet } from '../../functions/media/[[path]].js';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CAMPAIGN = {
  brand: 'Luna Coffee',
  goal: 'promotion',
  offer: 'Giảm 20% cho cà phê hạt rang.',
  industry: 'food',
  audience: 'Người yêu cà phê',
};
const EMAILS = [
  { subject: 'Mẫu 1', body: 'Nội dung 1', cta: 'Xem 1' },
  { subject: 'Mẫu 2', body: 'Nội dung 2', cta: 'Xem 2' },
  { subject: 'Mẫu 3', body: 'Nội dung 3', cta: 'Xem 3' },
];
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function jsonRequest(body, url = 'https://example.com/api/test') {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

function geminiResponse(payload) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Fetch giả: trả JSON cho Gemini, ghi lại payload prompt đã gửi. */
function stubGemini(payload) {
  const prompts = [];
  globalThis.fetch = async (url, init) => {
    prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
    return geminiResponse(payload);
  };
  return prompts;
}

/* ------------------------------------------------------------------ status */

describe('GET /api/status', () => {
  it('trả mode=demo khi chưa có khoá', async () => {
    const response = await statusGet({ env: {} });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mode: 'demo' });
  });

  it('trả mode=ai khi đã có khoá', async () => {
    const response = await statusGet({ env: { GEMINI_API_KEY: 'k' } });
    assert.deepEqual(await response.json(), { mode: 'ai' });
  });

  it('không cache để trình duyệt luôn thấy trạng thái mới sau khi deploy', async () => {
    const response = await statusGet({ env: {} });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
});

/* ---------------------------------------------------------------- generate */

describe('POST /api/generate', () => {
  it('trả 3 email khi Gemini trả đúng schema', async () => {
    const prompts = stubGemini({ emails: EMAILS });
    const response = await generatePost({ request: jsonRequest(CAMPAIGN), env: { GEMINI_API_KEY: 'k' } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).emails, EMAILS);
    assert.match(prompts[0], /Luna Coffee/);
    assert.match(prompts[0], /Giảm 20%/);
  });

  it('không trả schedule — frontend tự dùng bảng giờ gửi tĩnh', async () => {
    stubGemini({ emails: EMAILS, schedule: { primary: { day: 'Thứ Ba', time: '09:00' } } });
    const response = await generatePost({ request: jsonRequest(CAMPAIGN), env: { GEMINI_API_KEY: 'k' } });
    const body = await response.json();
    assert.equal('schedule' in body, false);
    assert.deepEqual(Object.keys(body), ['emails']);
  });

  it('400 khi thiếu trường bắt buộc, không gọi Gemini', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return geminiResponse({});
    };
    const response = await generatePost({
      request: jsonRequest({ ...CAMPAIGN, brand: '' }),
      env: { GEMINI_API_KEY: 'k' },
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'Thiếu tên thương hiệu.');
    assert.equal(called, false);
  });

  it('400 khi body không phải JSON', async () => {
    const request = new Request('https://example.com/api/generate', {
      method: 'POST',
      body: 'không phải json',
    });
    const response = await generatePost({ request, env: { GEMINI_API_KEY: 'k' } });
    assert.equal(response.status, 400);
  });

  it('502 khi Gemini trả thiếu mẫu', async () => {
    stubGemini({ emails: [EMAILS[0]] });
    const response = await generatePost({ request: jsonRequest(CAMPAIGN), env: { GEMINI_API_KEY: 'k' } });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /3 mẫu/);
  });

  it('429 khi vượt hạn mức trong ngày và không gọi Gemini', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return geminiResponse({ emails: EMAILS });
    };
    const kv = {
      async get() {
        return '99';
      },
      async put() {},
    };
    const response = await generatePost({
      request: jsonRequest(CAMPAIGN),
      env: { GEMINI_API_KEY: 'k', RATE_LIMIT_KV: kv, RATE_LIMIT_DAILY: '30' },
    });
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /hết lượt hôm nay/);
    assert.equal(called, false);
  });

  it('phương thức khác POST → 405 JSON (không rơi vào SPA fallback)', async () => {
    const response = await generateFallback();
    assert.equal(response.status, 405);
    assert.equal(typeof (await response.json()).error, 'string');
  });

  it('thiếu khoá AI → 500 kèm thông điệp tiếng Việt', async () => {
    const response = await generatePost({ request: jsonRequest(CAMPAIGN), env: {} });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /chưa cấu hình khoá AI/);
  });
});

/* ----------------------------------------------------------------- rewrite */

describe('POST /api/rewrite', () => {
  const payload = { campaign: CAMPAIGN, email: EMAILS[0], tone: 'formal' };

  it('trả email đã viết lại', async () => {
    const prompts = stubGemini({ email: { subject: 'Kính gửi', body: 'Nội dung mới', cta: 'Xem ngay' } });
    const response = await rewritePost({ request: jsonRequest(payload), env: { GEMINI_API_KEY: 'k' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      email: { subject: 'Kính gửi', body: 'Nội dung mới', cta: 'Xem ngay' },
    });
    assert.match(prompts[0], /trang trọng/);
  });

  it('400 khi email thiếu nội dung', async () => {
    const response = await rewritePost({
      request: jsonRequest({ ...payload, email: { ...EMAILS[0], body: '' } }),
      env: { GEMINI_API_KEY: 'k' },
    });
    assert.equal(response.status, 400);
  });

  it('502 khi Gemini trả email không hợp lệ', async () => {
    stubGemini({ email: { subject: 'chỉ có tiêu đề' } });
    const response = await rewritePost({ request: jsonRequest(payload), env: { GEMINI_API_KEY: 'k' } });
    assert.equal(response.status, 502);
  });

  it('405 cho phương thức khác POST', async () => {
    assert.equal((await rewriteFallback()).status, 405);
  });
});

/* ------------------------------------------------------------------ upload */

describe('POST /api/upload', () => {
  function fakeBucket() {
    const stored = [];
    return {
      stored,
      async put(key, value, options) {
        stored.push({ key, size: value.byteLength, contentType: options.httpMetadata.contentType });
      },
    };
  }

  function imageRequest(bytes, contentType) {
    return new Request('https://example.com/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'CF-Connecting-IP': '203.0.113.7' },
      body: bytes,
    });
  }

  it('501 khi chưa cấu hình R2 để frontend giữ luồng base64', async () => {
    const response = await uploadPost({ request: imageRequest(PNG_BYTES, 'image/png'), env: {} });
    assert.equal(response.status, 501);
    assert.match((await response.json()).error, /base64/);
  });

  it('lưu ảnh và trả URL tương đối /media/uploads/…', async () => {
    const bucket = fakeBucket();
    const response = await uploadPost({
      request: imageRequest(PNG_BYTES, 'image/png'),
      env: { MEDIA_BUCKET: bucket },
    });
    assert.equal(response.status, 200);
    const { url } = await response.json();
    assert.match(url, /^\/media\/uploads\/\d+-[0-9a-f-]{36}\.png$/);
    assert.equal(bucket.stored.length, 1);
    assert.equal(bucket.stored[0].contentType, 'image/png');
  });

  it('dùng MIME thật của nội dung, không tin header khai báo', async () => {
    const bucket = fakeBucket();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0]);
    const response = await uploadPost({
      request: imageRequest(jpeg, 'image/png'),
      env: { MEDIA_BUCKET: bucket },
    });
    assert.equal(response.status, 200);
    assert.equal(bucket.stored[0].contentType, 'image/jpeg');
    assert.match((await response.json()).url, /\.jpg$/);
  });

  it('415 khi nội dung không phải ảnh (HTML đội lốt image/png)', async () => {
    const bucket = fakeBucket();
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const response = await uploadPost({
      request: imageRequest(html, 'image/png'),
      env: { MEDIA_BUCKET: bucket },
    });
    assert.equal(response.status, 415);
    assert.equal(bucket.stored.length, 0, 'không được ghi tệp không phải ảnh vào bucket');
  });

  it('415 khi Content-Type không nằm trong danh sách cho phép', async () => {
    const response = await uploadPost({
      request: imageRequest(PNG_BYTES, 'text/html'),
      env: { MEDIA_BUCKET: fakeBucket() },
    });
    assert.equal(response.status, 415);
  });

  it('413 khi ảnh vượt 2 MB', async () => {
    const tooBig = new Uint8Array(2 * 1024 * 1024 + 1);
    const response = await uploadPost({
      request: imageRequest(tooBig, 'image/png'),
      env: { MEDIA_BUCKET: fakeBucket() },
    });
    assert.equal(response.status, 413);
  });

  it('429 khi hết hạn mức và KHÔNG đọc/ghi dữ liệu ảnh', async () => {
    const bucket = fakeBucket();
    const response = await uploadPost({
      request: imageRequest(PNG_BYTES, 'image/png'),
      env: {
        MEDIA_BUCKET: bucket,
        RATE_LIMIT_KV: {
          async get() {
            return '30';
          },
          async put() {},
        },
        RATE_LIMIT_DAILY: '30',
      },
    });
    assert.equal(response.status, 429);
    assert.equal(bucket.stored.length, 0);
  });

  it('405 cho phương thức khác POST', async () => {
    assert.equal((await uploadFallback()).status, 405);
  });
});

/* ------------------------------------------------------------------- media */

describe('GET /media/[[path]]', () => {
  function bucketWith(objects) {
    return {
      async get(key) {
        return objects[key] ?? null;
      },
    };
  }

  it('501 khi chưa cấu hình R2', async () => {
    const response = await mediaGet({ env: {}, params: { path: ['uploads', 'a.png'] } });
    assert.equal(response.status, 501);
  });

  it('trả ảnh kèm content-type, cache immutable và nosniff', async () => {
    const response = await mediaGet({
      env: {
        MEDIA_BUCKET: bucketWith({
          'uploads/a.png': { body: 'bytes', httpMetadata: { contentType: 'image/png' } },
        }),
      },
      params: { path: ['uploads', 'a.png'] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.match(response.headers.get('Cache-Control'), /immutable/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(await response.text(), 'bytes');
  });

  it('404 khi key không tồn tại', async () => {
    const response = await mediaGet({
      env: { MEDIA_BUCKET: bucketWith({}) },
      params: { path: ['uploads', 'missing.png'] },
    });
    assert.equal(response.status, 404);
  });

  it('400 khi key chứa dấu hiệu path traversal', async () => {
    const response = await mediaGet({
      env: { MEDIA_BUCKET: bucketWith({}) },
      params: { path: ['..', 'secret.txt'] },
    });
    assert.equal(response.status, 400);
  });

  it('dùng application/octet-stream khi object thiếu metadata', async () => {
    const response = await mediaGet({
      env: { MEDIA_BUCKET: bucketWith({ 'uploads/a.bin': { body: 'x' } }) },
      params: { path: 'uploads/a.bin' },
    });
    assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  });

  it('nhận key dạng chuỗi (một đoạn path)', async () => {
    const response = await mediaGet({
      env: {
        MEDIA_BUCKET: bucketWith({
          'uploads/a.png': { body: 'ok', httpMetadata: { contentType: 'image/png' } },
        }),
      },
      params: { path: 'uploads/a.png' },
    });
    assert.equal(response.status, 200);
  });
});
