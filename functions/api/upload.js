/**
 * POST /api/upload — đưa ảnh vào kho R2 (binding `MEDIA_BUCKET`), trả URL để
 * email dùng trực tiếp (deliverability tốt hơn nhiều so với base64 nhúng).
 *
 * Nhận: raw body = byte ảnh, header Content-Type = mime.
 * Trả:  {url:"/media/<key>"}  (frontend đổi thành URL tuyệt đối khi build HTML)
 * Tự hủy đứt: nếu chưa binding R2 → 501, frontend giữ nguyên luồng base64
 * ("chế độ nhúng"), không làm chết trải nghiệm người dùng.
 */
import { asJsonError, clean, enforceDailyRate, fail, json, sniffImageMime } from '../_lib.js';
import { IMAGE_TYPES, EXT_BY_TYPE } from '../_lib.js';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // khớp IMAGE_RULES.maxBytes của frontend

export async function onRequestPost({ request, env }) {
  try {
    const bucket = env.MEDIA_BUCKET;
    if (!bucket || typeof bucket.put !== 'function') {
      return fail(501, 'Chưa cấu hình kho ảnh (R2). Ứng dụng sẽ dùng ảnh nhúng base64.');
    }
    const mime = clean(request.headers.get('Content-Type') || '').replace(/;.*$/, '');
    if (!IMAGE_TYPES.includes(mime)) {
      return fail(415, 'Định dạng ảnh không hỗ trợ (chỉ jpg/png/webp/gif).');
    }
    // Đếm lượt TRƯỚC khi đọc body: đừng đọc tới 2 MB của một client đã hết hạn mức.
    await enforceDailyRate(env, request, 'upload');
    const buffer = await request.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > MAX_UPLOAD_BYTES) {
      return fail(413, 'Ảnh vượt quá 2 MB.');
    }
    // Nội dung quyết định loại tệp, không tin header: chặn HTML/SVG giả dạng ảnh.
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) {
      return fail(415, 'Tệp tải lên không phải ảnh hợp lệ (jpg/png/webp/gif).');
    }
    const ext = EXT_BY_TYPE[sniffed] || 'bin';
    const key = `uploads/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await bucket.put(key, buffer, { httpMetadata: { contentType: sniffed } });
    return json({ url: `/media/${key}` });
  } catch (err) {
    return asJsonError(err);
  }
}

export function onRequest() {
  return fail(405, 'Yêu cầu không hợp lệ.');
}
