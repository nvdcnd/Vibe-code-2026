/**
 * Test "unit" cho các hàm thuần của frontend, chạy ngay trong trình duyệt thật.
 *
 * `app.js` là classic script nên các khai báo `function` trở thành thuộc tính của
 * `window` — vừa đúng môi trường thực thi thật, vừa không phải refactor app sang
 * ESM chỉ để test được. Những hàm dưới đây quyết định nội dung email người dùng
 * gửi đi (escape, cắt chuỗi, mailto budget), nên chúng xứng đáng có test riêng.
 */
import { expect, test } from '@playwright/test';

const PAGE = '/';

async function call(page, fn, ...args) {
  return page.evaluate(({ name, params }) => window[name](...params), { name: fn, params: args });
}

/** Gọi hàm và trả về thông điệp lỗi (null nếu không ném lỗi). */
async function callExpectingThrow(page, fn, ...args) {
  return page.evaluate(
    ({ name, params }) => {
      try {
        window[name](...params);
        return null;
      } catch (error) {
        return error.message;
      }
    },
    { name: fn, params: args },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

test.describe('escapeHTML — hàng rào chống XSS duy nhất của app', () => {
  test('escape đủ 5 ký tự nguy hiểm', async ({ page }) => {
    expect(await call(page, 'escapeHTML', `<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  test('không đổi văn bản bình thường (kể cả tiếng Việt)', async ({ page }) => {
    expect(await call(page, 'escapeHTML', 'Ưu đãi 20% cà phê — Luna')).toBe('Ưu đãi 20% cà phê — Luna');
  });

  test('xử lý null/undefined/số mà không ném lỗi', async ({ page }) => {
    expect(await call(page, 'escapeHTML', null)).toBe('');
    expect(await call(page, 'escapeHTML', undefined)).toBe('');
    expect(await call(page, 'escapeHTML', 0)).toBe('0');
  });

  test('escape hai lần không tạo thực thể lồng nhau sai', async ({ page }) => {
    const once = await call(page, 'escapeHTML', '<b>');
    expect(await call(page, 'escapeHTML', once)).toBe('&amp;lt;b&amp;gt;');
  });
});

test.describe('initials — avatar người gửi', () => {
  test('lấy chữ đầu của hai từ', async ({ page }) => {
    expect(await call(page, 'initials', 'Luna Coffee')).toBe('LC');
  });

  test('rỗng → mặc định MC', async ({ page }) => {
    expect(await call(page, 'initials', '')).toBe('MC');
    expect(await call(page, 'initials', '   ')).toBe('MC');
    expect(await call(page, 'initials', null)).toBe('MC');
  });

  test('viết hoa đúng tiếng Việt', async ({ page }) => {
    expect(await call(page, 'initials', 'nguyễn văn an')).toBe('NV');
  });

  test('chỉ lấy tối đa hai từ', async ({ page }) => {
    expect(await call(page, 'initials', 'Công ty TNHH Cà Phê Việt')).toBe('CT');
  });
});

test.describe('shorter — rút gọn để hiển thị thẻ mẫu', () => {
  test('giữ nguyên khi ngắn hơn giới hạn', async ({ page }) => {
    expect(await call(page, 'shorter', 'Câu ngắn.', 50)).toBe('Câu ngắn');
  });

  test('cắt và thêm dấu ba chấm khi vượt giới hạn', async ({ page }) => {
    const result = await call(page, 'shorter', 'a'.repeat(100), 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
  });

  test('gộp khoảng trắng trước khi đo', async ({ page }) => {
    expect(await call(page, 'shorter', '  quá   nhiều    space  ', 100)).toBe('quá nhiều space');
  });
});

test.describe('clean & formatEmailText', () => {
  test('clean gộp khoảng trắng', async ({ page }) => {
    expect(await call(page, 'clean', ' a \n b ')).toBe('a b');
  });

  test('formatEmailText có đủ 3 phần và liên kết khi có URL', async ({ page }) => {
    const output = await call(page, 'formatEmailText', {
      subject: 'Chủ đề',
      body: 'Thân',
      cta: 'Bấm',
      url: 'https://x.vn',
    });
    expect(output).toBe('Tiêu đề: Chủ đề\n\nThân\n\nCTA: Bấm\nLiên kết: https://x.vn');
  });

  test('formatEmailText bỏ dòng liên kết khi không có URL', async ({ page }) => {
    const output = await call(page, 'formatEmailText', { subject: 'A', body: 'B', cta: 'C', url: '' });
    expect(output).not.toContain('Liên kết');
  });
});

test.describe('buildMailtoUrl — giới hạn ~1900 ký tự của URL', () => {
  test('nội dung ngắn: giữ nguyên, không rút gọn', async ({ page }) => {
    const result = await call(page, 'buildMailtoUrl', {
      subject: 'Ưu đãi',
      body: 'Nội dung ngắn.',
      cta: 'Xem',
      url: 'https://lunacoffee.vn/uu-dai',
    });
    expect(result.cut).toBe(false);
    expect(result.url.startsWith('mailto:?subject=')).toBe(true);
    expect(result.url).toContain(encodeURIComponent('Nội dung ngắn.'));
    expect(result.url).not.toContain('MailCraft');
  });

  test('nội dung dài: rút gọn trong budget và nêu rõ đã rút gọn', async ({ page }) => {
    const result = await call(page, 'buildMailtoUrl', {
      subject: 'Ưu đãi',
      body: 'Xin chào quý khách. '.repeat(200),
      cta: 'Xem',
      url: '',
    });
    expect(result.cut).toBe(false);
    expect(result.url.length).toBeLessThanOrEqual(1900);
    expect(decodeURIComponent(result.url)).toContain('[MailCraft: nội dung đã rút gọn');
  });

  test('ký tự đa byte vẫn được mã hoá đúng và không vượt budget', async ({ page }) => {
    const result = await call(page, 'buildMailtoUrl', {
      subject: 'Ưu đãi đặc biệt 🎉',
      body: 'مرحبا '.repeat(300),
      cta: 'Xem ngay',
      url: 'https://x.vn',
    });
    expect(result.url.length).toBeLessThanOrEqual(1900);
    expect(() => decodeURIComponent(result.url)).not.toThrow();
  });

  test('không sinh URL vượt budget kể cả nội dung cực dài', async ({ page }) => {
    const result = await call(page, 'buildMailtoUrl', {
      subject: 's'.repeat(140),
      body: 'b'.repeat(2400),
      cta: 'c'.repeat(70),
      url: 'https://x.vn/' + 'u'.repeat(400),
    });
    expect(result.url.length).toBeLessThanOrEqual(1900);
  });
});

test.describe('normalizeEmails — chốt chặn dữ liệu AI', () => {
  const valid = {
    emails: [
      { subject: 'A', body: 'B', cta: 'C' },
      { subject: 'D', body: 'E', cta: 'F' },
      { subject: 'G', body: 'H', cta: 'I' },
    ],
  };

  test('nhận đủ 3 mẫu và thêm url rỗng', async ({ page }) => {
    const result = await call(page, 'normalizeEmails', valid);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ subject: 'A', body: 'B', cta: 'C', url: '' });
  });

  test('cắt về giới hạn 140/2400/70', async ({ page }) => {
    const [first] = await call(page, 'normalizeEmails', {
      emails: [
        { subject: 's'.repeat(200), body: 'b'.repeat(3000), cta: 'c'.repeat(100) },
        ...valid.emails.slice(1),
      ],
    });
    expect(first.subject.length).toBe(140);
    expect(first.body.length).toBe(2400);
    expect(first.cta.length).toBe(70);
  });

  test('2 mẫu → báo thiếu', async ({ page }) => {
    expect(await callExpectingThrow(page, 'normalizeEmails', { emails: valid.emails.slice(0, 2) })).toBe(
      'AI chưa trả về đủ 3 mẫu email.',
    );
  });

  test('4 mẫu → báo thiếu (hợp đồng là đúng 3)', async ({ page }) => {
    const four = { emails: [...valid.emails, valid.emails[0]] };
    expect(await callExpectingThrow(page, 'normalizeEmails', four)).toBe('AI chưa trả về đủ 3 mẫu email.');
  });

  test('mẫu thiếu trường → báo lỗi nội dung', async ({ page }) => {
    const broken = { emails: [{ subject: 'A', body: 'B', cta: '  ' }, ...valid.emails.slice(1)] };
    expect(await callExpectingThrow(page, 'normalizeEmails', broken)).toBe(
      'Một mẫu email thiếu nội dung cần thiết.',
    );
  });

  test('không phải mảng → báo thiếu', async ({ page }) => {
    expect(await callExpectingThrow(page, 'normalizeEmails', { emails: null })).toBe(
      'AI chưa trả về đủ 3 mẫu email.',
    );
  });
});

test.describe('normalizeSchedule — rơi về bảng giờ gửi tĩnh theo ngành', () => {
  test('dữ liệu AI hợp lệ được dùng nguyên', async ({ page }) => {
    const result = await call(
      page,
      'normalizeSchedule',
      {
        primary: { day: 'Thứ Hai', time: '08:00' },
        secondary: { day: 'Thứ Sáu', time: '17:00' },
        reason: 'Lý do riêng.',
      },
      'food',
    );
    expect(result.primary).toEqual({ day: 'Thứ Hai', time: '08:00' });
    expect(result.secondary).toEqual({ day: 'Thứ Sáu', time: '17:00' });
    expect(result.reason).toBe('Lý do riêng.');
  });

  test('dữ liệu hỏng → fallback theo ngành', async ({ page }) => {
    const result = await call(page, 'normalizeSchedule', null, 'tech');
    expect(result.primary.day).toBe('Thứ Ba');
    expect(result.primary.time).toBe('09:00 – 10:00');
    expect(result.reason).not.toBe('');
  });

  test('slot thiếu trường bị thay bằng fallback, reason vẫn giữ nếu hợp lệ', async ({ page }) => {
    const result = await call(
      page,
      'normalizeSchedule',
      {
        primary: { day: 'Thứ Hai' },
        secondary: { day: 'Thứ Ba', time: '10:00' },
        reason: '  ',
      },
      'retail',
    );
    expect(result.primary.day).toBe('Thứ Tư');
    expect(result.secondary).toEqual({ day: 'Thứ Ba', time: '10:00' });
    expect(result.reason).toContain('thời gian nghỉ trưa');
  });

  test('cắt độ dài day/time/reason', async ({ page }) => {
    const result = await call(
      page,
      'normalizeSchedule',
      {
        primary: { day: 'd'.repeat(100), time: 't'.repeat(100) },
        secondary: { day: 'x', time: 'y' },
        reason: 'r'.repeat(1000),
      },
      'service',
    );
    expect(result.primary.day.length).toBe(35);
    expect(result.primary.time.length).toBe(45);
    expect(result.reason.length).toBe(480);
  });
});
