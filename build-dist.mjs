/**
 * build-dist.mjs — dựng thư mục `dist/` đảm bảo sạch trước khi deploy:
 *  - chỉ gồm file tĩnh + `functions/` (Pages Functions) + `_headers`/`robots.txt`
 *  - KHÔNG mang node_modules, .dev.vars (SECRET!), .wrangler, docs, test
 *  - nếu có biến môi trường SITE_URL thì sinh thêm `sitemap.xml` đúng miền thật
 * Chạy: node build-dist.mjs   (được gọi tự động trong `npm run deploy`)
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATIC_FILES = ['index.html', 'styles.css', 'app.js', 'favicon.svg', 'robots.txt'];
// `_headers` là cấu hình của Cloudflare Pages, không phải nội dung để tải về,
// nhưng vẫn phải nằm trong thư mục deploy thì Pages mới đọc được.
const CONFIG_FILES = ['_headers'];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

for (const file of [...STATIC_FILES, ...CONFIG_FILES]) {
  await cp(file, path.join('dist', file));
}
await cp('functions', path.join('dist', 'functions'), { recursive: true });

// sitemap.xml cần URL tuyệt đối; không đoán miền, chỉ sinh khi triển khai thật có SITE_URL.
const siteUrl = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
if (siteUrl) {
  if (!/^https?:\/\/[^/\s]+$/i.test(siteUrl)) {
    console.error(`[build-dist] SITE_URL không hợp lệ: ${siteUrl} (cần dạng https://ten-mien.tld)`);
    process.exit(1);
  }
  await writeFile(
    path.join('dist', 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${siteUrl}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`,
    'utf8',
  );
  console.log(`[build-dist] sitemap.xml -> ${siteUrl}/`);
} else {
  console.log('[build-dist] bỏ qua sitemap.xml (chưa đặt SITE_URL).');
}

console.log('[build-dist] OK -> dist/ (static + functions, không có secret)');
