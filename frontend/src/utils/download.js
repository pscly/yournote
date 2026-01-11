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
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}
