/**
 * Cấu hình ESLint (flat config) cho MailCraft AI.
 *
 * Mục tiêu: bắt lỗi thật (biến không dùng, so sánh sai, promise không await,
 * regex nguy hiểm…), KHÔNG áp đặt style — style do Prettier lo.
 *
 * Ba ngữ cảnh chạy khác nhau nên global cũng khác nhau:
 *  - `app.js`            → classic script chạy trong browser (không phải module)
 *  - `functions/**`      → ESM cho Workers runtime
 *  - `tests/`, `e2e/`…   → ESM cho Node
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      'e2e-report/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    // Frontend: script cổ điển, không import/export, dùng DOM.
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    // Cloudflare Pages Functions: ESM, global kiểu Workers (fetch/Response/crypto).
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.worker },
    },
  },
  {
    files: ['**/*.mjs', 'tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Playwright mang cả API browser (page.evaluate) lẫn Node.
    files: ['e2e/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Test hay có biến chỉ dùng để ghi lại hành vi.
      'no-empty-pattern': 'error',
    },
  },
];
