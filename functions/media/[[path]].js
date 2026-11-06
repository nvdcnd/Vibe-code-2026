/**
 * GET /media/[[path]] — phục vụ ảnh từ kho R2 binding `MEDIA_BUCKET`.
 * Key mẫu: /media/uploads/1730…-uuid.png
 * Lưu ý sản xuất: nếu muốn cookie-free cache CDN cao hơn nữa, có thể set R2
 * public bucket + custom domain rồi trả URL đó từ /api/upload (không cần route này).
 */
export async function onRequestGet({ env, params }) {
  const bucket = env.MEDIA_BUCKET;
  if (!bucket || typeof bucket.get !== 'function') {
    return new Response('Chưa cấu hình kho ảnh (R2).', { status: 501 });
  }
  const key = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (!key || key.includes('..') || key.includes('\0')) {
    return new Response('Key không hợp lệ.', { status: 400 });
  }
  const obj = await bucket.get(key);
  if (!obj) return new Response('Không tìm thấy ảnh.', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
      // Immutable: key sinh ra đã chứa timestamp + UUID nên nội dung không bao giờ đổi.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Chặn trình duyệt tự đoán MIME (một tệp "ảnh" bị đoán thành HTML sẽ chạy script).
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
