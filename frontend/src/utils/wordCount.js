/**
 * 字数统计工具
 *
 * 约定：
 * - 默认“字数”按“去除所有空白字符后的字符数”统计（更贴近中文产品的字数口径）。
 * - 使用 Array.from 以 code point 计数，避免 emoji 等字符被算作 2 个。
 */

export function toText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function countChars(value, { excludeWhitespace = true } = {}) {
  const raw = toText(value);
  const normalized = excludeWhitespace ? raw.replace(/\s+/g, '') : raw;
  return Array.from(normalized).length;
}

export function getDiaryWordStats(diary) {
  const title = toText(diary?.title);
  const content = toText(diary?.content);

  const titleRaw = Array.from(title).length;
  const contentRaw = Array.from(content).length;

  const titleNoWhitespace = countChars(title, { excludeWhitespace: true });
  const contentNoWhitespace = countChars(content, { excludeWhitespace: true });

  return {
    title: { raw: titleRaw, no_whitespace: titleNoWhitespace },
    content: { raw: contentRaw, no_whitespace: contentNoWhitespace },
    total: {
      raw: titleRaw + contentRaw,
      no_whitespace: titleNoWhitespace + contentNoWhitespace,
    },
  };
}

