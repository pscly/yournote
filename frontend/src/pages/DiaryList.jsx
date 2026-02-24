import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Drawer,
  Grid,
  Image,
  Input,
  List,
  Pagination,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import { FilterOutlined, ReloadOutlined, SearchOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { accountAPI, diaryAPI, userAPI } from '../services/api';
import { downloadText, formatExportTimestamp, safeFilenamePart } from '../utils/download';
import { getErrorMessage } from '../utils/errorMessage';
import { getDiaryWordStats } from '../utils/wordCount';
import { formatBeijingDateTimeFromTs } from '../utils/time';
import Page from '../components/Page';

const { Title, Paragraph, Text } = Typography;

const DIARY_LIST_SCOPE_KEY = 'yournote.diaryList.scope.v1';
const DIARY_LIST_PAGE_SIZE_KEY = 'yournote.diaryList.pageSize.v1';
const DIARY_LIST_Q_MODE_KEY = 'yournote.diaryList.qMode.v1';
const DIARY_LIST_Q_SYNTAX_KEY = 'yournote.diaryList.qSyntax.v1';
const DIARY_LIST_STATS_ENABLED_KEY = 'yournote.diaryList.statsEnabled.v1';
const DIARY_LIST_VIEW_MODE_KEY = 'yournote.diaryList.viewMode.v1';
const DIARY_LIST_MULTI_EXPAND_KEY = 'yournote.diaryList.multiExpand.v1';

const ALL = 'all';
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

function readStringStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

function writeStringStorage(key, value) {
  try {
    window.localStorage.setItem(key, String(value ?? ''));
  } catch {
    // ignore
  }
}

function readIntStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (typeof raw !== 'string') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeIntStorage(key, value) {
  try {
    window.localStorage.setItem(key, String(value ?? ''));
  } catch {
    // ignore
  }
}

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseScope(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'matched' || v === 'all') return v;
  return null;
}

function parseQMode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'and' || v === 'or') return v;
  return null;
}

function parseQSyntax(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'smart' || v === 'plain') return v;
  return null;
}

function parseViewMode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'list' || v === 'read') return v;
  return null;
}

function parseOrderBy(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'ts' || v === 'created_date' || v === 'created_at' || v === 'bookmarked_at' || v === 'msg_count') return v;
  return null;
}

function parseOrder(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'desc' || v === 'asc') return v;
  return null;
}

function parseDateYmd(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  // 后端使用 date.fromisoformat，格式严格为 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseBool01(value) {
  const v = String(value ?? '').trim();
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

function parseSortValue(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return { orderBy: 'ts', order: 'desc' };
  const idx = v.lastIndexOf('_');
  if (idx <= 0 || idx >= v.length - 1) return { orderBy: 'ts', order: 'desc' };
  const left = v.slice(0, idx);
  const right = v.slice(idx + 1);
  return {
    orderBy: parseOrderBy(left) || 'ts',
    order: parseOrder(right) || 'desc',
  };
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getShownMsgCount(item) {
  const n = Number(item?.msg_count);
  const shown = Number.isFinite(n) ? n : 0;
  return shown;
}

function getShownAccountIdText(item) {
  const n = Number(item?.account_id);
  const shown = Number.isFinite(n) ? n : null;
  return shown ? String(shown) : '-';
}

function parseSmartQuery(raw, { maxPositive = 10, maxExcludes = 10 } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return { terms: [], phrases: [], excludes: [] };

  const terms = [];
  const phrases = [];
  const excludes = [];

  const posSeen = new Set();
  const excSeen = new Set();
  let posCount = 0;

  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (i >= s.length) break;

    let neg = false;
    if (s[i] === '-') {
      neg = true;
      i += 1;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (i >= s.length) break;
    }

    let quoted = false;
    let token = '';
    if (s[i] === '"') {
      quoted = true;
      i += 1;
      const start = i;
      while (i < s.length && s[i] !== '"') i += 1;
      token = s.slice(start, i).trim();
      if (i < s.length && s[i] === '"') i += 1;
    } else {
      const start = i;
      while (i < s.length && !/\s/.test(s[i])) i += 1;
      token = s.slice(start, i).trim();
    }

    if (!token) continue;
    const key = token.toLowerCase();
    if (neg) {
      if (excludes.length >= maxExcludes) continue;
      if (excSeen.has(key)) continue;
      excSeen.add(key);
      excludes.push(token);
      continue;
    }

    if (posCount >= maxPositive) continue;
    if (posSeen.has(key)) continue;
    posSeen.add(key);
    posCount += 1;
    if (quoted) phrases.push(token);
    else terms.push(token);
  }

  return { terms, phrases, excludes };
}

export default function DiaryList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isBookmarksRoute = String(location?.pathname || '').startsWith('/bookmarks');
  const isMessagesRoute = String(location?.pathname || '').startsWith('/messages');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();
  const searchInputRef = useRef(null);
  const bookmarksDefaultsInjectedRef = useRef(false);
  const messagesDefaultsInjectedRef = useRef(false);
  const isMobileByWindow = (() => {
    try {
      return window.innerWidth < 768;
    } catch {
      return isMobile;
    }
  })();

  const storedScope = readStringStorage(DIARY_LIST_SCOPE_KEY);
  const storedPageSize = readIntStorage(DIARY_LIST_PAGE_SIZE_KEY);
  const storedQMode = readStringStorage(DIARY_LIST_Q_MODE_KEY);
  const storedQSyntax = readStringStorage(DIARY_LIST_Q_SYNTAX_KEY);
  const storedStatsEnabledRaw = readStringStorage(DIARY_LIST_STATS_ENABLED_KEY);
  const storedStatsEnabled = parseBool01(storedStatsEnabledRaw);
  const storedViewMode = readStringStorage(DIARY_LIST_VIEW_MODE_KEY);
  const storedMultiExpandRaw = readStringStorage(DIARY_LIST_MULTI_EXPAND_KEY);
  const storedMultiExpand = parseBool01(storedMultiExpandRaw);

  const initialUrlQ = String(searchParams.get('q') || '').trim();
  const initialScope = parseScope(searchParams.get('scope')) || (storedScope === 'matched' || storedScope === 'all' ? storedScope : null) || 'matched';
  const initialQMode = parseQMode(searchParams.get('mode')) || parseQMode(storedQMode) || 'and';
  const initialQSyntax = parseQSyntax(searchParams.get('syntax')) || parseQSyntax(storedQSyntax) || 'smart';
  const initialStatsEnabled = parseBool01(searchParams.get('stats')) ?? storedStatsEnabled ?? (!isMobileByWindow);
  const initialViewMode = parseViewMode(searchParams.get('view')) || parseViewMode(storedViewMode) || (isMobileByWindow ? 'read' : 'list');
  const initialMultiExpand = parseBool01(searchParams.get('multi')) ?? storedMultiExpand ?? false;
  const initialPageSizeRaw = parsePositiveInt(searchParams.get('pageSize')) || storedPageSize;
  const initialPageSize = PAGE_SIZE_OPTIONS.includes(initialPageSizeRaw) ? initialPageSizeRaw : 50;
  const initialPage = Math.max(1, parsePositiveInt(searchParams.get('page')) || 1);

  const initialAccountId = parsePositiveInt(searchParams.get('accountId') || searchParams.get('account_id'));
  const initialUserId = parsePositiveInt(searchParams.get('userId') || searchParams.get('user_id'));
  const initialDateFrom = parseDateYmd(searchParams.get('from') || searchParams.get('date_from'));
  const initialDateTo = parseDateYmd(searchParams.get('to') || searchParams.get('date_to'));
  const initialBookmarked = parseBool01(searchParams.get('bookmarked'));
  const initialHasMsg = parseBool01(searchParams.get('hasMsg') || searchParams.get('has_msg'));

  const initialOrderBy = parseOrderBy(searchParams.get('orderBy')) || 'ts';
  const initialOrder = parseOrder(searchParams.get('order')) || 'desc';

  const [accounts, setAccounts] = useState([]);
  const [userById, setUserById] = useState({});
  const [initDone, setInitDone] = useState(false);
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false);

  const [qInput, setQInput] = useState(initialUrlQ);
  const [q, setQ] = useState(initialUrlQ);
  const [qMode, setQMode] = useState(initialQMode);
  const [qSyntax, setQSyntax] = useState(initialQSyntax);
  const [statsEnabled, setStatsEnabled] = useState(initialStatsEnabled);
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [multiExpand, setMultiExpand] = useState(initialMultiExpand);

  const [scope, setScope] = useState(initialScope);
  const [accountValue, setAccountValue] = useState(initialAccountId ?? ALL);
  const [userValue, setUserValue] = useState(initialUserId ?? ALL);
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? '');
  const [dateTo, setDateTo] = useState(initialDateTo ?? '');

  const [orderBy, setOrderBy] = useState(initialOrderBy);
  const [order, setOrder] = useState(initialOrder);

  const [bookmarked, setBookmarked] = useState(initialBookmarked);

  const [hasMsg, setHasMsg] = useState(initialHasMsg);

  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [diaries, setDiaries] = useState([]);
  const [lastTookMs, setLastTookMs] = useState(null);
  const [lastNormalized, setLastNormalized] = useState(null);
  const [expandedIds, setExpandedIds] = useState([]);
  const [detailById, setDetailById] = useState({});
  const [detailLoadingById, setDetailLoadingById] = useState({});
  const [detailErrorById, setDetailErrorById] = useState({});
  const [failedImageByDiaryId, setFailedImageByDiaryId] = useState({});
  const [bookmarkLoadingById, setBookmarkLoadingById] = useState({});
  const [batchCancelLoading, setBatchCancelLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const loadSeqRef = useRef(0);

  const fromPath = useMemo(
    () => `${location.pathname || '/'}${location.search || ''}`,
    [location.pathname, location.search],
  );

  useEffect(() => {
    const key = `yournote.scroll.${fromPath}`;
    let raw = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) return;

    const y = Number.parseInt(raw, 10);
    if (!Number.isFinite(y) || y < 0) return;

    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }

    const timer = setTimeout(() => {
      try {
        window.scrollTo({ top: y, behavior: 'auto' });
      } catch {
        window.scrollTo(0, y);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [fromPath]);

  const openDiaryDetail = useCallback((diaryId) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;

    try {
      sessionStorage.setItem(`yournote.scroll.${fromPath}`, String(window.scrollY || 0));
    } catch {
      // ignore
    }

    navigate(`/diary/${idNum}`, { state: { from: fromPath } });
  }, [navigate, fromPath]);

  const syncUrl = useCallback((next, { replace = false } = {}) => {
    const p = new URLSearchParams();

    const qText = String(next.q || '').trim();
    if (qText) p.set('q', qText);

    p.set('scope', next.scope || 'matched');

    const mode = parseQMode(next.qMode) || qMode || 'and';
    const syntax = parseQSyntax(next.qSyntax) || qSyntax || 'smart';
    const stats = (typeof next.statsEnabled === 'boolean') ? next.statsEnabled : Boolean(statsEnabled);
    const view = parseViewMode(next.viewMode) || viewMode || (isMobile ? 'read' : 'list');
    const multi = (typeof next.multiExpand === 'boolean') ? next.multiExpand : Boolean(multiExpand);
    p.set('mode', mode);
    p.set('syntax', syntax);
    p.set('stats', stats ? '1' : '0');
    p.set('view', view);
    p.set('multi', multi ? '1' : '0');

    if (typeof next.accountId === 'number' && next.accountId > 0) p.set('accountId', String(next.accountId));
    if (typeof next.userId === 'number' && next.userId > 0) p.set('userId', String(next.userId));

    if (next.dateFrom) p.set('from', next.dateFrom);
    if (next.dateTo) p.set('to', next.dateTo);

    const hasBookmarked = Object.prototype.hasOwnProperty.call(next || {}, 'bookmarked');
    const nextBookmarked = hasBookmarked ? next.bookmarked : bookmarked;
    if (typeof nextBookmarked === 'boolean') p.set('bookmarked', nextBookmarked ? '1' : '0');

    const hasHasMsg = Object.prototype.hasOwnProperty.call(next || {}, 'hasMsg');
    const nextHasMsg = hasHasMsg ? next.hasMsg : hasMsg;
    if (typeof nextHasMsg === 'boolean') p.set('hasMsg', nextHasMsg ? '1' : '0');

    p.set('page', String(Math.max(1, next.page || 1)));
    p.set('pageSize', String(next.pageSize || 50));
    p.set('orderBy', next.orderBy || 'ts');
    p.set('order', next.order || 'desc');

    setSearchParams(p, { replace });
  }, [setSearchParams, qMode, qSyntax, statsEnabled, viewMode, multiExpand, isMobile, bookmarked, hasMsg]);

  useEffect(() => {
    if (!isBookmarksRoute) {
      bookmarksDefaultsInjectedRef.current = false;
      return;
    }
    if (bookmarksDefaultsInjectedRef.current) return;
    bookmarksDefaultsInjectedRef.current = true;

    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (!next.has('bookmarked')) {
      next.set('bookmarked', '1');
      changed = true;
    }
    if (!next.has('orderBy')) {
      next.set('orderBy', 'bookmarked_at');
      changed = true;
    }
    if (!next.has('order')) {
      next.set('order', 'desc');
      changed = true;
    }
    if (!next.has('page')) {
      next.set('page', '1');
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [isBookmarksRoute, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isMessagesRoute) {
      messagesDefaultsInjectedRef.current = false;
      return;
    }
    if (messagesDefaultsInjectedRef.current) return;
    messagesDefaultsInjectedRef.current = true;

    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (!next.has('hasMsg') && !next.has('has_msg')) {
      next.set('hasMsg', '1');
      changed = true;
    }
    if (!next.has('orderBy')) {
      next.set('orderBy', 'created_at');
      changed = true;
    }
    if (!next.has('order')) {
      next.set('order', 'desc');
      changed = true;
    }
    if (!next.has('scope')) {
      next.set('scope', 'all');
      changed = true;
    }
    if (!next.has('page')) {
      next.set('page', '1');
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [isMessagesRoute, searchParams, setSearchParams]);

  const currentAccountId = useMemo(() => (accountValue === ALL ? null : parsePositiveInt(accountValue)), [accountValue]);
  const currentUserId = useMemo(() => (userValue === ALL ? null : parsePositiveInt(userValue)), [userValue]);
  const currentDateFrom = useMemo(() => parseDateYmd(dateFrom), [dateFrom]);
  const currentDateTo = useMemo(() => parseDateYmd(dateTo), [dateTo]);

  const loadInit = useCallback(async () => {
    try {
      const [accountsRes, usersRes] = await Promise.allSettled([accountAPI.list(), userAPI.list(5000)]);
      if (accountsRes.status !== 'fulfilled') throw accountsRes.reason;

      const accountList = accountsRes.value.data || [];
      setAccounts(accountList);

      const byId = {};
      if (usersRes.status === 'fulfilled') {
        (usersRes.value.data || []).forEach((u) => {
          if (!u?.id) return;
          byId[u.id] = u;
        });
      } else {
        message.warning('用户信息加载失败：作者将以“用户 ID”展示（可稍后刷新重试）');
      }
      setUserById(byId);
    } catch (error) {
      message.error('初始化失败：' + getErrorMessage(error));
    } finally {
      setInitDone(true);
    }
  }, []);

  const loadDiaries = useCallback(async () => {
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;

    setLoading(true);
    try {
      const res = await diaryAPI.query({
        q: q || undefined,
        q_mode: qMode,
        q_syntax: qSyntax,
        scope,
        account_id: currentAccountId || undefined,
        user_id: currentUserId || undefined,
        date_from: currentDateFrom || undefined,
        date_to: currentDateTo || undefined,
        bookmarked: (typeof bookmarked === 'boolean') ? (bookmarked ? 1 : 0) : undefined,
        has_msg: (typeof hasMsg === 'boolean') ? (hasMsg ? 1 : 0) : undefined,
        include_stats: Boolean(statsEnabled),
        include_preview: true,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order_by: orderBy,
        order,
        preview_len: isMobile ? 80 : 120,
      });

      if (loadSeqRef.current !== seq) return;

      const data = res?.data || {};
      const items = Array.isArray(data?.items) ? data.items : [];
      const countNum = Number(data?.count);
      const tookMsNum = Number(data?.took_ms);
      setDiaries(items);
      setTotal(Number.isFinite(countNum) ? countNum : items.length);
      setLastTookMs(Number.isFinite(tookMsNum) ? tookMsNum : null);
      setLastNormalized(data?.normalized || null);
    } catch (error) {
      if (loadSeqRef.current !== seq) return;
      setDiaries([]);
      setTotal(0);
      setLastTookMs(null);
      setLastNormalized(null);
      message.error('加载记录失败：' + getErrorMessage(error));
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [q, qMode, qSyntax, statsEnabled, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, bookmarked, hasMsg, page, pageSize, orderBy, order, isMobile]);

  useEffect(() => {
    loadInit();
  }, [loadInit]);

  useEffect(() => {
    loadDiaries();
  }, [loadDiaries]);

  // 阅读模式：当查询条件/分页变化时，清空上一批结果的展开项，避免“展开状态错位”。
  const expandedResetKey = useMemo(() => JSON.stringify([
    q,
    qMode,
    qSyntax,
    scope,
    currentAccountId,
    currentUserId,
    currentDateFrom,
    currentDateTo,
    bookmarked,
    hasMsg,
    orderBy,
    order,
    page,
    pageSize,
  ]), [q, qMode, qSyntax, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, bookmarked, hasMsg, orderBy, order, page, pageSize]);
  useEffect(() => {
    void expandedResetKey;
    setExpandedIds([]);
  }, [expandedResetKey]);

  useEffect(() => {
    if (viewMode !== 'read') setExpandedIds([]);
  }, [viewMode]);

  // 让用户偏好“记住上次选择”：即使是通过分享链接打开，也会更新到本地偏好。
  useEffect(() => {
    if (scope === 'matched' || scope === 'all') writeStringStorage(DIARY_LIST_SCOPE_KEY, scope);
  }, [scope]);

  useEffect(() => {
    if (PAGE_SIZE_OPTIONS.includes(pageSize)) writeIntStorage(DIARY_LIST_PAGE_SIZE_KEY, pageSize);
  }, [pageSize]);

  useEffect(() => {
    if (qMode === 'and' || qMode === 'or') writeStringStorage(DIARY_LIST_Q_MODE_KEY, qMode);
  }, [qMode]);

  useEffect(() => {
    if (qSyntax === 'smart' || qSyntax === 'plain') writeStringStorage(DIARY_LIST_Q_SYNTAX_KEY, qSyntax);
  }, [qSyntax]);

  useEffect(() => {
    writeStringStorage(DIARY_LIST_STATS_ENABLED_KEY, statsEnabled ? '1' : '0');
  }, [statsEnabled]);

  useEffect(() => {
    if (viewMode === 'list' || viewMode === 'read') writeStringStorage(DIARY_LIST_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    writeStringStorage(DIARY_LIST_MULTI_EXPAND_KEY, multiExpand ? '1' : '0');
  }, [multiExpand]);

  // 支持浏览器前进/后退：URL 改变时同步状态
  useEffect(() => {
    const urlQ = String(searchParams.get('q') || '').trim();
    const urlScope = parseScope(searchParams.get('scope')) || 'matched';
    const urlMode = parseQMode(searchParams.get('mode'));
    const urlSyntax = parseQSyntax(searchParams.get('syntax'));
    const urlStats = parseBool01(searchParams.get('stats'));
    const urlView = parseViewMode(searchParams.get('view'));
    const urlMulti = parseBool01(searchParams.get('multi'));
    const urlPageSizeRaw = parsePositiveInt(searchParams.get('pageSize')) || 50;
    const urlPageSize = PAGE_SIZE_OPTIONS.includes(urlPageSizeRaw) ? urlPageSizeRaw : 50;
    const urlPage = Math.max(1, parsePositiveInt(searchParams.get('page')) || 1);
    const urlAccountId = parsePositiveInt(searchParams.get('accountId') || searchParams.get('account_id'));
    const urlUserId = parsePositiveInt(searchParams.get('userId') || searchParams.get('user_id'));
    const urlFrom = parseDateYmd(searchParams.get('from') || searchParams.get('date_from')) || '';
    const urlTo = parseDateYmd(searchParams.get('to') || searchParams.get('date_to')) || '';
    const urlBookmarked = parseBool01(searchParams.get('bookmarked'));
    const urlHasMsg = parseBool01(searchParams.get('hasMsg') || searchParams.get('has_msg'));
    const urlOrderBy = parseOrderBy(searchParams.get('orderBy')) || 'ts';
    const urlOrder = parseOrder(searchParams.get('order')) || 'desc';

    setQInput((prev) => (prev !== urlQ ? urlQ : prev));
    setQ((prev) => (prev !== urlQ ? urlQ : prev));
    setScope((prev) => (prev !== urlScope ? urlScope : prev));
    if (urlMode) setQMode((prev) => (prev !== urlMode ? urlMode : prev));
    if (urlSyntax) setQSyntax((prev) => (prev !== urlSyntax ? urlSyntax : prev));
    if (typeof urlStats === 'boolean') setStatsEnabled((prev) => (prev !== urlStats ? urlStats : prev));
    if (urlView) setViewMode((prev) => (prev !== urlView ? urlView : prev));
    if (typeof urlMulti === 'boolean') setMultiExpand((prev) => (prev !== urlMulti ? urlMulti : prev));
    setPageSize((prev) => (prev !== urlPageSize ? urlPageSize : prev));
    setPage((prev) => (prev !== urlPage ? urlPage : prev));
    setAccountValue((prev) => {
      const prevId = prev === ALL ? null : parsePositiveInt(prev);
      if (prevId === urlAccountId) return prev;
      return urlAccountId ?? ALL;
    });
    setUserValue((prev) => {
      const prevId = prev === ALL ? null : parsePositiveInt(prev);
      if (prevId === urlUserId) return prev;
      return urlUserId ?? ALL;
    });
    setDateFrom((prev) => (prev !== urlFrom ? urlFrom : prev));
    setDateTo((prev) => (prev !== urlTo ? urlTo : prev));
    setBookmarked((prev) => (prev !== urlBookmarked ? urlBookmarked : prev));
    setHasMsg((prev) => (prev !== urlHasMsg ? urlHasMsg : prev));
    setOrderBy((prev) => (prev !== urlOrderBy ? urlOrderBy : prev));
    setOrder((prev) => (prev !== urlOrder ? urlOrder : prev));
  }, [searchParams]);

  // 若 URL 指定了不存在的账号，自动回退为“全部账号”，避免用户误以为“没有记录”。
  useEffect(() => {
    if (!accounts.length) return;
    if (accountValue === ALL) return;
    const accountId = parsePositiveInt(accountValue);
    if (!accountId) {
      setAccountValue(ALL);
      return;
    }
    const exists = accounts.some(a => a?.id === accountId);
    if (!exists) {
      message.warning(`账号 ${accountId} 不存在或已删除，已回退为“全部账号”`);
      setAccountValue(ALL);
      syncUrl({
        q,
        scope,
        accountId: null,
        userId: currentUserId,
        dateFrom: currentDateFrom,
        dateTo: currentDateTo,
        page: 1,
        pageSize,
        orderBy,
        order,
      }, { replace: true });
      setPage(1);
    }
  }, [accounts, accountValue, syncUrl, q, scope, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order]);

  const accountOptions = useMemo(() => {
    const items = (accounts || [])
      .filter(a => a?.id)
      .map((a) => {
        const label = a?.nideriji_userid ? `账号 ${a.nideriji_userid}` : `账号 ${a.id}`;
        return { label, value: a.id };
      });

    return [
      { label: '全部账号', value: ALL },
      ...items,
    ];
  }, [accounts]);

  const userOptions = useMemo(() => {
    const list = Object.values(userById || {});
    const items = list
      .filter(u => u?.id)
      .sort((a, b) => (a?.id || 0) - (b?.id || 0))
      .map((u) => {
        const name = u?.name || `用户 ${u.id}`;
        const label = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
        return { label, value: u.id };
      });

    return [
      { label: '全部作者', value: ALL },
      ...items,
    ];
  }, [userById]);

  const sortValue = `${orderBy}_${order}`;
  const sortOptions = useMemo(() => ([
    { label: '最近更新', value: 'ts_desc' },
    { label: '记录日期', value: 'created_date_desc' },
    { label: '入库时间', value: 'created_at_desc' },
    { label: '收藏时间', value: 'bookmarked_at_desc' },
    { label: '留言数（多->少）', value: 'msg_count_desc' },
    { label: '留言数（少->多）', value: 'msg_count_asc' },
  ]), []);

  const bookmarkedValue = (typeof bookmarked === 'boolean') ? (bookmarked ? '1' : '0') : ALL;
  const bookmarkedOptions = useMemo(() => ([
    { label: '全部', value: ALL },
    { label: '仅书签', value: '1' },
    { label: '仅未书签', value: '0' },
  ]), []);

  const hasMsgValue = (typeof hasMsg === 'boolean') ? (hasMsg ? '1' : '0') : ALL;
  const hasMsgOptions = useMemo(() => ([
    { label: '全部', value: ALL },
    { label: '仅有留言', value: '1' },
    { label: '仅无留言', value: '0' },
  ]), []);

  const clearSelection = useCallback(() => {
    setSelectedRowKeys([]);
    setSelectedRows([]);
  }, []);

  const handleApplySearch = useCallback(() => {
    const nextQ = qInput.trim();
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleClearSearch = useCallback(() => {
    if (!qInput && !q) return;
    setQInput('');
    setQ('');
    setPage(1);
    syncUrl({
      q: '',
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, q, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleQModeChange = useCallback((value) => {
    const nextMode = parseQMode(value);
    if (!nextMode) return;
    const nextQ = qInput.trim();
    setQMode(nextMode);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      qMode: nextMode,
      qSyntax,
      statsEnabled,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, qSyntax, statsEnabled, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleQSyntaxChange = useCallback((value) => {
    const nextSyntax = parseQSyntax(value);
    if (!nextSyntax) return;
    const nextQ = qInput.trim();
    setQSyntax(nextSyntax);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      qMode,
      qSyntax: nextSyntax,
      statsEnabled,
      viewMode,
      multiExpand,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, qMode, statsEnabled, viewMode, multiExpand, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleViewModeChange = useCallback((value) => {
    const nextView = parseViewMode(value);
    if (!nextView) return;
    setViewMode(nextView);
    setExpandedIds([]);
    syncUrl({
      q,
      qMode,
      qSyntax,
      statsEnabled,
      viewMode: nextView,
      multiExpand,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [q, qMode, qSyntax, statsEnabled, multiExpand, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, page, pageSize, orderBy, order, syncUrl]);

  const handleMultiExpandChange = useCallback((checked) => {
    const nextMulti = Boolean(checked);
    setMultiExpand(nextMulti);
    setExpandedIds((prev) => {
      if (nextMulti) return prev;
      // 切回“仅展开一条”时，保留第一条展开项，避免页面一下子撑得过长
      return Array.isArray(prev) && prev.length > 0 ? [prev[0]] : [];
    });
    syncUrl({
      q,
      qMode,
      qSyntax,
      statsEnabled,
      viewMode,
      multiExpand: nextMulti,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [q, qMode, qSyntax, statsEnabled, viewMode, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, page, pageSize, orderBy, order, syncUrl]);

  const handleStatsEnabledChange = useCallback((checked) => {
    const nextStats = Boolean(checked);
    setStatsEnabled(nextStats);
    syncUrl({
      q,
      qMode,
      qSyntax,
      statsEnabled: nextStats,
      viewMode,
      multiExpand,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [q, qMode, qSyntax, viewMode, multiExpand, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, page, pageSize, orderBy, order, syncUrl]);

  // 快捷键：
  // - `/`：聚焦搜索框（不在输入框内时）
  // - `Esc`：清空搜索并重新查询（保留其他筛选条件）
  useEffect(() => {
    const isTypingTarget = (target) => {
      const el = target;
      if (!el) return false;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e) => {
      if (!e) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `/`：快速聚焦搜索框
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchInputRef.current?.focus?.();
        return;
      }

      // `Esc`：清空搜索（如果当前有搜索条件）
      if (e.key === 'Escape') {
        if (!qInput && !q) return;
        // 如果用户在别的输入框里按 Esc，通常期望关闭弹层/下拉；这里尽量不抢。
        if (isTypingTarget(e.target) && e.target !== searchInputRef.current?.input) return;
        e.preventDefault();
        handleClearSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [qInput, q, handleClearSearch]);

  const handleScopeChange = useCallback((value) => {
    const nextScope = parseScope(value);
    if (!nextScope) return;
    const nextQ = qInput.trim();
    setScope(nextScope);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope: nextScope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleAccountChange = useCallback((value) => {
    const nextValue = value ?? ALL;
    const nextAccountId = nextValue === ALL ? null : parsePositiveInt(nextValue);
    const nextQ = qInput.trim();
    setAccountValue(nextValue);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope,
      accountId: nextAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentUserId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleUserChange = useCallback((value) => {
    const nextValue = value ?? ALL;
    const nextUserId = nextValue === ALL ? null : parsePositiveInt(nextValue);
    const nextQ = qInput.trim();
    setUserValue(nextValue);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: nextUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentDateFrom, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleDateFromChange = useCallback((e) => {
    const nextFrom = String(e?.target?.value || '').trim();
    const nextQ = qInput.trim();
    setDateFrom(nextFrom);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: parseDateYmd(nextFrom),
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateTo, pageSize, orderBy, order, syncUrl]);

  const handleDateToChange = useCallback((e) => {
    const nextTo = String(e?.target?.value || '').trim();
    const nextQ = qInput.trim();
    setDateTo(nextTo);
    setQ(nextQ);
    setPage(1);
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: parseDateYmd(nextTo),
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, pageSize, orderBy, order, syncUrl]);

  const handleSortChange = useCallback((value) => {
    const parsed = parseSortValue(value);
    const nextOrderBy = parsed.orderBy;
    const nextOrder = parsed.order;
    const nextQ = qInput.trim();
    setOrderBy(nextOrderBy);
    setOrder(nextOrder);
    setQ(nextQ);
    setPage(1);
    clearSelection();
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: 1,
      pageSize,
      orderBy: nextOrderBy,
      order: nextOrder,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, syncUrl, clearSelection]);

  const handleBookmarkedChange = useCallback((value) => {
    const v = String(value ?? '').trim();
    const nextBookmarked = (v === '1') ? true : (v === '0') ? false : null;
    const nextQ = qInput.trim();
    setBookmarked(nextBookmarked);
    setQ(nextQ);
    setPage(1);
    clearSelection();
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      bookmarked: nextBookmarked,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, orderBy, order, pageSize, syncUrl, clearSelection]);

  const handleHasMsgChange = useCallback((value) => {
    const v = String(value ?? '').trim();
    const nextHasMsg = (v === '1') ? true : (v === '0') ? false : null;
    const nextQ = qInput.trim();
    setHasMsg(nextHasMsg);
    setQ(nextQ);
    setPage(1);
    clearSelection();
    syncUrl({
      q: nextQ,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      bookmarked,
      hasMsg: nextHasMsg,
      page: 1,
      pageSize,
      orderBy,
      order,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, bookmarked, orderBy, order, pageSize, syncUrl, clearSelection]);

  const handleReset = useCallback(() => {
    const nextScope = isMessagesRoute
      ? 'all'
      : (readStringStorage(DIARY_LIST_SCOPE_KEY) === 'all') ? 'all' : 'matched';
    const nextBookmarked = isBookmarksRoute ? true : null;
    const nextHasMsg = isMessagesRoute ? true : null;
    const nextOrderBy = isBookmarksRoute ? 'bookmarked_at' : isMessagesRoute ? 'msg_count' : 'ts';
    setQInput('');
    setQ('');
    setScope(nextScope);
    setAccountValue(ALL);
    setUserValue(ALL);
    setDateFrom('');
    setDateTo('');
    setBookmarked(nextBookmarked);
    setHasMsg(nextHasMsg);
    setOrderBy(nextOrderBy);
    setOrder('desc');
    setPage(1);
    clearSelection();
    syncUrl({
      q: '',
      scope: nextScope,
      accountId: null,
      userId: null,
      dateFrom: null,
      dateTo: null,
      bookmarked: nextBookmarked,
      hasMsg: nextHasMsg,
      page: 1,
      pageSize,
      orderBy: nextOrderBy,
      order: 'desc',
    }, { replace: false });
  }, [pageSize, syncUrl, isBookmarksRoute, isMessagesRoute, clearSelection]);

  const handlePaginationChange = useCallback((nextPage, nextPageSize) => {
    const ps = PAGE_SIZE_OPTIONS.includes(nextPageSize) ? nextPageSize : pageSize;
    const sizeChanged = ps !== pageSize;
    const finalPage = sizeChanged ? 1 : Math.max(1, nextPage || 1);

    if (sizeChanged) setPageSize(ps);
    setPage(finalPage);
    clearSelection();

    syncUrl({
      q,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      bookmarked,
      page: finalPage,
      pageSize: ps,
      orderBy,
      order,
    }, { replace: false });
  }, [pageSize, q, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, bookmarked, orderBy, order, syncUrl, clearSelection]);

  const handleToggleBookmark = useCallback(async (diaryId, nextBookmarked) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    if (typeof nextBookmarked !== 'boolean') return;
    if (bookmarkLoadingById?.[idNum]) return;

    setBookmarkLoadingById((prev) => ({ ...(prev || {}), [idNum]: true }));
    try {
      await diaryAPI.setBookmark(idNum, nextBookmarked);
      message.success(nextBookmarked ? '已加入书签' : '已取消书签');
      await loadDiaries();
    } catch (error) {
      message.error('设置书签失败：' + getErrorMessage(error));
    } finally {
      setBookmarkLoadingById((prev) => ({ ...(prev || {}), [idNum]: false }));
    }
  }, [bookmarkLoadingById, loadDiaries]);

  const handleBatchCancelBookmarks = useCallback(async () => {
    const ids = (selectedRowKeys || [])
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return;

    setBatchCancelLoading(true);
    try {
      await diaryAPI.setBookmarksBatch(ids, false);
      message.success('已批量取消书签');
      clearSelection();
      await loadDiaries();
    } catch (error) {
      message.error('批量取消书签失败：' + getErrorMessage(error));
    } finally {
      setBatchCancelLoading(false);
    }
  }, [selectedRowKeys, clearSelection, loadDiaries]);

  const handleExportMarkdown = useCallback(() => {
    const rows = Array.isArray(selectedRows) ? selectedRows : [];
    if (!rows.length) return;

    const lines = [];
    const title = isBookmarksRoute ? '书签' : isMessagesRoute ? '留言记录' : '记录列表';
    lines.push(`# ${title} 导出（${rows.length} 条）`);
    lines.push('');
    for (const r of rows) {
      const idNum = Number(r?.id);
      if (!Number.isFinite(idNum) || idNum <= 0) continue;
      const dateText = String(r?.created_date || '').trim() || '-';
      const titleText = String(r?.title || '无标题').replace(/\s+/g, ' ').trim();
      lines.push(`- ${dateText} ${titleText} (/diary/${idNum})`);
    }
    lines.push('');

    const base = isBookmarksRoute ? 'bookmarks' : isMessagesRoute ? 'messages' : 'diaries';
    const qPart = safeFilenamePart(q);
    const name = qPart ? `${base}-${formatExportTimestamp()}-${qPart}.md` : `${base}-${formatExportTimestamp()}.md`;
    downloadText(lines.join('\n'), name, 'text/markdown;charset=utf-8');
    message.success('已导出 Markdown');
  }, [selectedRows, isBookmarksRoute, isMessagesRoute, q]);

  const loadDiaryDetail = useCallback(async (diaryId) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;

    setDetailLoadingById((prev) => ({ ...(prev || {}), [idNum]: true }));
    setDetailErrorById((prev) => ({ ...(prev || {}), [idNum]: null }));
    try {
      const res = await diaryAPI.get(idNum);
      const data = res?.data || null;
      setDetailById((prev) => ({ ...(prev || {}), [idNum]: data }));
    } catch (error) {
      setDetailErrorById((prev) => ({ ...(prev || {}), [idNum]: getErrorMessage(error) }));
    } finally {
      setDetailLoadingById((prev) => ({ ...(prev || {}), [idNum]: false }));
    }
  }, []);

  const ensureDiaryDetailLoaded = useCallback((diaryId) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    if (detailById?.[idNum]) return;
    if (detailLoadingById?.[idNum]) return;
    loadDiaryDetail(idNum);
  }, [detailById, detailLoadingById, loadDiaryDetail]);

  const openDiaryForReading = useCallback((diaryId) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    ensureDiaryDetailLoaded(idNum);
    setExpandedIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.includes(idNum)) return list;
      if (multiExpand) return [...list, idNum];
      return [idNum];
    });
  }, [ensureDiaryDetailLoaded, multiExpand]);

  const toggleDiaryExpanded = useCallback((diaryId) => {
    const idNum = Number(diaryId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;

    const isOpen = expandedIds.includes(idNum);
    if (isOpen) {
      setExpandedIds((prev) => (Array.isArray(prev) ? prev.filter((x) => x !== idNum) : []));
      return;
    }

    openDiaryForReading(idNum);
  }, [expandedIds, openDiaryForReading]);

  const markImageFailed = useCallback((diaryId, imageId) => {
    const did = Number(diaryId);
    const iid = Number(imageId);
    if (!Number.isFinite(did) || did <= 0) return;
    if (!Number.isFinite(iid) || iid <= 0) return;
    setFailedImageByDiaryId((prev) => {
      const base = prev || {};
      const perDiary = base[did] || {};
      return {
        ...base,
        [did]: {
          ...perDiary,
          [iid]: true,
        },
      };
    });
  }, []);

  const renderDiaryContentWithImages = useCallback((diaryDetail) => {
    const diaryId = Number(diaryDetail?.id);
    const text = String(diaryDetail?.content ?? '');
    const images = Array.isArray(diaryDetail?.attachments?.images)
      ? diaryDetail.attachments.images.filter(Boolean)
      : [];

    const imageById = new Map();
    for (const img of images) {
      const idNum = Number(img?.image_id);
      if (Number.isFinite(idNum)) imageById.set(idNum, img);
    }

    const failedMap = failedImageByDiaryId?.[diaryId] || {};
    const re = /\[图(\d+)\]/g;
    const nodes = [];
    let lastIndex = 0;
    while (true) {
      const match = re.exec(text);
      if (!match) break;
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        nodes.push({ type: 'text', value: text.slice(lastIndex, start), key: `t-${lastIndex}` });
      }
      const imageId = Number(match[1]);
      nodes.push({ type: 'image', imageId, key: `img-${start}-${imageId}` });
      lastIndex = end;
    }
    if (lastIndex < text.length) {
      nodes.push({ type: 'text', value: text.slice(lastIndex), key: `t-${lastIndex}` });
    }

    return nodes.map((n) => {
      if (n.type === 'text') {
        return <span key={n.key}>{n.value}</span>;
      }

      const imageId = n.imageId;
      const imgInfo = imageById.get(imageId);
      const src = imgInfo?.url || `/api/diaries/${diaryId}/images/${imageId}`;

      if (failedMap?.[imageId]) {
        return (
          <div key={n.key} style={{ margin: '12px 0', padding: 12, borderRadius: 8, background: token.colorFillAlter, color: token.colorTextSecondary }}>
            图片 {imageId} 加载失败（可能无权限或已删除）
          </div>
        );
      }

      return (
        <div key={n.key} style={{ margin: '12px 0' }}>
          <Image
            src={src}
            alt={`图${imageId}`}
            style={{ maxWidth: '100%', borderRadius: 8 }}
            onError={() => markImageFailed(diaryId, imageId)}
          />
        </div>
      );
    });
  }, [failedImageByDiaryId, markImageFailed, token.colorFillAlter, token.colorTextSecondary]);

  const queryMeta = useMemo(() => {
    const n = lastNormalized;

    const normSyntax = parseQSyntax(n?.syntax) || qSyntax || 'smart';
    const toStrList = (v) => (Array.isArray(v) ? v : [])
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim());

    if (n && typeof n === 'object') {
      return {
        syntax: normSyntax,
        terms: toStrList(n?.terms),
        phrases: toStrList(n?.phrases),
        excludes: toStrList(n?.excludes),
      };
    }

    const rawQ = String(q || '').trim();
    if (!rawQ) return { syntax: normSyntax, terms: [], phrases: [], excludes: [] };

    if (normSyntax === 'plain') {
      return { syntax: normSyntax, terms: rawQ.split(/\s+/).filter(Boolean).slice(0, 10), phrases: [], excludes: [] };
    }

    const parsed = parseSmartQuery(rawQ, { maxPositive: 10, maxExcludes: 10 });
    return { syntax: normSyntax, ...parsed };
  }, [lastNormalized, q, qSyntax]);

  const highlightTokens = useMemo(() => {
    const excludes = new Set((queryMeta?.excludes || []).map((x) => String(x).toLowerCase()));
    const tokens = [...(queryMeta?.terms || []), ...(queryMeta?.phrases || [])]
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim())
      .filter((t) => !excludes.has(t.toLowerCase()));

    // 限制数量：避免生成过长正则，影响渲染
    return tokens.slice(0, 10);
  }, [queryMeta]);

  const highlightRegexSource = useMemo(() => {
    if (!highlightTokens.length) return null;
    const sorted = [...highlightTokens].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(escapeRegExp).filter(Boolean);
    if (!escaped.length) return null;
    return escaped.join('|');
  }, [highlightTokens]);

  const renderHighlighted = useCallback((value) => {
    const raw = String(value ?? '').toString();
    if (!raw) return '-';
    if (!highlightRegexSource) return raw;

    const regex = new RegExp(highlightRegexSource, 'gi');
    const out = [];
    let lastIndex = 0;
    while (true) {
      const m = regex.exec(raw);
      if (!m) break;
      const start = m.index;
      const end = start + String(m[0] || '').length;
      if (end <= start) {
        // 极端情况避免死循环
        regex.lastIndex += 1;
        continue;
      }
      if (start > lastIndex) out.push(raw.slice(lastIndex, start));
      out.push(
        <mark
          key={`${start}-${end}`}
          style={{
            backgroundColor: token.colorWarningBg,
            color: token.colorText,
            padding: '0 2px',
            borderRadius: 2,
          }}
        >
          {raw.slice(start, end)}
        </mark>,
      );
      lastIndex = end;
    }
    if (lastIndex < raw.length) out.push(raw.slice(lastIndex));
    return <>{out}</>;
  }, [highlightRegexSource, token.colorText, token.colorWarningBg]);

  const columns = useMemo(() => {
    const showAccount = currentAccountId == null;

    const cols = [
      { title: '日期', dataIndex: 'created_date', key: 'date', width: 120, render: (v) => v || '-' },
      {
        title: '书签',
        key: 'bookmark',
        width: 70,
        align: 'center',
        render: (_, record) => {
          const idNum = Number(record?.id);
          const isBookmarked = record?.bookmarked_at != null;
          const rowLoading = Number.isFinite(idNum) ? Boolean(bookmarkLoadingById?.[idNum]) : false;
          return (
            <Button
              size="small"
              type="text"
              shape="circle"
              icon={isBookmarked ? <StarFilled style={{ color: token.colorWarning }} /> : <StarOutlined />}
              loading={rowLoading}
              disabled={batchCancelLoading || !Number.isFinite(idNum) || idNum <= 0}
              onClick={(e) => {
                e?.stopPropagation?.();
                handleToggleBookmark(idNum, !isBookmarked);
              }}
              title={isBookmarked ? '取消书签' : '加入书签'}
            />
          );
        },
      },
      {
        title: '修改时间',
        dataIndex: 'ts',
      key: 'modified_time',
      width: 190,
      render: (ts) => {
        const text = formatBeijingDateTimeFromTs(ts);
        if (text === '-') return '-';
        return <Tag color="purple">{text}</Tag>;
      },
    },
      {
        title: '作者',
        dataIndex: 'user_id',
        key: 'author',
        width: 200,
        render: (uid) => {
          const u = userById?.[uid];
          const name = u?.name || (uid ? `用户 ${uid}` : '未知');
          const text = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
          return <Tag color="magenta">{text}</Tag>;
        },
      },
      ...(showAccount ? [
        {
          title: '账号',
          dataIndex: 'account_id',
          key: 'account_id',
          width: 90,
          render: (_, record) => {
            const text = getShownAccountIdText(record);
            return <Tag color="gold" title={`账号 ${text}`}>A{text}</Tag>;
          },
        },
      ] : []),
      {
        title: '标题',
        dataIndex: 'title',
        key: 'title',
        width: 240,
      render: (v) => renderHighlighted(v || '-'),
      onCell: (record) => ({
        onClick: () => openDiaryDetail(record?.id),
        style: { cursor: 'pointer' },
      }),
    },
    {
      title: '内容',
      dataIndex: 'content_preview',
      key: 'content',
      ellipsis: true,
      render: (v) => renderHighlighted(v || '-'),
      onCell: (record) => ({
        onClick: () => openDiaryDetail(record?.id),
        style: { cursor: 'pointer', color: token.colorPrimary },
      }),
    },
      {
        title: '字数',
        key: 'word_count',
        width: 110,
        align: 'right',
      render: (_, record) => {
        if (!statsEnabled) return '-';
        const serverCount = Number(record?.word_count_no_ws);
        if (Number.isFinite(serverCount)) return <Tag color="geekblue">{serverCount} 字</Tag>;
        const stats = getDiaryWordStats(record);
        const n = stats?.content?.no_whitespace ?? 0;
        return <Tag color="geekblue">{n} 字</Tag>;
        },
      },
      {
        title: '留言',
        key: 'msg_count',
        width: 110,
        align: 'right',
        render: (_, record) => <Tag color="volcano">留言 {getShownMsgCount(record)}</Tag>,
      },
      { title: '心情', dataIndex: 'mood', key: 'mood', width: 90, render: (m) => (m ? <Tag>{m}</Tag> : '-') },
      { title: '天气', dataIndex: 'weather', key: 'weather', width: 90, render: (w) => (w ? <Tag color="blue">{w}</Tag> : '-') },
    ];

    return cols;
  }, [userById, token, renderHighlighted, statsEnabled, currentAccountId, bookmarkLoadingById, handleToggleBookmark, batchCancelLoading, openDiaryDetail]);

  const noAccounts = initDone && (accounts?.length || 0) === 0;

  const scopeTag = scope === 'all'
    ? <Tag color="blue">范围：全部记录</Tag>
    : <Tag color="magenta">范围：仅配对用户记录</Tag>;

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        {isBookmarksRoute ? '书签' : isMessagesRoute ? '留言记录' : '记录列表'}
      </Title>

      <div style={{ position: 'sticky', top: 'var(--app-header-height)', zIndex: 50 }}>
        <Card style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {noAccounts && (
              <Alert
                type="warning"
                showIcon
                message="暂无账号"
                description={(
                  <Space wrap>
                    <Text type="secondary">请先去“账号管理”添加账号并等待同步完成。</Text>
                    <Button size="small" type="primary" onClick={() => navigate('/accounts')}>
                      去账号管理
                    </Button>
                  </Space>
                )}
              />
            )}

            {isMobile ? (
              <>
                <Input.Search
                  allowClear
                  ref={searchInputRef}
                  value={qInput}
                  placeholder="搜索标题/内容（空格多关键词，默认 AND）"
                  onChange={(e) => setQInput(e.target.value)}
                  onSearch={handleApplySearch}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleClearSearch();
                  }}
                  enterButton={<><SearchOutlined /> 搜索</>}
                  style={{ width: '100%' }}
                />

                <Space wrap style={{ width: '100%' }}>
                  <Segmented
                    value={qMode}
                    options={[
                      { label: '全部命中', value: 'and' },
                      { label: '任意命中', value: 'or' },
                    ]}
                    onChange={handleQModeChange}
                    disabled={loading}
                    style={{ width: '100%' }}
                  />
                  <Select
                    value={qSyntax}
                    onChange={handleQSyntaxChange}
                    disabled={loading}
                    style={{ width: '100%' }}
                    options={[
                      { label: '智能语法', value: 'smart' },
                      { label: '纯文本', value: 'plain' },
                    ]}
                  />
                </Space>

                <Space wrap style={{ width: '100%' }}>
                  <Button
                    icon={<FilterOutlined />}
                    onClick={() => setFiltersDrawerOpen(true)}
                    disabled={loading}
                    block
                  >
                    筛选
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={loadDiaries} disabled={loading} block>
                    刷新
                  </Button>
                  <Button
                    onClick={() => {
                      handleReset();
                      setFiltersDrawerOpen(false);
                    }}
                    disabled={loading}
                    block
                  >
                    重置条件
                  </Button>
                </Space>

                <Text type="secondary">
                  {qSyntax === 'plain'
                    ? '纯文本模式：不解析引号短语与 -排除；快捷键：按 / 聚焦搜索框，Esc 清空搜索。'
                    : '提示：支持 "短语" 搜索、-关键词 排除；快捷键：按 / 聚焦搜索框，Esc 清空搜索。'}
                </Text>

                <Space wrap>
                  {scopeTag}
                  <Tag color="geekblue">共 {Number(total) || 0} 条</Tag>
                  {typeof lastTookMs === 'number' && <Tag color="geekblue">耗时 {lastTookMs} ms</Tag>}
                </Space>
              </>
            ) : (
              <>
                <Space wrap style={{ width: '100%' }}>
                  <Input.Search
                    allowClear
                    ref={searchInputRef}
                    value={qInput}
                    placeholder="搜索标题/内容（空格多关键词，默认 AND）"
                    onChange={(e) => setQInput(e.target.value)}
                    onSearch={handleApplySearch}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') handleClearSearch();
                    }}
                    enterButton={<><SearchOutlined /> 搜索</>}
                    style={{ flex: 1, minWidth: 420 }}
                  />
                  <Segmented
                    value={qMode}
                    options={[
                      { label: '全部命中', value: 'and' },
                      { label: '任意命中', value: 'or' },
                    ]}
                    onChange={handleQModeChange}
                    disabled={loading}
                    style={{ minWidth: 200 }}
                  />
                  <Select
                    value={qSyntax}
                    onChange={handleQSyntaxChange}
                    disabled={loading}
                    style={{ width: 140 }}
                    options={[
                      { label: '智能语法', value: 'smart' },
                      { label: '纯文本', value: 'plain' },
                    ]}
                  />
                  <Button icon={<ReloadOutlined />} onClick={loadDiaries} disabled={loading}>
                    刷新
                  </Button>
                  <Button onClick={handleReset} disabled={loading}>
                    重置条件
                  </Button>
                </Space>

                <Text type="secondary">
                  {qSyntax === 'plain'
                    ? '纯文本模式：不解析引号短语与 -排除；快捷键：按 / 聚焦搜索框，Esc 清空搜索。'
                    : '提示：支持 "短语" 搜索、-关键词 排除；快捷键：按 / 聚焦搜索框，Esc 清空搜索。'}
                </Text>

                <Space wrap direction="horizontal" style={{ width: '100%' }}>
                  <Space wrap>
                    <Text type="secondary">范围</Text>
                    <Segmented
                      value={scope}
                      options={[
                        { label: '仅配对用户', value: 'matched' },
                        { label: '全部记录', value: 'all' },
                      ]}
                      onChange={handleScopeChange}
                    />
                  </Space>

                  <Space wrap>
                    <Text type="secondary">视图</Text>
                    <Segmented
                      value={viewMode}
                      options={[
                        { label: '列表', value: 'list' },
                        { label: '阅读', value: 'read' },
                      ]}
                      onChange={handleViewModeChange}
                      disabled={loading}
                    />
                    <Space size={6}>
                      <Text type="secondary">字数</Text>
                      <Switch checked={statsEnabled} onChange={handleStatsEnabledChange} disabled={loading} />
                    </Space>
                    {viewMode === 'read' && (
                      <Space size={6}>
                        <Text type="secondary">多条展开</Text>
                        <Switch checked={multiExpand} onChange={handleMultiExpandChange} disabled={loading} />
                      </Space>
                    )}
                  </Space>

                  <Space wrap>
                    <Text type="secondary">账号</Text>
                    <Select
                      style={{ width: 220 }}
                      value={accountValue}
                      onChange={handleAccountChange}
                      options={accountOptions}
                    />
                  </Space>

                  <Space wrap>
                    <Text type="secondary">作者</Text>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      style={{ width: 240 }}
                      value={userValue}
                      onChange={handleUserChange}
                      options={userOptions}
                    />
                  </Space>
                </Space>

                  <Space wrap direction="horizontal" style={{ width: '100%' }}>
                    <Space wrap>
                      <Text type="secondary">日期</Text>
                      <Input type="date" value={dateFrom} onChange={handleDateFromChange} style={{ width: 160 }} />
                      <Text type="secondary">到</Text>
                      <Input type="date" value={dateTo} onChange={handleDateToChange} style={{ width: 160 }} />
                    </Space>

                     <Space wrap>
                       <Text type="secondary">书签</Text>
                       <Select
                         style={{ width: 140 }}
                         value={bookmarkedValue}
                         onChange={handleBookmarkedChange}
                         options={bookmarkedOptions}
                         disabled={loading}
                       />
                     </Space>

                     <Space wrap>
                       <Text type="secondary">留言</Text>
                       <Select
                         style={{ width: 140 }}
                         value={hasMsgValue}
                         onChange={handleHasMsgChange}
                         options={hasMsgOptions}
                         disabled={loading}
                       />
                     </Space>

                     <Space wrap style={{ marginLeft: 'auto' }}>
                       <Text type="secondary">排序</Text>
                     <Select
                       style={{ width: 160 }}
                       value={sortValue}
                       onChange={handleSortChange}
                       options={sortOptions}
                     />
                    {scopeTag}
                    <Tag color="geekblue">共 {Number(total) || 0} 条</Tag>
                    {typeof lastTookMs === 'number' && <Tag color="geekblue">耗时 {lastTookMs} ms</Tag>}
                  </Space>
                </Space>
              </>
            )}
          </Space>
        </Card>
      </div>

      {isMobile && (
        <Drawer
          title="筛选条件"
          placement="bottom"
          open={filtersDrawerOpen}
          onClose={() => setFiltersDrawerOpen(false)}
          height="78%"
          styles={{ body: { paddingBottom: 24 } }}
        >
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Space wrap>
              <Text type="secondary">范围</Text>
              <Segmented
                value={scope}
                options={[
                  { label: '仅配对用户', value: 'matched' },
                  { label: '全部记录', value: 'all' },
                ]}
                onChange={handleScopeChange}
              />
            </Space>

            <Divider style={{ margin: '6px 0' }} />

            <Space wrap>
              <Text type="secondary">视图</Text>
              <Segmented
                value={viewMode}
                options={[
                  { label: '列表', value: 'list' },
                  { label: '阅读', value: 'read' },
                ]}
                onChange={handleViewModeChange}
                disabled={loading}
              />
              <Space size={6}>
                <Text type="secondary">字数</Text>
                <Switch checked={statsEnabled} onChange={handleStatsEnabledChange} disabled={loading} />
              </Space>
              {viewMode === 'read' && (
                <Space size={6}>
                  <Text type="secondary">多条展开</Text>
                  <Switch checked={multiExpand} onChange={handleMultiExpandChange} disabled={loading} />
                </Space>
              )}
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">账号</Text>
              <Select
                style={{ flex: 1, minWidth: 200 }}
                value={accountValue}
                onChange={handleAccountChange}
                options={accountOptions}
              />
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">作者</Text>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ flex: 1, minWidth: 220 }}
                value={userValue}
                onChange={handleUserChange}
                options={userOptions}
              />
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">日期</Text>
              <Input type="date" value={dateFrom} onChange={handleDateFromChange} style={{ flex: 1, minWidth: 140 }} />
              <Text type="secondary">到</Text>
              <Input type="date" value={dateTo} onChange={handleDateToChange} style={{ flex: 1, minWidth: 140 }} />
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">书签</Text>
              <Select
                style={{ flex: 1, minWidth: 180 }}
                value={bookmarkedValue}
                onChange={handleBookmarkedChange}
                options={bookmarkedOptions}
                disabled={loading}
              />
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">留言</Text>
              <Select
                style={{ flex: 1, minWidth: 180 }}
                value={hasMsgValue}
                onChange={handleHasMsgChange}
                options={hasMsgOptions}
                disabled={loading}
              />
            </Space>

            <Space wrap style={{ width: '100%' }}>
              <Text type="secondary">排序</Text>
              <Select
                style={{ flex: 1, minWidth: 180 }}
                value={sortValue}
                onChange={handleSortChange}
                options={sortOptions}
              />
            </Space>

            <Space wrap>
              {scopeTag}
              <Tag color="geekblue">共 {Number(total) || 0} 条</Tag>
              {typeof lastTookMs === 'number' && <Tag color="geekblue">耗时 {lastTookMs} ms</Tag>}
            </Space>

            <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button
                onClick={() => {
                  handleClearSearch();
                  setFiltersDrawerOpen(false);
                }}
                disabled={loading}
              >
                清空搜索
              </Button>
              <Button
                onClick={() => {
                  handleReset();
                  setFiltersDrawerOpen(false);
                }}
                disabled={loading}
              >
                重置全部
              </Button>
              <Button type="primary" onClick={() => setFiltersDrawerOpen(false)}>
                完成
              </Button>
            </Space>
          </Space>
        </Drawer>
      )}

      <Card>
        {!isMobile && viewMode === 'list' && (
          <div style={{ marginBottom: 12 }}>
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text type="secondary">已选 {selectedRowKeys.length} 条（仅当前页）</Text>
              <Space wrap>
                <Button
                  onClick={handleBatchCancelBookmarks}
                  disabled={batchCancelLoading || selectedRowKeys.length === 0}
                  loading={batchCancelLoading}
                >
                  批量取消书签
                </Button>
                <Button
                  onClick={handleExportMarkdown}
                  disabled={selectedRowKeys.length === 0}
                >
                  导出 Markdown
                </Button>
              </Space>
            </Space>
          </div>
        )}
        {viewMode === 'read' ? (
          <List
            dataSource={diaries}
            loading={loading}
            locale={{ emptyText: '暂无记录' }}
            renderItem={(item, index) => {
              const diaryId = Number(item?.id);
              const isOpen = Number.isFinite(diaryId) && expandedIds.includes(diaryId);
              const detail = Number.isFinite(diaryId) ? detailById?.[diaryId] : null;
              const detailLoading = Number.isFinite(diaryId) ? Boolean(detailLoadingById?.[diaryId]) : false;
              const detailError = Number.isFinite(diaryId) ? detailErrorById?.[diaryId] : null;

              const u = userById?.[item?.user_id];
              const name = u?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知');
              const authorText = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
              const wordCount = Number(item?.word_count_no_ws) || 0;
              const modifiedText = formatBeijingDateTimeFromTs(item?.ts);

              const prevId = (index > 0) ? Number(diaries?.[index - 1]?.id) : null;
              const nextId = (index < (diaries?.length || 0) - 1) ? Number(diaries?.[index + 1]?.id) : null;

              return (
                <Card
                  style={{ marginBottom: 12 }}
                  bodyStyle={{ padding: 14 }}
                >
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      {currentAccountId == null && (
                        <Tag color="gold" title={`账号 ${getShownAccountIdText(item)}`}>A{getShownAccountIdText(item)}</Tag>
                      )}
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                      {modifiedText !== '-' && <Tag color="purple">修改 {modifiedText}</Tag>}
                      <Tag color="volcano">留言 {getShownMsgCount(item)}</Tag>
                      {statsEnabled && <Tag color="geekblue">{wordCount} 字</Tag>}
                      {item.mood && <Tag>{item.mood}</Tag>}
                      {item.weather && <Tag color="cyan">{item.weather}</Tag>}
                    </Space>

                    <button
                      type="button"
                      onClick={() => toggleDiaryExpanded(diaryId)}
                      style={{
                        cursor: 'pointer',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        width: '100%',
                        display: 'block',
                      }}
                    >
                      <Text strong>{renderHighlighted(item.title || '无标题')}</Text>
                    </button>

                    {!isOpen && (
                      <Paragraph
                        style={{ margin: 0, color: token.colorTextSecondary }}
                        ellipsis={{ rows: 3 }}
                      >
                        {renderHighlighted(item.content_preview || '-')}
                      </Paragraph>
                    )}

                    <Space wrap>
                      <Button
                        size="small"
                        type={isOpen ? 'default' : 'primary'}
                        onClick={() => toggleDiaryExpanded(diaryId)}
                        disabled={!Number.isFinite(diaryId)}
                      >
                        {isOpen ? '收起' : '展开阅读'}
                      </Button>
                      <Button
                        size="small"
                        onClick={() => openDiaryDetail(item?.id)}
                        disabled={!Number.isFinite(diaryId)}
                      >
                        打开详情
                      </Button>
                      {isOpen && (
                        <>
                          <Button
                            size="small"
                            disabled={!Number.isFinite(prevId)}
                            onClick={() => openDiaryForReading(prevId)}
                          >
                            上一条
                          </Button>
                          <Button
                            size="small"
                            disabled={!Number.isFinite(nextId)}
                            onClick={() => openDiaryForReading(nextId)}
                          >
                            下一条
                          </Button>
                        </>
                      )}
                    </Space>

                    {isOpen && (
                      <div>
                        <Divider style={{ margin: '10px 0' }} />
                        {detailLoading && (
                          <div style={{ padding: '12px 0' }}>
                            <Spin />
                          </div>
                        )}
                        {detailError && (
                          <Alert
                            type="error"
                            showIcon
                            message="加载失败"
                            description={String(detailError)}
                          />
                        )}
                        {detail && (
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                            {renderDiaryContentWithImages(detail)}
                          </div>
                        )}
                      </div>
                    )}
                  </Space>
                </Card>
              );
            }}
          />
        ) : isMobile ? (
          <List
            dataSource={diaries}
            loading={loading}
            locale={{ emptyText: '暂无记录' }}
            renderItem={(item) => {
              const u = userById?.[item?.user_id];
              const name = u?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知');
              const authorText = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
              const wordCount = Number(item?.word_count_no_ws) || 0;
              const modifiedText = formatBeijingDateTimeFromTs(item?.ts);
              return (
                <Card
                  hoverable
                  style={{ marginBottom: 12 }}
                  onClick={() => openDiaryDetail(item?.id)}
                  bodyStyle={{ padding: 14 }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      {currentAccountId == null && (
                        <Tag color="gold" title={`账号 ${getShownAccountIdText(item)}`}>A{getShownAccountIdText(item)}</Tag>
                      )}
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                      {modifiedText !== '-' && <Tag color="purple">修改 {modifiedText}</Tag>}
                      <Tag color="volcano">留言 {getShownMsgCount(item)}</Tag>
                      {statsEnabled && <Tag color="geekblue">{wordCount} 字</Tag>}
                      {item.mood && <Tag>{item.mood}</Tag>}
                      {item.weather && <Tag color="cyan">{item.weather}</Tag>}
                    </Space>
                    <Text strong>{renderHighlighted(item.title || '无标题')}</Text>
                    <Paragraph
                      style={{ margin: 0, color: token.colorTextSecondary }}
                      ellipsis={{ rows: 2 }}
                    >
                      {renderHighlighted(item.content_preview || '-')}
                    </Paragraph>
                  </Space>
                </Card>
              );
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={diaries}
            rowKey="id"
            rowSelection={{
              selectedRowKeys,
              onChange: (keys, rows) => {
                setSelectedRowKeys(keys);
                setSelectedRows(rows);
              },
            }}
            loading={loading}
            pagination={false}
            locale={{ emptyText: '暂无记录' }}
            scroll={{ x: 1350 }}
          />
        )}

        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={Number(total) || 0}
            showSizeChanger
            pageSizeOptions={PAGE_SIZE_OPTIONS.map(String)}
            onChange={handlePaginationChange}
            showTotal={(t) => `共 ${t} 条`}
          />
        </div>

        {loading && (
          <div style={{ display: 'none' }}>
            <Spin />
          </div>
        )}
      </Card>
    </Page>
  );
}
