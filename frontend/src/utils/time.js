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

export function formatBeijingDateTimeFromTs(ts, { showSeconds = false } = {}) {
  const ms = normalizeEpochMs(ts);
  if (!ms) return '-';

  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '-';

  // 默认不展示秒（UI 更清爽）；需要秒时可传 { showSeconds: true }
  const options = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  if (showSeconds) options.second = '2-digit';

  return d.toLocaleString('zh-CN', options);
}

export function getBeijingDateString(offsetDays = 0) {
  const offset = Number(offsetDays) || 0;
  const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d).replace(/\//g, '-');
  } catch {
    // fallback：以本地日期输出（极少数环境无 Intl/timeZone）
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
}

export function beijingDateStringToUtcRangeMs(dateString) {
  const [yy, mm, dd] = String(dateString || '').split('-').map(Number);
  if (!yy || !mm || !dd) return { since_ms: 0, until_ms: 0 };

  // 北京时间 00:00 = UTC 前一日 16:00（固定 +8 时区，无夏令时）
  const sinceMs = Date.UTC(yy, mm - 1, dd, 0, 0, 0) - 8 * 60 * 60 * 1000;
  const untilMs = sinceMs + 24 * 60 * 60 * 1000;
  return { since_ms: sinceMs, until_ms: untilMs };
}
