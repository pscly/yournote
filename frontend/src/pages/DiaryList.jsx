import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Grid,
  Input,
  List,
  Pagination,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
  theme,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { accountAPI, diaryAPI, userAPI } from '../services/api';
import { getDiaryWordStats } from '../utils/wordCount';
import { formatBeijingDateTimeFromTs } from '../utils/time';
import Page from '../components/Page';

const { Title, Paragraph, Text } = Typography;

const DIARY_LIST_SCOPE_KEY = 'yournote.diaryList.scope.v1';
const DIARY_LIST_PAGE_SIZE_KEY = 'yournote.diaryList.pageSize.v1';

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

function parseOrderBy(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'ts' || v === 'created_date' || v === 'created_at') return v;
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

export default function DiaryList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token } = theme.useToken();
  const searchInputRef = useRef(null);

  const storedScope = readStringStorage(DIARY_LIST_SCOPE_KEY);
  const storedPageSize = readIntStorage(DIARY_LIST_PAGE_SIZE_KEY);

  const initialUrlQ = String(searchParams.get('q') || '').trim();
  const initialScope = parseScope(searchParams.get('scope')) || (storedScope === 'matched' || storedScope === 'all' ? storedScope : null) || 'matched';
  const initialPageSizeRaw = parsePositiveInt(searchParams.get('pageSize')) || storedPageSize;
  const initialPageSize = PAGE_SIZE_OPTIONS.includes(initialPageSizeRaw) ? initialPageSizeRaw : 50;
  const initialPage = Math.max(1, parsePositiveInt(searchParams.get('page')) || 1);

  const initialAccountId = parsePositiveInt(searchParams.get('accountId') || searchParams.get('account_id'));
  const initialUserId = parsePositiveInt(searchParams.get('userId') || searchParams.get('user_id'));
  const initialDateFrom = parseDateYmd(searchParams.get('from') || searchParams.get('date_from'));
  const initialDateTo = parseDateYmd(searchParams.get('to') || searchParams.get('date_to'));

  const initialOrderBy = parseOrderBy(searchParams.get('orderBy')) || 'ts';
  const initialOrder = parseOrder(searchParams.get('order')) || 'desc';

  const [accounts, setAccounts] = useState([]);
  const [userById, setUserById] = useState({});

  const [qInput, setQInput] = useState(initialUrlQ);
  const [q, setQ] = useState(initialUrlQ);

  const [scope, setScope] = useState(initialScope);
  const [accountValue, setAccountValue] = useState(initialAccountId ?? ALL);
  const [userValue, setUserValue] = useState(initialUserId ?? ALL);
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? '');
  const [dateTo, setDateTo] = useState(initialDateTo ?? '');

  const [orderBy, setOrderBy] = useState(initialOrderBy);
  const [order, setOrder] = useState(initialOrder);

  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [diaries, setDiaries] = useState([]);
  const loadSeqRef = useRef(0);

  const syncUrl = useCallback((next, { replace = false } = {}) => {
    const p = new URLSearchParams();

    const qText = String(next.q || '').trim();
    if (qText) p.set('q', qText);

    p.set('scope', next.scope || 'matched');

    if (typeof next.accountId === 'number' && next.accountId > 0) p.set('accountId', String(next.accountId));
    if (typeof next.userId === 'number' && next.userId > 0) p.set('userId', String(next.userId));

    if (next.dateFrom) p.set('from', next.dateFrom);
    if (next.dateTo) p.set('to', next.dateTo);

    p.set('page', String(Math.max(1, next.page || 1)));
    p.set('pageSize', String(next.pageSize || 50));
    p.set('orderBy', next.orderBy || 'ts');
    p.set('order', next.order || 'desc');

    setSearchParams(p, { replace });
  }, [setSearchParams]);

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
      message.error('初始化失败: ' + (error?.message || '未知错误'));
    }
  }, []);

  const loadDiaries = useCallback(async () => {
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;

    setLoading(true);
    try {
      const res = await diaryAPI.query({
        q: q || undefined,
        scope,
        account_id: currentAccountId || undefined,
        user_id: currentUserId || undefined,
        date_from: currentDateFrom || undefined,
        date_to: currentDateTo || undefined,
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
      setDiaries(items);
      setTotal(Number.isFinite(countNum) ? countNum : items.length);
    } catch (error) {
      if (loadSeqRef.current !== seq) return;
      setDiaries([]);
      setTotal(0);
      message.error('加载记录失败: ' + (error?.message || '未知错误'));
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [q, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, page, pageSize, orderBy, order, isMobile]);

  useEffect(() => {
    loadInit();
  }, [loadInit]);

  useEffect(() => {
    loadDiaries();
  }, [loadDiaries]);

  // 让用户偏好“记住上次选择”：即使是通过分享链接打开，也会更新到本地偏好。
  useEffect(() => {
    if (scope === 'matched' || scope === 'all') writeStringStorage(DIARY_LIST_SCOPE_KEY, scope);
  }, [scope]);

  useEffect(() => {
    if (PAGE_SIZE_OPTIONS.includes(pageSize)) writeIntStorage(DIARY_LIST_PAGE_SIZE_KEY, pageSize);
  }, [pageSize]);

  // 支持浏览器前进/后退：URL 改变时同步状态
  useEffect(() => {
    const urlQ = String(searchParams.get('q') || '').trim();
    const urlScope = parseScope(searchParams.get('scope')) || 'matched';
    const urlPageSizeRaw = parsePositiveInt(searchParams.get('pageSize')) || 50;
    const urlPageSize = PAGE_SIZE_OPTIONS.includes(urlPageSizeRaw) ? urlPageSizeRaw : 50;
    const urlPage = Math.max(1, parsePositiveInt(searchParams.get('page')) || 1);
    const urlAccountId = parsePositiveInt(searchParams.get('accountId') || searchParams.get('account_id'));
    const urlUserId = parsePositiveInt(searchParams.get('userId') || searchParams.get('user_id'));
    const urlFrom = parseDateYmd(searchParams.get('from') || searchParams.get('date_from')) || '';
    const urlTo = parseDateYmd(searchParams.get('to') || searchParams.get('date_to')) || '';
    const urlOrderBy = parseOrderBy(searchParams.get('orderBy')) || 'ts';
    const urlOrder = parseOrder(searchParams.get('order')) || 'desc';

    if (qInput !== urlQ) setQInput(urlQ);
    if (q !== urlQ) setQ(urlQ);
    if (scope !== urlScope) setScope(urlScope);
    if (pageSize !== urlPageSize) setPageSize(urlPageSize);
    if (page !== urlPage) setPage(urlPage);
    if ((accountValue === ALL ? null : parsePositiveInt(accountValue)) !== urlAccountId) setAccountValue(urlAccountId ?? ALL);
    if ((userValue === ALL ? null : parsePositiveInt(userValue)) !== urlUserId) setUserValue(urlUserId ?? ALL);
    if (dateFrom !== urlFrom) setDateFrom(urlFrom);
    if (dateTo !== urlTo) setDateTo(urlTo);
    if (orderBy !== urlOrderBy) setOrderBy(urlOrderBy);
    if (order !== urlOrder) setOrder(urlOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  ]), []);

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
    const v = String(value || '');
    const parts = v.split('_');
    const nextOrderBy = parseOrderBy(parts[0]) || 'ts';
    const nextOrder = parseOrder(parts[1]) || 'desc';
    const nextQ = qInput.trim();
    setOrderBy(nextOrderBy);
    setOrder(nextOrder);
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
      orderBy: nextOrderBy,
      order: nextOrder,
    }, { replace: false });
  }, [qInput, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, pageSize, syncUrl]);

  const handleReset = useCallback(() => {
    const nextScope = (readStringStorage(DIARY_LIST_SCOPE_KEY) === 'all') ? 'all' : 'matched';
    setQInput('');
    setQ('');
    setScope(nextScope);
    setAccountValue(ALL);
    setUserValue(ALL);
    setDateFrom('');
    setDateTo('');
    setOrderBy('ts');
    setOrder('desc');
    setPage(1);
    syncUrl({
      q: '',
      scope: nextScope,
      accountId: null,
      userId: null,
      dateFrom: null,
      dateTo: null,
      page: 1,
      pageSize,
      orderBy: 'ts',
      order: 'desc',
    }, { replace: false });
  }, [pageSize, syncUrl]);

  const handlePaginationChange = useCallback((nextPage, nextPageSize) => {
    const ps = PAGE_SIZE_OPTIONS.includes(nextPageSize) ? nextPageSize : pageSize;
    const sizeChanged = ps !== pageSize;
    const finalPage = sizeChanged ? 1 : Math.max(1, nextPage || 1);

    if (sizeChanged) setPageSize(ps);
    setPage(finalPage);

    syncUrl({
      q,
      scope,
      accountId: currentAccountId,
      userId: currentUserId,
      dateFrom: currentDateFrom,
      dateTo: currentDateTo,
      page: finalPage,
      pageSize: ps,
      orderBy,
      order,
    }, { replace: false });
  }, [pageSize, q, scope, currentAccountId, currentUserId, currentDateFrom, currentDateTo, orderBy, order, syncUrl]);

  const columns = useMemo(() => [
    { title: '日期', dataIndex: 'created_date', key: 'date', width: 120, render: (v) => v || '-' },
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
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 240,
      render: (v) => v || '-',
      onCell: (record) => ({
        onClick: () => navigate(`/diary/${record.id}`),
        style: { cursor: 'pointer' },
      }),
    },
    {
      title: '内容',
      dataIndex: 'content_preview',
      key: 'content',
      ellipsis: true,
      render: (v) => v || '-',
      onCell: (record) => ({
        onClick: () => navigate(`/diary/${record.id}`),
        style: { cursor: 'pointer', color: token.colorPrimary },
      }),
    },
    {
      title: '字数',
      key: 'word_count',
      width: 110,
      align: 'right',
      render: (_, record) => {
        const serverCount = Number(record?.word_count_no_ws);
        if (Number.isFinite(serverCount)) return <Tag color="geekblue">{serverCount} 字</Tag>;
        const stats = getDiaryWordStats(record);
        const n = stats?.content?.no_whitespace ?? 0;
        return <Tag color="geekblue">{n} 字</Tag>;
      },
    },
    { title: '心情', dataIndex: 'mood', key: 'mood', width: 90, render: (m) => (m ? <Tag>{m}</Tag> : '-') },
    { title: '天气', dataIndex: 'weather', key: 'weather', width: 90, render: (w) => (w ? <Tag color="blue">{w}</Tag> : '-') },
  ], [navigate, userById, token]);

  if (accounts.length === 0) {
    return (
      <Page>
        <Title level={3} style={{ marginTop: 0 }}>
          记录列表
        </Title>
        <Card>
          <Text type="secondary">暂无账号，请先去“账号管理”添加并等待同步完成。</Text>
        </Card>
      </Page>
    );
  }

  const scopeTag = scope === 'all'
    ? <Tag color="blue">范围：全部记录</Tag>
    : <Tag color="magenta">范围：仅配对用户记录</Tag>;

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        记录列表
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
              style={{ flex: 1, minWidth: isMobile ? '100%' : 420 }}
            />
            <Button icon={<ReloadOutlined />} onClick={loadDiaries} disabled={loading} block={isMobile}>
              刷新
            </Button>
            <Button onClick={handleReset} disabled={loading} block={isMobile}>
              重置条件
            </Button>
          </Space>

          <Space wrap direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }}>
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
              <Text type="secondary">账号</Text>
              <Select
                style={{ width: isMobile ? '100%' : 220 }}
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
                style={{ width: isMobile ? '100%' : 240 }}
                value={userValue}
                onChange={handleUserChange}
                options={userOptions}
              />
            </Space>
          </Space>

          <Space wrap direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }}>
            <Space wrap>
              <Text type="secondary">日期</Text>
              <Input type="date" value={dateFrom} onChange={handleDateFromChange} style={{ width: isMobile ? '100%' : 160 }} />
              <Text type="secondary">到</Text>
              <Input type="date" value={dateTo} onChange={handleDateToChange} style={{ width: isMobile ? '100%' : 160 }} />
            </Space>

            <Space wrap style={{ marginLeft: isMobile ? 0 : 'auto' }}>
              <Text type="secondary">排序</Text>
              <Select
                style={{ width: isMobile ? '100%' : 160 }}
                value={sortValue}
                onChange={handleSortChange}
                options={sortOptions}
              />
              {scopeTag}
              <Tag color="geekblue">共 {Number(total) || 0} 条</Tag>
            </Space>
          </Space>
        </Space>
      </Card>

      <Card>
        {isMobile ? (
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
                  onClick={() => navigate(`/diary/${item.id}`)}
                  bodyStyle={{ padding: 14 }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                      {modifiedText !== '-' && <Tag color="purple">修改 {modifiedText}</Tag>}
                      <Tag color="geekblue">{wordCount} 字</Tag>
                      {item.mood && <Tag>{item.mood}</Tag>}
                      {item.weather && <Tag color="cyan">{item.weather}</Tag>}
                    </Space>
                    <Text strong>{item.title || '无标题'}</Text>
                    <Paragraph
                      style={{ margin: 0, color: token.colorTextSecondary }}
                      ellipsis={{ rows: 2 }}
                    >
                      {item.content_preview || '-'}
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
