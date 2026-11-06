#!/usr/bin/env node
/**
 * serve-static.mjs — server tĩnh tối giản, không phụ thuộc Python, dùng cho
 * phát triển nhanh và cho Playwright (webServer).
 *
 * Vì sao không dùng `python -m http.server`:
 *  - không đoán MIME đúng cho `.mjs`/`.svg` ở một số bản Python,
 *  - `python` không tồn tại trên mọi runner CI (có khi chỉ có `python3`),
 *  - không kiểm soát đường dẫn/`..`/fallback.
 *
 * Cố tình KHÔNG có `/api/*`: đó là cách tái hiện đúng "chưa cấu hình backend"
 * để kiểm thử nhánh demo (detectEngine rơi về chế độ trải nghiệm).
 *
 * Server cũng đọc `_headers` (cú pháp của Cloudflare Pages) để lúc dev/E2E chạy
 * dưới đúng CSP và security headers như production — nếu CSP chặn nhầm tính
 * năng (iframe srcdoc, ảnh blob, font CDN) thì test sẽ báo ngay.
 * Giống Pages: `_headers` không được phục vụ như asset, và cũng không áp cho
 * route `/api/*` (vì đó là Functions ở production).
 *
 * Dùng:
 *   node scripts/serve-static.mjs --port 8790 --root .
 *   node scripts/serve-static.mjs --root dist          # thử đúng thư mục deploy
 *   node scripts/serve-static.mjs --no-headers         # tắt áp _headers
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 8790, root: '.', host: '127.0.0.1', quiet: false, headers: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--root') args.root = argv[++i];
    else if (flag === '--host') args.host = argv[++i];
    else if (flag === '--quiet') args.quiet = true;
    else if (flag === '--no-headers') args.headers = false;
    else if (flag === '--help' || flag === '-h') {
      console.log(
        'Usage: node scripts/serve-static.mjs [--port 8790] [--root .] [--host 127.0.0.1] [--quiet] [--no-headers]',
      );
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!Number.isInteger(args.port) || args.port <= 0) {
  console.error(`[serve-static] port không hợp lệ: ${args.port}`);
  process.exit(1);
}
const root = path.resolve(args.root);
const log = (...parts) => {
  if (!args.quiet) console.log('[serve-static]', ...parts);
};

/**
 * Chuyển URL pattern của `_headers` thành RegExp.
 * Hỗ trợ đúng tập con mà dự án dùng: `/*` (splat tham lam), `/media/*`,
 * `:placeholder` (một segment). Pattern kèm host (https://…) bị bỏ qua vì
 * server này chạy localhost.
 */
function headerPatternMatcher(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      source += '.*';
    } else if (char === ':' && /[A-Za-z_]/.test(pattern[i + 1] || '')) {
      while (i + 1 < pattern.length && /[A-Za-z0-9_]/.test(pattern[i + 1])) i++;
      source += '[^/]+';
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

async function loadHeaderRules(dir) {
  const file = path.join(dir, '_headers');
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return [];
  const rules = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    // Dòng thụt lề là header; dòng ở cột 0 là pattern.
    if (!/^\s/.test(rawLine)) {
      if (rawLine.includes('://')) continue;
      current = { matcher: headerPatternMatcher(rawLine.trim()), headers: [] };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const separator = rawLine.indexOf(':');
    if (separator < 1) continue;
    current.headers.push([rawLine.slice(0, separator).trim(), rawLine.slice(separator + 1).trim()]);
  }
  return rules;
}

const headerRules = args.headers ? await loadHeaderRules(root) : [];

/** Ghép header của mọi rule khớp path; rule sau thắng, trùng tên thì nối bằng dấu phẩy (như Pages). */
function headersForPath(pathname) {
  const applied = new Map();
  for (const rule of headerRules) {
    if (!rule.matcher.test(pathname)) continue;
    for (const [name, value] of rule.headers) {
      const previous = applied.get(name);
      applied.set(name, previous ? `${previous}, ${value}` : value);
    }
  }
  return Object.fromEntries(applied);
}

const CONFIG_ONLY = new Set(['/_headers', '/_redirects']);

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(root, relative || '.');
  // Chặn thoát khỏi root bằng `..` hoặc đường dẫn tuyệt đối khác.
  if (target !== root && !target.startsWith(root + path.sep)) return { status: 403 };
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) {
    const indexFile = path.join(target, 'index.html');
    const indexInfo = await stat(indexFile).catch(() => null);
    return indexInfo?.isFile() ? { file: indexFile, size: indexInfo.size } : { status: 404 };
  }
  if (info?.isFile()) return { file: target, size: info.size };
  // Fallback kiểu SPA của Cloudflare Pages: path không có phần mở rộng → index.html.
  if (!path.extname(relative)) {
    const indexFile = path.join(root, 'index.html');
    const indexInfo = await stat(indexFile).catch(() => null);
    if (indexInfo?.isFile()) return { file: indexFile, size: indexInfo.size, spa: true };
  }
  return { status: 404 };
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  // Pages không phục vụ `_headers`/`_redirects` — dev server cũng vậy.
  if (CONFIG_ONLY.has(pathname)) {
    log(method, req.url, '→ 404 (tệp cấu hình)');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }
  let result;
  try {
    result = await resolveFile(req.url || '/');
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  // `_headers` của Pages không áp cho Pages Functions, nên cũng không áp cho `/api/*`.
  const extraHeaders = pathname.startsWith('/api/') ? {} : headersForPath(pathname);
  if (result.status) {
    log(method, req.url, '→', result.status);
    res
      .writeHead(result.status, { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders })
      .end(String(result.status));
    return;
  }
  log(method, req.url, '→', path.relative(root, result.file), result.spa ? '(spa)' : '');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(result.file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': result.size,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(result.file).pipe(res);
});

server.listen(args.port, args.host, () => {
  console.log(`[serve-static] nghe tại http://${args.host}:${args.port} (root: ${root})`);
  if (args.headers) {
    console.log(
      headerRules.length
        ? `[serve-static] áp ${headerRules.length} rule từ _headers`
        : '[serve-static] không thấy _headers — chạy không có CSP',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
