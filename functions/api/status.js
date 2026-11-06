/**
 * GET /api/status — frontend gọi khi tải trang (detectEngine, timeout 6s).
 * Trả `{"mode":"ai"}` khi đã cấu hình khoá Gemini, ngược lại `{"mode":"demo"}`
 * để app tự chạy bộ nội dung mẫu và ghi rõ trạng thái trên UI.
 * Frontend bắt mọi lỗi rồi rơi về demo, nên endpoint này giữ tối giản.
 */
import { json } from '../_lib.js';

export async function onRequestGet({ env }) {
  return json({ mode: env.GEMINI_API_KEY ? 'ai' : 'demo' });
}
