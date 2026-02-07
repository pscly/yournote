export function getRequestIdFromAxiosError(error) {
  try {
    const headers = error?.response?.headers;
    if (!headers) return null;
    // axios 会把 headers key 统一成小写
    const rid = headers['x-request-id'] || headers['x-requestid'] || headers['x-correlation-id'];
    if (typeof rid !== 'string') return null;
    const s = rid.trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

function normalizeDetail(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail.trim() || null;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: detail=[{loc,msg,type}, ...]
    const first = detail[0];
    const msg = first?.msg;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  if (typeof detail === 'object') {
    const message = detail?.message || detail?.msg || detail?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return null;
}

export function getErrorMessage(error, options = {}) {
  const {
    fallback = '未知错误',
    includeRequestId = true,
    withStatus = false,
  } = options || {};

  const status = error?.response?.status;
  const detail = normalizeDetail(error?.response?.data?.detail);
  const message = (typeof error?.message === 'string' ? error.message : null);
  const code = (typeof error?.code === 'string' ? error.code : null);

  const parts = [];

  // 优先用后端返回的 detail（更贴近业务）
  const main = detail || (message && message.trim()) || fallback;
  parts.push(main);

  if (withStatus && typeof status === 'number') {
    parts.push(`HTTP ${status}`);
  }

  // 网络类错误补充 code，便于定位（例如 ECONNABORTED）
  if (code && !detail) {
    parts.push(code);
  }

  const rid = includeRequestId ? getRequestIdFromAxiosError(error) : null;
  if (rid) {
    parts.push(`请求ID: ${rid}`);
  }

  const extra = parts.slice(1).filter(Boolean);
  if (extra.length === 0) return String(parts[0] || fallback);
  return `${parts[0]}（${extra.join('，')}）`;
}
