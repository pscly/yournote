function normalizeInternalPath(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || !s.startsWith('/') || s.startsWith('//')) return null;
  return s;
}

export function getLocationPath(location) {
  const pathname = normalizeInternalPath(location?.pathname) || '/';
  const search = typeof location?.search === 'string' ? location.search : '';
  return `${pathname}${search}`;
}

export function appendFromQuery(to, fromPath) {
  const normalizedTo = normalizeInternalPath(to);
  if (!normalizedTo) return to;

  const normalizedFrom = normalizeInternalPath(fromPath);
  if (!normalizedFrom) return normalizedTo;

  const url = new URL(normalizedTo, 'http://yournote.local');
  url.searchParams.set('from', normalizedFrom);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildDiaryDetailPath(diaryId, fromPath) {
  const idNum = Number(diaryId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  return appendFromQuery(`/diary/${idNum}`, fromPath);
}

export function getFromPathFromLocation(location) {
  try {
    const params = new URLSearchParams(location?.search || '');
    const queryFrom = normalizeInternalPath(params.get('from'));
    if (queryFrom) return queryFrom;
  } catch {
    // ignore
  }

  return normalizeInternalPath(location?.state?.from);
}

export function isUnmodifiedLeftClickEvent(event) {
  if (!event) return false;
  if (event.defaultPrevented) return false;
  if (typeof event.button === 'number' && event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}
