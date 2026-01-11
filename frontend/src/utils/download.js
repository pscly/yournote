export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // 一般浏览器会自行回收，但这里主动释放更稳妥
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export function downloadText(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

export function safeFilenamePart(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Windows 不能使用的字符：\ / : * ? " < > |，并且避免控制字符
  const replaced = raw.replace(/[\\/:*?"<>|]/g, '_');
  const withoutControls = Array.from(replaced)
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('');
  return withoutControls.replace(/\s+/g, ' ').slice(0, 60).trim();
}

export function formatExportTimestamp(date = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);

    const pick = (type) => parts.find(p => p.type === type)?.value;
    const y = pick('year');
    const m = pick('month');
    const day = pick('day');
    const hh = pick('hour');
    const mm = pick('minute');
    const ss = pick('second');
    if (y && m && day && hh && mm && ss) return `${y}${m}${day}-${hh}${mm}${ss}`;
  } catch {
    // Intl 在极少数环境不可用时，回退到本地时间
  }

  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}${m}${day}-${hh}${mm}${ss}`;
}
