export function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (typeof value !== 'string') {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  let s = value.trim();
  if (!s) return null;

  // FastAPI / Pydantic 对 SQLite 的 datetime 可能输出不带时区的 ISO 字符串：
  // 例如 "2026-01-09T02:03:04" 或 "2026-01-09 02:03:04"
  // 这种字符串在浏览器里会被当作“本地时间”解析，导致 UTC->本地出现 8 小时偏差。
  // 这里统一把“无时区”的时间当作 UTC 来解析（加 Z）。
  const hasTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(s);
  if (!hasTz) {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
      s = s.replace(' ', 'T');
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      s = `${s}Z`;
    }
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatBeijingDateTime(value) {
  const d = parseServerDate(value);
  if (!d) return '-';
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 经验规则：Unix 秒级时间戳通常 < 1e12；毫秒级时间戳通常 >= 1e12（约 2001 年之后）
  if (n < 1e12) return n * 1000;
  return n;
}

export function formatBeijingDateTimeFromTs(ts) {
  const ms = normalizeEpochMs(ts);
  if (!ms) return '-';

  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
