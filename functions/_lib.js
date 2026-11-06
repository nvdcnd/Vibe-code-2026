/**
 * _lib.js — helper dùng chung cho MailCraft API (Cloudflare Pages Functions).
 * File có tiền tố `_` nên wrangler KHÔNG map nó thành route.
 *
 * Hợp đồng bắt tay với frontend (app.js) — đã xác minh bằng đọc code:
 *  - generate: trả {emails:[{subject,body,cta}] x3, schedule?} — schedule CÓ THỂ bỏ
 *    qua, frontend tự rơi về bảng thời gian tĩnh theo ngành (normalizeSchedule).
 *  - rewrite:  trả {email:{subject,body,cta}}.
 *  - mọi lỗi:  {error:"<thông điệp tiếng Việt>"} + HTTP status hợp lý
 *              (frontend đọc result.error và đưa thẳng lên toast).
 *  - giới hạn trường: subject≤140, body≤2400, cta≤70 (giống clamp của frontend,
 *    server clamp nữa là defense-in-depth).
 */
'use strict';

export const LIMITS = Object.freeze({ subject: 140, body: 2400, cta: 70, brand: 70, offer: 420, audience: 100 });
export const GOALS = Object.freeze({
  promotion: 'Khuyến mãi (giới thiệu ưu đãi)',
  launch: 'Ra mắt sản phẩm mới',
  retention: 'Chăm sóc khách hàng (giữ kết nối)',
});
export const INDUSTRIES = Object.freeze({
  food: 'Ẩm thực & đồ uống',
  retail: 'Bán lẻ & thương mại điện tử',
  fashion: 'Thời trang & làm đẹp',
  education: 'Giáo dục & đào tạo',
  tech: 'Công nghệ & phần mềm',
  service: 'Dịch vụ khác',
});
export const TONES = Object.freeze({
  formal: 'trang trọng, chuyên nghiệp, lịch sự',
  fun: 'hài hước, thân thiện, gần gũi',
  urgent: 'khẩn cấp, rõ ràng, thúc đẩy hành động',
});
export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const EXT_BY_TYPE = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
});
export const VARIANT_STYLES = Object.freeze([
  'Tập trung lợi ích — nêu rõ giá trị người nhận nhận được',
  'Kể chuyện gần gũi — tạo kết nối và sự quan tâm',
  'Ngắn gọn, trực tiếp — đi thẳng vào thông điệp chính',
]);

/* ---------- Format phản hồi ---------- */

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Phản hồi API có thể chứa dữ liệu theo phiên → không cache, không đoán MIME.
      // `_headers` của Pages KHÔNG áp cho Functions, nên phải tự đặt ở đây.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function fail(status, message) {
  return json({ error: message }, status);
}

/** Bọc lỗi thành Response JSON; các handler dùng try/catch quanh nó. */
export function asJsonError(error) {
  if (error instanceof HttpFail) return fail(error.status, error.message);
  console.error('[api] unexpected error:', error);
  return fail(502, 'Dịch vụ AI đang bận. Vui lòng thử lại sau ít phút.');
}

export class HttpFail extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Đọc & kiểm tra đầu vào ---------- */

export async function readJsonBody(request, maxBytes = 64 * 1024) {
  const raw = await request.text();
  // Đếm theo BYTE, không theo ký tự: tiếng Việt có dấu chiếm 2–3 byte/ký tự nên
  // `raw.length` sẽ cho phép body lớn gấp ~3 lần giới hạn thật.
  if (!raw || new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new HttpFail(400, 'Dữ liệu gửi lên không hợp lệ.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpFail(400, 'Dữ liệu gửi lên không hợp lệ.');
  }
  // Chỉ chấp nhận object: mảng/số/chuỗi/null đều không phải payload hợp lệ và
  // nếu để lọt sẽ làm validator phía sau phải tự đối phó với mọi kiểu dữ liệu.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpFail(400, 'Dữ liệu gửi lên không hợp lệ.');
  }
  return parsed;
}

/** Chuẩn hoá chuỗi — mirror hàm clean() của frontend. */
export function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** Ép giá trị vào khoảng [min, max] ký tự, cắt khi vượt — mirror của frontend. */
export function clampStr(v, max) {
  return clean(v).slice(0, max);
}

/** Kiểm tra chiến dịch bước 1 (bắt buộc: brand, offer; kiểm tra mục tiêu & ngành). */
export function validateCampaign(body) {
  const brand = clampStr(body?.brand, LIMITS.brand);
  const offer = clampStr(body?.offer, LIMITS.offer);
  const audience = clampStr(body?.audience, LIMITS.audience);
  const goal = body?.goal in GOALS ? body.goal : 'promotion';
  const industry = body?.industry in INDUSTRIES ? body.industry : '';
  if (!brand) throw new HttpFail(400, 'Thiếu tên thương hiệu.');
  if (!offer) throw new HttpFail(400, 'Thiếu thông điệp chính của chiến dịch.');
  if (!industry) throw new HttpFail(400, 'Chưa chọn ngành hàng.');
  return { brand, offer, audience, goal, industry };
}

/**
 * Nhận diện ảnh bằng magic bytes. `Content-Type` do client khai rất dễ giả, nên
 * loại tệp thật sự được lưu phải do nội dung quyết định — tránh việc upload một
 * trang HTML/SVG tự nhận là `image/png` rồi được CDN phục vụ như tài liệu.
 * Trả về mime thật hoặc `null` nếu không phải ảnh trong danh sách cho phép.
 */
export function sniffImageMime(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6) {
    const head = ascii(0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Kiểm tra email cần viết lại (bước 2). */
export function validateEmailForRewrite(body) {
  const subject = clampStr(body?.email?.subject, LIMITS.subject);
  const bodyText = String(body?.email?.body ?? '').slice(0, LIMITS.body);
  const cta = clampStr(body?.email?.cta, LIMITS.cta);
  const tone = body?.tone in TONES ? body.tone : 'formal';
  if (!subject || !bodyText || !cta) throw new HttpFail(400, 'Email cần viết lại còn thiếu nội dung (tiêu đề/nội dung/CTA).');
  const campaign = validateCampaign(body?.campaign ?? {});
  return { campaign, email: { subject, body: bodyText, cta }, tone };
}

/* ---------- Rate limit (tuỳ chọn) ---------- */

/**
 * Giới hạn số lần gọi theo ngày trên mỗi IP. Chỉ hoạt động khi project có
 * binding KV tên `RATE_LIMIT_KV`; không có binding thì bỏ qua (môi trường dev,
 * hoặc khi chủ site chấp nhận chi phí). KV là eventual-consistent — giới hạn
 * mang tính mềm, có thể vượt vài đơn vị khi có request đồng thời.
 */
export async function enforceDailyRate(env, request, feature) {
  const limit = Number(env.RATE_LIMIT_DAILY ?? 30);
  if (!env.RATE_LIMIT_KV || !Number.isFinite(limit) || limit <= 0) return;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${feature}:${ip}:${day}`;
  const current = Number((await env.RATE_LIMIT_KV.get(key)) ?? 0);
  if (current >= limit) {
    throw new HttpFail(429, 'Bạn đã dùng hết lượt hôm nay. Vui lòng quay lại vào ngày mai.');
  }
  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 90000 }); // ~25h
}

/* ---------- Máy chủ Gemini ---------- */

function extractModelJson(text) {
  // Gemini + responseMimeType:"application/json" thường trả JSON thuần,
  // nhưng nếu model lười chèn ```json fences thì ta tự bóc ra.
  let t = String(text ?? '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first !== -1 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

function readGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p?.text ?? '').join('');
  if (!text) {
    const finish = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new HttpFail(502, finish === 'SAFETY'
      ? 'Nội dung chiến dịch bị chặn bởi bộ lọc an toàn. Hãy điều chỉnh thông điệp và thử lại.'
      : 'Dịch vụ AI trả về dữ liệu trống. Vui lòng thử lại.');
  }
  return text;
}

/**
 * Gọi 1 lần generateContent; trả về object JSON đã parse (raw text → JSON).
 * Retry đúng 1 lần nếu model trả JSON không đọc được (độ tin cậy đầu ra ≥ 2x).
 */
export async function askGeminiJson(env, prompt, { temperature = 0.85, maxOutputTokens = 2048 } = {}) {
  if (!env.GEMINI_API_KEY) throw new HttpFail(500, 'Máy chủ chưa cấu hình khoá AI.');
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash'; // 2026-11: 2.5-flash ngừng cấp cho tài khoản mới
  const call = () => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key đi qua header — KHÔNG đặt vào query để tránh log ở access-log trung gian.
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          // Task này là JSON có cấu trúc theo khung cứng — không cần suy luận dài;
          // tắt "thinking" giúp độ trễ ổn định (API 2.5+ hỗ trợ thinkingBudget).
          thinkingConfig: { thinkingBudget: 0 },
          temperature,
          maxOutputTokens,
        },
      }),
      signal: AbortSignal.timeout(45000),
    }
  );

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      response = await call();
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new HttpFail(504, 'Dịch vụ AI phản hồi quá chậm. Vui lòng thử lại.');
      }
      throw new HttpFail(502, 'Không kết nối được dịch vụ AI. Vui lòng thử lại sau.');
    }
    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try { detail = await response.text(); } catch { /* body lỗi không đọc được — không quan trọng */ }
      if (status === 429) throw new HttpFail(502, 'Dịch vụ AI đã hết hạn mức. Vui lòng thử lại sau ít phút.');
      if (status === 401 || status === 403) throw new HttpFail(502, 'Khoá AI không hợp lệ. Kiểm tra GEMINI_API_KEY trên máy chủ.');
      console.error(`[api] gemini ${status}: ${String(detail).slice(0, 400)}`);
      throw new HttpFail(502, 'Dịch vụ AI trả lỗi. Vui lòng thử lại sau ít phút.');
    }
    const data = await response.json().catch(() => { throw new HttpFail(502, 'Dịch vụ AI trả dữ liệu vỡ.'); });
    const text = readGeminiText(data);
    try {
      return extractModelJson(text);
    } catch {
      if (attempt === 2) throw new HttpFail(502, 'AI trả nội dung chưa đúng định dạng. Vui lòng thử lại.');
      // Vòng 2: hạ chút heat cho "nghe lời".
      temperature = Math.max(0.3, temperature - 0.3);
    }
  }
  throw new HttpFail(502, 'AI trả nội dung chưa đúng định dạng. Vui lòng thử lại.');
}

/** Ép chuẩn từng email + giới hạn độ dài — trả `count` email hoặc bắn HttpFail. */
export function clampEmailList(data, count = 3) {
  const mails = Array.isArray(data?.emails) ? data.emails : [];
  if (mails.length < count) throw new HttpFail(502, 'AI chưa trả về đủ 3 mẫu email.');
  const out = [];
  for (let i = 0; i < count; i++) {
    const m = mails[i];
    const subject = clampStr(m?.subject, LIMITS.subject);
    const body = cleanKeepNewlines(m?.body).slice(0, LIMITS.body);
    const cta = clampStr(m?.cta, LIMITS.cta);
    if (!subject || !body || !cta) throw new HttpFail(502, 'Một mẫu email thiếu nội dung cần thiết.');
    out.push({ subject, body, cta });
  }
  return out;
}

/**
 * Làm sạch body nhưng GIỮ ngắt đoạn: prompt yêu cầu model ngắt đoạn bằng `\n\n`
 * nên không được gộp chúng thành một dòng (bug cũ: email AI mất hết đoạn văn).
 * Quy tắc: gộp space/tab trong dòng, bỏ space quanh newline, tối đa 1 dòng trống.
 */
export function cleanKeepNewlines(v) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Ép chuẩn email viết lại (1 email). */
export function clampRewrittenEmail(data) {
  const m = data?.email ?? {};
  const subject = clampStr(m?.subject, LIMITS.subject);
  const body = cleanKeepNewlines(m?.body).slice(0, LIMITS.body);
  const cta = clampStr(m?.cta, LIMITS.cta);
  if (!subject || !body || !cta) throw new HttpFail(502, 'AI trả về nội dung chưa hợp lệ.');
  return { email: { subject, body, cta } };
}

/** Dựng prompt tạo 3 mẫu — quy ước kiểu viết khớp `variants` ở frontend. */
export function buildGeneratePrompt(c) {
  return `
Bạn là biên tập viên email marketing tiếng Việt giàu kinh nghiệm. Tạo đúng 3 mẫu email cho chiến dịch sau, mỗi mẫu theo một kiểu viết khác nhau:

1. ${VARIANT_STYLES[0]}
2. ${VARIANT_STYLES[1]}
3. ${VARIANT_STYLES[2]}

Thông tin chiến dịch (JSON):
{
  "thương hiệu": ${JSON.stringify(c.brand)},
  "mục tiêu": ${JSON.stringify(GOALS[c.goal])},
  "thông điệp chính": ${JSON.stringify(c.offer)},
  "ngành hàng": ${JSON.stringify(INDUSTRIES[c.industry])},
  "đối tượng${c.audience ? '' : ' (chưa nêu)'}": ${JSON.stringify(c.audience || 'khách hàng chung')}
}

Yêu cầu bắt buộc:
- Tiếng Việt tự nhiên, đúng tông thương hiệu, không sáo rỗng.
- CHỈ dùng số liệu, phần trăm, điều kiện, thời hạn có trong thông điệp chính. Tuyệt đối không bịa giảm giá, deadline, khan hiếm hay cam kết.
- 3 mẫu phải khác biệt rõ rệt về cách mở đầu và cách dẫn dắt, không lặp câu.
- CTA ≤ 12 từ, không dùng dấu ngoặc kép trong trường cta.
- body dùng \\n\\n ngắt đoạn (không dùng HTML hay markdown).
- Độ dài: subject ≤ 140 ký tự, body ≤ 2400 ký tự, cta ≤ 70 ký tự.

Trả về DUY NHẤT một JSON, đúng schema, không thêm giải thích:
{"emails":[{"subject":"...","body":"...","cta":"..."},{"subject":"...","body":"...","cta":"..."},{"subject":"...","body":"...","cta":"..."}]}
Số phần tử đúng là 3.`.trim();
}

/** Dựng prompt viết lại theo tông — giữ nguyên thực chất, chất lượng. */
export function buildRewritePrompt(c, email, tone) {
  return `
Bạn là biên tập viên email marketing tiếng Việt. Viết lại email dưới đây theo giọng: ${TONES[tone]}.

Email hiện tại (JSON):
{"subject":${JSON.stringify(email.subject)},"body":${JSON.stringify(email.body)},"cta":${JSON.stringify(email.cta)}}

Bối cảnh chiến dịch:
- Thương hiệu: ${JSON.stringify(c.brand)}
- Mục tiêu: ${JSON.stringify(GOALS[c.goal])}
- Thông điệp chính: ${JSON.stringify(c.offer)}
- Ngành hàng: ${JSON.stringify(INDUSTRIES[c.industry])}
- Đối tượng: ${JSON.stringify(c.audience || 'khách hàng chung')}

Yêu cầu:
- Giữ nguyên thông tin chính và ưu đãi; CHỈ đổi cách diễn đạt. Không bịa số liệu, deadline, khan hiếm.
- Không dùng markdown/HTML trong body; ngắt đoạn bằng \\n\\n.
- subject ≤ 140 ký tự, body ≤ 2400 ký tự, cta ≤ 70 ký tự (cta có thể giữ nguyên hoặc làm mới ngắn gọn hơn theo tông).

Trả về DUY NHẤT một JSON đúng schema, không giải thích:
{"email":{"subject":"...","body":"...","cta":"..."}}`.trim();
}
