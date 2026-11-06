/**
 * Unit test cho `functions/_lib.js` — lớp logic dày nhất của dự án.
 *
 * Chạy bằng test runner có sẵn của Node (`node --test`), không cần thêm thư viện.
 * Các phụ thuộc môi trường (fetch tới Gemini, KV binding) đều được giả lập để
 * test chạy offline, tất định và không tốn quota.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  HttpFail,
  LIMITS,
  asJsonError,
  askGeminiJson,
  buildGeneratePrompt,
  buildRewritePrompt,
  clampEmailList,
  clampRewrittenEmail,
  clampStr,
  clean,
  cleanKeepNewlines,
  enforceDailyRate,
  fail,
  json,
  readJsonBody,
  sniffImageMime,
  validateCampaign,
  validateEmailForRewrite,
} from '../../functions/_lib.js';

/* ------------------------------------------------------------------ helpers */

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

/** Gắn fetch giả; trả về mảng ghi lại (url, init) của từng lần gọi. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return calls;
}

function geminiBody(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function geminiOk(text) {
  return new Response(JSON.stringify(geminiBody(text)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const puts = [];
  return {
    store,
    puts,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value, options) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

const CAMPAIGN = {
  brand: 'Luna Coffee',
  goal: 'promotion',
  offer: 'Giảm 20% cho cà phê hạt rang đến hết Chủ nhật.',
  industry: 'food',
  audience: 'Người yêu cà phê',
};

const EMAIL = { subject: 'Ưu đãi mới', body: 'Xin chào,\n\nNội dung.', cta: 'Xem ưu đãi' };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF_BYTES = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)));
const WEBP_BYTES = new Uint8Array([...'RIFF....WEBP'].map((c) => c.charCodeAt(0)));

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

/* ------------------------------------------------------- response helpers */

describe('json() / fail()', () => {
  it('trả JSON UTF-8, không cache, đúng status', async () => {
    const response = json({ mode: 'demo' }, 201);
    assert.equal(response.status, 201);
    assert.match(response.headers.get('Content-Type'), /^application\/json; charset=utf-8/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(await response.json(), { mode: 'demo' });
  });

  it('fail() bọc thông điệp trong trường error', async () => {
    const response = fail(429, 'Hết lượt');
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: 'Hết lượt' });
  });
});

describe('asJsonError()', () => {
  it('giữ nguyên status của HttpFail', async () => {
    const response = asJsonError(new HttpFail(400, 'Thiếu tên thương hiệu.'));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Thiếu tên thương hiệu.' });
  });

  it('lỗi lạ → 502, không rò rỉ chi tiết nội bộ ra client', async () => {
    console.error = () => {};
    const response = asJsonError(new Error('boom: database password=abc'));
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'Dịch vụ AI đang bận. Vui lòng thử lại sau ít phút.');
    assert.doesNotMatch(body.error, /password/);
  });
});

/* ------------------------------------------------------------- body reader */

describe('readJsonBody()', () => {
  const post = (body) => new Request('https://example.com/api/generate', { method: 'POST', body });

  it('đọc object JSON hợp lệ', async () => {
    assert.deepEqual(await readJsonBody(post('{"brand":"Luna"}')), { brand: 'Luna' });
  });

  it('body rỗng → 400', async () => {
    await assert.rejects(
      () => readJsonBody(post('')),
      (error) => error.status === 400,
    );
  });

  it('JSON hỏng → 400', async () => {
    await assert.rejects(
      () => readJsonBody(post('{oops')),
      (error) => error.status === 400,
    );
  });

  for (const [label, payload] of [
    ['mảng', '[]'],
    ['số', '42'],
    ['chuỗi', '"hello"'],
    ['null', 'null'],
    ['boolean', 'true'],
  ]) {
    it(`từ chối JSON không phải object (${label})`, async () => {
      await assert.rejects(
        () => readJsonBody(post(payload)),
        (error) => error.status === 400,
      );
    });
  }

  it('đếm giới hạn theo byte, không theo ký tự', async () => {
    // 30 ký tự "ệ" = 90 byte: vượt 60 nếu đếm byte, nhưng "đếm ký tự" sẽ cho qua.
    const body = JSON.stringify({ offer: 'ệ'.repeat(30) });
    assert.ok(body.length < 60, 'tiền đề: độ dài ký tự phải nhỏ hơn giới hạn');
    await assert.rejects(
      () => readJsonBody(post(body), 60),
      (error) => error.status === 400,
    );
  });

  it('chấp nhận body đúng bằng giới hạn', async () => {
    const body = '{"a":"b"}';
    const parsed = await readJsonBody(post(body), new TextEncoder().encode(body).byteLength);
    assert.deepEqual(parsed, { a: 'b' });
  });
});

/* ------------------------------------------------------------- normalizers */

describe('clean() / clampStr() / cleanKeepNewlines()', () => {
  it('clean gộp khoảng trắng và trim', () => {
    assert.equal(clean('  Luna \n  Coffee\t '), 'Luna Coffee');
  });

  it('clean biến null/undefined thành chuỗi rỗng', () => {
    assert.equal(clean(null), '');
    assert.equal(clean(undefined), '');
    assert.equal(clean(0), '0');
  });

  it('clampStr cắt đúng độ dài sau khi làm sạch', () => {
    assert.equal(clampStr('a'.repeat(100), 10).length, 10);
    assert.equal(clampStr(' a  b ', 10), 'a b');
  });

  it('cleanKeepNewlines giữ ngắt đoạn nhưng gộp khoảng trắng trong dòng', () => {
    // 3 newline liên tiếp → còn 1 dòng trống (giữ đoạn văn, không xoá sạch).
    assert.equal(
      cleanKeepNewlines('  Dòng 1   có   nhiều space\n\n\nDòng 2\t tab  '),
      'Dòng 1 có nhiều space\n\nDòng 2 tab',
    );
  });

  it('cleanKeepNewlines chuẩn hoá CRLF và bỏ space thừa quanh newline', () => {
    assert.equal(cleanKeepNewlines('A  \r\n  B'), 'A\nB');
    assert.equal(cleanKeepNewlines('A\n   \nB'), 'A\n\nB');
  });
});

describe('validateCampaign()', () => {
  it('chấp nhận payload đầy đủ và giữ nguyên giá trị', () => {
    assert.deepEqual(validateCampaign(CAMPAIGN), {
      brand: 'Luna Coffee',
      offer: 'Giảm 20% cho cà phê hạt rang đến hết Chủ nhật.',
      audience: 'Người yêu cà phê',
      goal: 'promotion',
      industry: 'food',
    });
  });

  it('mặc định goal=promotion khi thiếu hoặc không hợp lệ', () => {
    assert.equal(validateCampaign({ ...CAMPAIGN, goal: undefined }).goal, 'promotion');
    assert.equal(validateCampaign({ ...CAMPAIGN, goal: 'khong-co' }).goal, 'promotion');
  });

  it('bắt buộc tên thương hiệu', () => {
    assert.throws(() => validateCampaign({ ...CAMPAIGN, brand: '   ' }), /Thiếu tên thương hiệu/);
  });

  it('bắt buộc thông điệp chính', () => {
    assert.throws(() => validateCampaign({ ...CAMPAIGN, offer: '' }), /Thiếu thông điệp chính/);
  });

  it('bắt buộc ngành hàng hợp lệ', () => {
    assert.throws(() => validateCampaign({ ...CAMPAIGN, industry: 'other' }), /Chưa chọn ngành hàng/);
  });

  it('báo đúng HTTP status 400 cho mọi lỗi đầu vào', () => {
    for (const payload of [{}, { brand: 'X' }, { brand: 'X', offer: 'Y' }]) {
      assert.throws(
        () => validateCampaign(payload),
        (error) => error instanceof HttpFail && error.status === 400,
      );
    }
  });

  it('cắt mọi trường về giới hạn đã công bố', () => {
    const result = validateCampaign({
      brand: 'b'.repeat(LIMITS.brand + 20),
      offer: 'o'.repeat(LIMITS.offer + 20),
      audience: 'a'.repeat(LIMITS.audience + 20),
      industry: 'tech',
      goal: 'launch',
    });
    assert.equal(result.brand.length, LIMITS.brand);
    assert.equal(result.offer.length, LIMITS.offer);
    assert.equal(result.audience.length, LIMITS.audience);
  });

  it('chuẩn hoá khoảng trắng trước khi gửi vào prompt', () => {
    const result = validateCampaign({ ...CAMPAIGN, brand: '  Luna\n  Coffee  ' });
    assert.equal(result.brand, 'Luna Coffee');
  });
});

describe('validateEmailForRewrite()', () => {
  const payload = { campaign: CAMPAIGN, email: EMAIL, tone: 'fun' };

  it('chấp nhận payload hợp lệ', () => {
    assert.deepEqual(validateEmailForRewrite(payload), {
      campaign: validateCampaign(CAMPAIGN),
      email: EMAIL,
      tone: 'fun',
    });
  });

  it('mặc định tone=formal khi thiếu hoặc không hợp lệ', () => {
    assert.equal(validateEmailForRewrite({ ...payload, tone: undefined }).tone, 'formal');
    assert.equal(validateEmailForRewrite({ ...payload, tone: 'sarcastic' }).tone, 'formal');
  });

  for (const [label, email] of [
    ['thiếu tiêu đề', { ...EMAIL, subject: '  ' }],
    ['thiếu nội dung', { ...EMAIL, body: '' }],
    ['thiếu CTA', { ...EMAIL, cta: '' }],
  ]) {
    it(`từ chối email ${label}`, () => {
      assert.throws(() => validateEmailForRewrite({ ...payload, email }), /còn thiếu nội dung/);
    });
  }

  it('áp dụng luôn validation chiến dịch lồng bên trong', () => {
    assert.throws(
      () => validateEmailForRewrite({ ...payload, campaign: { ...CAMPAIGN, brand: '' } }),
      /thương hiệu/,
    );
  });

  it('cắt nội dung email theo giới hạn', () => {
    const result = validateEmailForRewrite({
      ...payload,
      email: { subject: 's'.repeat(500), body: 'b'.repeat(5000), cta: 'c'.repeat(200) },
    });
    assert.equal(result.email.subject.length, LIMITS.subject);
    assert.equal(result.email.body.length, LIMITS.body);
    assert.equal(result.email.cta.length, LIMITS.cta);
  });
});

/* -------------------------------------------------------------- AI output */

describe('clampEmailList()', () => {
  const three = { emails: [EMAIL, EMAIL, EMAIL] };

  it('trả đúng 3 email đã chuẩn hoá', () => {
    assert.deepEqual(clampEmailList(three, 3), [EMAIL, EMAIL, EMAIL]);
  });

  it('giữ ngắt đoạn trong body', () => {
    const [first] = clampEmailList({ emails: [{ ...EMAIL, body: 'Dòng 1\n\nDòng 2' }, EMAIL, EMAIL] });
    assert.equal(first.body, 'Dòng 1\n\nDòng 2');
  });

  it('cắt các trường quá dài', () => {
    const [first] = clampEmailList({
      emails: [{ subject: 's'.repeat(999), body: 'b'.repeat(9999), cta: 'c'.repeat(999) }, EMAIL, EMAIL],
    });
    assert.equal(first.subject.length, LIMITS.subject);
    assert.equal(first.body.length, LIMITS.body);
    assert.equal(first.cta.length, LIMITS.cta);
  });

  it('bỏ mẫu thừa, chỉ lấy 3 mẫu đầu', () => {
    assert.equal(clampEmailList({ emails: [EMAIL, EMAIL, EMAIL, EMAIL] }).length, 3);
  });

  it('thiếu mẫu → 502', () => {
    assert.throws(
      () => clampEmailList({ emails: [EMAIL, EMAIL] }),
      (error) => error.status === 502 && /đủ 3 mẫu/.test(error.message),
    );
  });

  it('email thiếu trường → 502', () => {
    assert.throws(
      () => clampEmailList({ emails: [{ ...EMAIL, cta: '' }, EMAIL, EMAIL] }),
      (error) => error.status === 502 && /thiếu nội dung/.test(error.message),
    );
  });

  it('dữ liệu không phải mảng → 502', () => {
    assert.throws(
      () => clampEmailList({ emails: 'ba cái email' }),
      (error) => error.status === 502,
    );
  });
});

describe('clampRewrittenEmail()', () => {
  it('chuẩn hoá email viết lại', () => {
    assert.deepEqual(clampRewrittenEmail({ email: EMAIL }), { email: EMAIL });
  });

  it('thiếu trường → 502', () => {
    assert.throws(
      () => clampRewrittenEmail({ email: { subject: 'x', body: '', cta: 'y' } }),
      (error) => error.status === 502,
    );
  });

  it('thiếu object email → 502', () => {
    assert.throws(
      () => clampRewrittenEmail({}),
      (error) => error.status === 502,
    );
  });
});

/* ----------------------------------------------------------------- prompts */

describe('buildGeneratePrompt()', () => {
  const prompt = buildGeneratePrompt(validateCampaign(CAMPAIGN));

  it('nhúng đủ thông tin chiến dịch bằng tiếng Việt', () => {
    for (const value of ['Luna Coffee', 'Khuyến mãi', 'Ẩm thực', 'Người yêu cà phê', 'Giảm 20%']) {
      assert.ok(prompt.includes(value), `prompt phải chứa "${value}"`);
    }
  });

  it('nêu rõ 3 kiểu viết và schema JSON đầu ra', () => {
    assert.match(prompt, /đúng 3 mẫu/);
    assert.match(prompt, /Tập trung lợi ích/);
    assert.match(prompt, /Kể chuyện gần gũi/);
    assert.match(prompt, /Ngắn gọn, trực tiếp/);
    assert.match(prompt, /"emails":\[\{"subject"/);
  });

  it('cấm bịa số liệu và giới hạn độ dài', () => {
    assert.match(prompt, /không bịa/i);
    assert.match(prompt, /140/);
    assert.match(prompt, /2400/);
  });

  it('dùng nhãn mặc định khi chưa có đối tượng', () => {
    const promptNoAudience = buildGeneratePrompt(validateCampaign({ ...CAMPAIGN, audience: '' }));
    assert.match(promptNoAudience, /chưa nêu/);
    assert.match(promptNoAudience, /khách hàng chung/);
  });

  it('không làm vỡ JSON khi thương hiệu chứa dấu ngoặc kép', () => {
    const tricky = buildGeneratePrompt(validateCampaign({ ...CAMPAIGN, brand: 'Luna "Coffee"' }));
    assert.match(tricky, /Luna \\"Coffee\\"/);
  });
});

describe('buildRewritePrompt()', () => {
  const prompt = buildRewritePrompt(validateCampaign(CAMPAIGN), EMAIL, 'urgent');

  it('nêu tông giọng cần viết lại', () => {
    assert.match(prompt, /khẩn cấp/);
  });

  it('nhúng email hiện tại và bối cảnh chiến dịch', () => {
    assert.ok(prompt.includes('Ưu đãi mới'));
    assert.ok(prompt.includes('Luna Coffee'));
    assert.match(prompt, /Giữ nguyên thông tin chính/);
    assert.match(prompt, /"email":\{"subject"/);
  });
});

/* ----------------------------------------------------------- ảnh & magic bytes */

describe('sniffImageMime()', () => {
  it('nhận PNG', () => assert.equal(sniffImageMime(PNG_BYTES), 'image/png'));
  it('nhận JPEG', () => assert.equal(sniffImageMime(JPEG_BYTES), 'image/jpeg'));
  it('nhận GIF87a và GIF89a', () => {
    assert.equal(sniffImageMime(GIF_BYTES), 'image/gif');
    assert.equal(sniffImageMime(new Uint8Array([...'GIF87a'].map((c) => c.charCodeAt(0)))), 'image/gif');
  });
  it('nhận WebP', () => assert.equal(sniffImageMime(WEBP_BYTES), 'image/webp'));
  it('nhận ArrayBuffer như Uint8Array', () => assert.equal(sniffImageMime(PNG_BYTES.buffer), 'image/png'));

  it('từ chối HTML/SVG đội lốt ảnh', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    assert.equal(sniffImageMime(html), null);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(sniffImageMime(svg), null);
  });

  it('không ném lỗi với dữ liệu rỗng hoặc quá ngắn', () => {
    assert.equal(sniffImageMime(new Uint8Array()), null);
    assert.equal(sniffImageMime(new Uint8Array([0x89, 0x50])), null);
    assert.equal(sniffImageMime(undefined), null);
  });
});

/* -------------------------------------------------------------- rate limit */

describe('enforceDailyRate()', () => {
  const request = new Request('https://example.com/api/generate', {
    headers: { 'CF-Connecting-IP': '203.0.113.7' },
  });

  beforeEach(() => {
    console.error = originalConsoleError;
  });

  it('không có binding KV → bỏ qua hoàn toàn (môi trường dev)', async () => {
    await assert.doesNotReject(() => enforceDailyRate({}, request, 'generate'));
  });

  it('tăng bộ đếm và đặt TTL ~25 giờ', async () => {
    const kv = fakeKv();
    await enforceDailyRate({ RATE_LIMIT_KV: kv, RATE_LIMIT_DAILY: '5' }, request, 'generate');
    const put = kv.puts[0];
    assert.equal(put.key, `rl:generate:203.0.113.7:${new Date().toISOString().slice(0, 10)}`);
    assert.equal(put.value, '1');
    assert.equal(put.options.expirationTtl, 90000);
  });

  it('cho qua đúng số lượt rồi chặn 429', async () => {
    const env = { RATE_LIMIT_KV: fakeKv(), RATE_LIMIT_DAILY: '2' };
    await enforceDailyRate(env, request, 'generate');
    await enforceDailyRate(env, request, 'generate');
    await assert.rejects(
      () => enforceDailyRate(env, request, 'generate'),
      (error) => error instanceof HttpFail && error.status === 429,
    );
  });

  it('đếm riêng theo feature và theo IP', async () => {
    const kv = fakeKv();
    const env = { RATE_LIMIT_KV: kv, RATE_LIMIT_DAILY: '1' };
    await enforceDailyRate(env, request, 'generate');
    await assert.doesNotReject(() => enforceDailyRate(env, request, 'rewrite'));
    const otherIp = new Request('https://example.com/api/generate', {
      headers: { 'CF-Connecting-IP': '198.51.100.9' },
    });
    await assert.doesNotReject(() => enforceDailyRate(env, otherIp, 'generate'));
  });

  it('IP không xác định dùng khoá "unknown"', async () => {
    const kv = fakeKv();
    await enforceDailyRate(
      { RATE_LIMIT_KV: kv, RATE_LIMIT_DAILY: '1' },
      new Request('https://example.com/api/generate'),
      'generate',
    );
    assert.match(kv.puts[0].key, /:unknown:/);
  });

  it('RATE_LIMIT_DAILY=0 hoặc không hợp lệ → tắt giới hạn', async () => {
    for (const value of ['0', '-3', 'abc']) {
      const kv = fakeKv();
      await enforceDailyRate({ RATE_LIMIT_KV: kv, RATE_LIMIT_DAILY: value }, request, 'generate');
      assert.equal(kv.puts.length, 0, `giá trị "${value}" phải tắt rate limit`);
    }
  });
});

/* ---------------------------------------------------------- Gemini client */

describe('askGeminiJson()', () => {
  it('chưa cấu hình khoá → HttpFail 500 và không gọi mạng', async () => {
    const calls = stubFetch(() => geminiOk('{}'));
    await assert.rejects(
      () => askGeminiJson({}, 'prompt'),
      (error) => error instanceof HttpFail && error.status === 500,
    );
    assert.equal(calls.length, 0);
  });

  it('gửi khoá qua header, không đưa vào URL', async () => {
    const calls = stubFetch(() => geminiOk('{"emails":[]}'));
    await askGeminiJson({ GEMINI_API_KEY: 'secret-key' }, 'prompt');
    const [{ url, init }] = calls;
    assert.doesNotMatch(url, /secret-key/);
    assert.equal(init.headers['x-goog-api-key'], 'secret-key');
  });

  it('dùng model mặc định và cho phép ghi đè qua GEMINI_MODEL', async () => {
    let calls = stubFetch(() => geminiOk('{}'));
    await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'prompt');
    assert.match(calls[0].url, /models\/gemini-3\.8-flash:generateContent/);

    calls = stubFetch(() => geminiOk('{}'));
    await askGeminiJson({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-custom' }, 'prompt');
    assert.match(calls[0].url, /models\/gemini-custom:generateContent/);
  });

  it('ép JSON, tắt thinking và chuyển temperature/maxOutputTokens', async () => {
    const calls = stubFetch(() => geminiOk('{}'));
    await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'prompt', { temperature: 0.4, maxOutputTokens: 321 });
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.generationConfig.responseMimeType, 'application/json');
    assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal(payload.generationConfig.temperature, 0.4);
    assert.equal(payload.generationConfig.maxOutputTokens, 321);
    assert.equal(payload.contents[0].parts[0].text, 'prompt');
    assert.equal(payload.contents[0].role, 'user');
  });

  it('đọc JSON thuần', async () => {
    stubFetch(() => geminiOk('{"emails":[{"subject":"a"}]}'));
    assert.deepEqual(await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'), { emails: [{ subject: 'a' }] });
  });

  it('bóc ```json fence do model tự thêm', async () => {
    stubFetch(() => geminiOk('```json\n{"a":1}\n```'));
    assert.deepEqual(await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'), { a: 1 });
  });

  it('bỏ phần văn xuôi bao quanh JSON', async () => {
    stubFetch(() => geminiOk('Đây là kết quả:\n{"a":2}\nHy vọng hữu ích.'));
    assert.deepEqual(await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'), { a: 2 });
  });

  it('thử lại 1 lần với temperature thấp hơn khi JSON hỏng', async () => {
    const calls = stubFetch((_, __, attempt) => geminiOk(attempt === 1 ? 'không phải json' : '{"ok":true}'));
    const result = await askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p', { temperature: 0.85 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    const secondTemperature = JSON.parse(calls[1].init.body).generationConfig.temperature;
    assert.ok(secondTemperature < 0.85, 'lần thử lại phải hạ temperature');
  });

  it('JSON hỏng cả 2 lần → 502 và chỉ thử lại 1 lần', async () => {
    const calls = stubFetch(() => geminiOk('vẫn không phải json'));
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /chưa đúng định dạng/.test(error.message),
    );
    assert.equal(calls.length, 2, 'không được retry vô hạn (tốn quota)');
  });

  it('429 từ Google → 502 với thông điệp hết hạn mức', async () => {
    stubFetch(() => new Response('quota', { status: 429 }));
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /hạn mức/.test(error.message),
    );
  });

  for (const status of [401, 403]) {
    it(`${status} từ Google → 502 báo khoá không hợp lệ`, async () => {
      stubFetch(() => new Response('denied', { status }));
      await assert.rejects(
        () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
        (error) => error.status === 502 && /Khoá AI không hợp lệ/.test(error.message),
      );
    });
  }

  it('5xx từ Google → 502 chung, chi tiết chỉ ghi log', async () => {
    const logs = [];
    console.error = (...parts) => logs.push(parts.join(' '));
    stubFetch(() => new Response('internal detail', { status: 500 }));
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && !/internal detail/.test(error.message),
    );
    assert.match(logs.join(' '), /gemini 500/);
  });

  it('không kết nối được → 502', async () => {
    stubFetch(() => {
      throw new TypeError('network down');
    });
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /Không kết nối/.test(error.message),
    );
  });

  it('quá thời gian chờ → 504', async () => {
    stubFetch(() => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 504,
    );
  });

  it('response không phải JSON → 502 dữ liệu vỡ', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 200 }));
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /dữ liệu vỡ/.test(error.message),
    );
  });

  it('bị chặn bởi bộ lọc an toàn → 502 có hướng dẫn', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 }),
    );
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /bộ lọc an toàn/.test(error.message),
    );
  });

  it('không có candidates → 502 dữ liệu trống', async () => {
    stubFetch(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await assert.rejects(
      () => askGeminiJson({ GEMINI_API_KEY: 'k' }, 'p'),
      (error) => error.status === 502 && /dữ liệu trống/.test(error.message),
    );
  });
});
