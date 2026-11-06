/**
 * POST /api/rewrite — viết lại 1 mẫu email theo tông giọng (bước 2).
 *
 * Nhận: {campaign, email:{subject,body,cta}, tone:"formal"|"fun"|"urgent"}.
 * Trả:  {email:{subject, body, cta}}
 *       — frontend tự giữ lại url CTA nên backend không cần lo trường đó.
 * Lỗi:  {error: "..."} + status, cùng quy ước với generate.js.
 */
import {
  asJsonError, askGeminiJson, buildRewritePrompt, clampRewrittenEmail,
  enforceDailyRate, fail, json, readJsonBody, validateEmailForRewrite,
} from '../_lib.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { campaign, email, tone } = validateEmailForRewrite(body);
    await enforceDailyRate(env, request, 'rewrite');
    const data = await askGeminiJson(env, buildRewritePrompt(campaign, email, tone), {
      temperature: 0.7,
      maxOutputTokens: 1024,
    });
    return json(clampRewrittenEmail(data));
  } catch (err) {
    return asJsonError(err);
  }
}

export function onRequest() {
  return fail(405, 'Yêu cầu không hợp lệ.');
}
