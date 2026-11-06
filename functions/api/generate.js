/**
 * POST /api/generate — tạo 3 mẫu email marketing (bước 2 của wizard).
 *
 * Nhận: {brand, goal, offer, industry, audience} (do frontend tự validate trước).
 * Trả:  {emails: [{subject, body, cta}] x3}
 *       — cố ý KHÔNG trả schedule: normalizeSchedule() ở frontend tự rơi về
 *         bảng thời gian tĩnh theo ngành, nhờ đó prompt ngắn hơn và ổn định hơn.
 * Lỗi:  {error: "..."} + status (400 đầu vào · 429 hết lượt · 502/504 upstream).
 */
import {
  asJsonError, askGeminiJson, buildGeneratePrompt, clampEmailList,
  enforceDailyRate, fail, json, readJsonBody, validateCampaign,
} from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const campaign = validateCampaign(body);
    await enforceDailyRate(env, request, 'generate');
    const data = await askGeminiJson(env, buildGeneratePrompt(campaign), {
      temperature: 0.85,
      maxOutputTokens: 2048,
    });
    return json({ emails: clampEmailList(data, 3) });
  } catch (err) {
    return asJsonError(err);
  }
}

/** Phương thức khác: trả JSON thay vì để rơi vào SPA fallback (HTML). */
export function onRequest() {
  return fail(405, 'Yêu cầu không hợp lệ.');
}
