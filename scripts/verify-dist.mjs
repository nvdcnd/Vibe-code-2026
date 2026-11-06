#!/usr/bin/env node
/**
 * verify-dist.mjs — chốt chặn cuối trước khi deploy.
 *
 * `npm run build` chỉ copy file; script này kiểm tra thứ thật sự quan trọng:
 *  1. Đủ asset public + toàn bộ Functions + `_headers`/`robots.txt`.
 *  2. KHÔNG có secret/tệp nội bộ trong `dist/` (.dev.vars, .wrangler, docs, test…).
 *  3. Không có chuỗi giống khoá API bị nhúng vào mã public.
 *  4. `_headers` phải thực sự gắn CSP (và không tự nới lỏng script-src).
 *
 * Chạy sau build: `npm run build && node scripts/verify-dist.mjs`.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist');
const REQUIRED_FILES = ['index.html', 'styles.css', 'app.js', 'favicon.svg', '_headers', 'robots.txt'];
const REQUIRED_DIRS = ['functions/api'];
const REQUIRED_FUNCTION_FILES = [
  'functions/_lib.js',
  'functions/api/status.js',
  'functions/api/generate.js',
  'functions/api/rewrite.js',
  'functions/api/upload.js',
  'functions/media/[[path]].js',
];
const FORBIDDEN_NAMES = new Set([
  '.dev.vars',
  '.dev.vars.example',
  '.git',
  '.wrangler',
  '.github',
  'node_modules',
  'e2e',
  'tests',
  'scripts',
  'test-results',
  'e2e-report',
  'playwright-report',
  'DOCUMENT.md',
  'package-lock.json',
  'playwright.config.mjs',
  'eslint.config.mjs',
]);
const SECRET_PATTERNS = [
  [/AIza[0-9A-Za-z_-]{35}/, 'khoá API Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];

const problems = [];
const fail = (message) => problems.push(message);

async function exists(target) {
  return Boolean(await stat(target).catch(() => null));
}

async function walk(dir, relative = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (FORBIDDEN_NAMES.has(entry.name)) {
      fail(`dist/ chứa tệp không được deploy: ${rel}`);
      continue;
    }
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
  }
}

if (!(await exists(DIST))) {
  console.error('[verify-dist] không thấy dist/ — hãy chạy `npm run build` trước.');
  process.exit(1);
}

for (const file of REQUIRED_FILES) {
  if (!(await exists(path.join(DIST, file)))) fail(`thiếu asset bắt buộc: ${file}`);
}
for (const dir of REQUIRED_DIRS) {
  if (!(await exists(path.join(DIST, dir)))) fail(`thiếu thư mục Functions: ${dir}`);
}
for (const file of REQUIRED_FUNCTION_FILES) {
  if (!(await exists(path.join(DIST, file)))) fail(`thiếu Pages Function: ${file}`);
}

await walk(DIST);

for (const file of REQUIRED_FILES.filter((name) => name.endsWith('.js') || name.endsWith('.html'))) {
  const target = path.join(DIST, file);
  if (!(await exists(target))) continue;
  const content = await readFile(target, 'utf8');
  if (!content.trim()) fail(`${file} rỗng`);
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(content)) fail(`${file} có dấu hiệu chứa ${label}`);
  }
}

/**
 * `_headers` là thứ dễ hỏng nhất khi deploy: sai một dòng là header biến mất
 * hoặc CSP bị nới lỏng mà không ai thấy. Kiểm tra đúng những bất biến quan trọng.
 */
const headersFile = path.join(DIST, '_headers');
if (await exists(headersFile)) {
  const text = await readFile(headersFile, 'utf8');
  const blocks = text.split(/\n(?=\S)/);
  const globalBlock = blocks.find((block) => block.trim().startsWith('/*'));
  if (!globalBlock) {
    fail('_headers thiếu rule toàn cục "/*"');
  } else {
    const csp = globalBlock
      .split('\n')
      .find((line) => /^\s*content-security-policy:/i.test(line))
      ?.split(/:(.+)/)
      .slice(1)
      .join('')
      .trim();
    if (!csp) {
      fail('_headers rule "/*" thiếu Content-Security-Policy');
    } else {
      if (!/script-src 'self'/.test(csp)) fail("CSP thiếu script-src 'self'");
      if (/'unsafe-eval'/.test(csp)) fail("CSP chứa 'unsafe-eval' — không được deploy");
      if (/script-src[^;]*\*/.test(csp)) fail('CSP cho phép script-src quá rộng');
      if (!/frame-ancestors 'none'/.test(csp)) fail("CSP thiếu frame-ancestors 'none'");
    }
    if (!/x-content-type-options:\s*nosniff/i.test(globalBlock)) {
      fail('_headers thiếu X-Content-Type-Options: nosniff');
    }
    for (const line of globalBlock.split('\n').slice(1)) {
      if (line.trim() && !line.includes(':')) fail(`_headers có dòng không hợp lệ: ${line.trim()}`);
    }
  }
}

// sitemap.xml chỉ có khi deploy với SITE_URL — nếu có thì phải là XML hợp lệ tối thiểu.
const sitemapFile = path.join(DIST, 'sitemap.xml');
if (await exists(sitemapFile)) {
  const sitemap = await readFile(sitemapFile, 'utf8');
  if (!sitemap.startsWith('<?xml')) fail('sitemap.xml thiếu khai báo <?xml');
  if (!/<loc>https?:\/\/[^<]+<\/loc>/.test(sitemap)) fail('sitemap.xml thiếu <loc> tuyệt đối');
}

if (problems.length) {
  console.error('[verify-dist] FAIL');
  for (const problem of problems) console.error(' -', problem);
  process.exit(1);
}

console.log('[verify-dist] OK — dist/ chỉ gồm asset public + Functions, không có secret.');
