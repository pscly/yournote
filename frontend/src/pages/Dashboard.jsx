import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Drawer, Grid, List, Row, Segmented, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { BookOutlined, DownOutlined, MessageOutlined, SyncOutlined, TeamOutlined, UpOutlined, UserOutlined } from '@ant-design/icons';
import { statsAPI, syncAPI } from '../services/api';
import { getErrorMessage } from '../utils/errorMessage';
import { waitForLatestSyncLog } from '../utils/sync';
import { useNavigate } from 'react-router-dom';
import { beijingDateStringToUtcRangeMs, formatBeijingDateTime, formatBeijingDateTimeFromTs, getBeijingDateString } from '../utils/time';
import { getDiaryWordStats } from '../utils/wordCount';
import Page from '../components/Page';
import PageState from '../components/PageState';

const { Title, Text } = Typography;

// 账号列表收起状态：默认收起；同时用 v2 避免旧版本“默认展开”的历史偏好影响新默认值。
const DASHBOARD_ACCOUNTS_COLLAPSED_KEY = 'yournote.dashboard.accountsCollapsed.v2';
// 仪表盘“新增配对记录”统计窗口（可切换，避免只按记录日期导致漏算“今天才解锁的旧记录”）
const DASHBOARD_PAIRED_INCREASE_WINDOW_KEY = 'yournote.dashboard.pairedIncreaseWindow.v1';
const DASHBOARD_MSG_COUNT_INCREASE_LIMIT = 20;

function readBoolStorage(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function writeBoolStorage(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
  }
}

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

export default function Dashboard() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [syncingId, setSyncingId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsCollapsed, setAccountsCollapsed] = useState(() => {
    const stored = readBoolStorage(DASHBOARD_ACCOUNTS_COLLAPSED_KEY);
    if (stored !== null) return stored;
    // 默认收起（可手动展开并记住）
    return true;
  });
  const [deltaDrawerOpen, setDeltaDrawerOpen] = useState(false);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    totalUsers: 0,
    pairedDiaries: 0,
    totalMsgCount: 0,
  });
  const [pairedIncreaseWindow, setPairedIncreaseWindow] = useState(() => {
    const stored = readStringStorage(DASHBOARD_PAIRED_INCREASE_WINDOW_KEY);
    if (stored === 'today0' || stored === 'yesterday20') return stored;
    return 'yesterday20';
  });
  const [pairedIncreaseLoading, setPairedIncreaseLoading] = useState(false);
  const [pairedIncreaseCount, setPairedIncreaseCount] = useState(0);
  const [pairedIncreaseDiaries, setPairedIncreaseDiaries] = useState([]);
  const [pairedIncreaseAuthorByUserId, setPairedIncreaseAuthorByUserId] = useState({});

  const [msgCountIncreaseLoading, setMsgCountIncreaseLoading] = useState(false);
  const [msgCountTodayIncrease, setMsgCountTodayIncrease] = useState(0);
  const [msgCountIncreaseItems, setMsgCountIncreaseItems] = useState([]);
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestDiaries, setLatestDiaries] = useState([]);
  const [latestAuthorByUserId, setLatestAuthorByUserId] = useState({});   
  const todayText = getBeijingDateString(0);

  const msgCountSinceMs = useMemo(() => {
    const { since_ms } = beijingDateStringToUtcRangeMs(todayText);
    return since_ms || 0;
  }, [todayText]);

  const pairedIncreaseSinceMs = useMemo(() => {
    const [yy, mm, dd] = String(todayText).split('-').map(Number);
    if (!yy || !mm || !dd) return 0;

    if (pairedIncreaseWindow === 'today0') {
      // 今日 00:00（北京时间）= 昨日 16:00（UTC）
      return Date.UTC(yy, mm - 1, dd, 0, 0, 0) - 8 * 60 * 60 * 1000;
    }

    // 默认：昨日 20:00（北京时间）= 今日 12:00（UTC）再 -24h
    const today20UtcMs = Date.UTC(yy, mm - 1, dd, 12, 0, 0);
    return today20UtcMs - 24 * 60 * 60 * 1000;
  }, [todayText, pairedIncreaseWindow]);

  const pairedIncreaseSinceLabel = useMemo(() => {
    if (!pairedIncreaseSinceMs) {
      return pairedIncreaseWindow === 'today0' ? '今日 00:00' : '昨日 20:00';
    }
    return formatBeijingDateTimeFromTs(pairedIncreaseSinceMs);
  }, [pairedIncreaseSinceMs, pairedIncreaseWindow]);

  const increaseDiaryLimit = isMobile ? 20 : 50;
  const increaseDiariesToShow = (pairedIncreaseDiaries || []).slice(0, increaseDiaryLimit);
  const increaseHidden = Math.max(0, pairedIncreaseCount - increaseDiariesToShow.length);

  const handlePairedIncreaseWindowChange = useCallback((value) => {
    const v = String(value || '');
    if (v !== 'today0' && v !== 'yesterday20') return;
    setPairedIncreaseWindow(v);
    writeStringStorage(DASHBOARD_PAIRED_INCREASE_WINDOW_KEY, v);
  }, []);

  const loadPairedIncrease = useCallback(async () => {
    if (!pairedIncreaseSinceMs) {
      setPairedIncreaseCount(0);
      setPairedIncreaseDiaries([]);
      setPairedIncreaseAuthorByUserId({});
      return;
    }

    setPairedIncreaseLoading(true);
    try {
      const res = await statsAPI.pairedDiariesIncrease({
        since_ms: pairedIncreaseSinceMs,
        limit: 200,
        include_inactive: 1,
      });
      const data = res?.data || {};
      const diaries = Array.isArray(data?.diaries) ? data.diaries : [];
      const authors = Array.isArray(data?.authors) ? data.authors : [];

      const authorById = {};
      authors.forEach((u) => {
        if (u?.id) authorById[u.id] = u;
      });

      const countNum = Number(data?.count);
      setPairedIncreaseCount(Number.isFinite(countNum) ? countNum : diaries.length);
      setPairedIncreaseDiaries(diaries);
      setPairedIncreaseAuthorByUserId(authorById);
    } catch (error) {
      setPairedIncreaseCount(0);
      setPairedIncreaseDiaries([]);
      setPairedIncreaseAuthorByUserId({});
      message.error('加载新增配对记录失败：' + getErrorMessage(error));
    } finally {
      setPairedIncreaseLoading(false);
    }
  }, [pairedIncreaseSinceMs]);

  const loadMsgCountIncrease = useCallback(async () => {
    if (!msgCountSinceMs) {
      setMsgCountTodayIncrease(0);
      setMsgCountIncreaseItems([]);
      return;
    }

    setMsgCountIncreaseLoading(true);
    try {
      const res = await statsAPI.msgCountIncrease({
        since_ms: msgCountSinceMs,
        limit: DASHBOARD_MSG_COUNT_INCREASE_LIMIT,
      });
      const data = res?.data || {};

      const totalDeltaNum = Number(data?.total_delta);
      setMsgCountTodayIncrease(Number.isFinite(totalDeltaNum) ? totalDeltaNum : 0);

      const items = Array.isArray(data?.items) ? data.items : [];
      setMsgCountIncreaseItems(items.slice(0, DASHBOARD_MSG_COUNT_INCREASE_LIMIT));
    } catch (error) {
      setMsgCountTodayIncrease(0);
      setMsgCountIncreaseItems([]);
      message.error('加载今日新增留言失败：' + getErrorMessage(error));
    } finally {
      setMsgCountIncreaseLoading(false);
    }
  }, [msgCountSinceMs]);

  const loadLatestPairedDiaries = useCallback(async () => {
    if (accounts.length === 0) {
      setLatestDiaries([]);
      setLatestAuthorByUserId({});
      return;
    }

    setLatestLoading(true);
    try {
      const res = await statsAPI.dashboard({
        latest_limit: isMobile ? 40 : 80,
        latest_preview_len: isMobile ? 80 : 140,
      });
      const data = res?.data || {};
      const latest = data?.latest_paired_diaries || {};
      const items = Array.isArray(latest?.items) ? latest.items : [];
      const authors = Array.isArray(latest?.authors) ? latest.authors : [];

      const authorById = {};
      authors.forEach((u) => {
        const id = Number(u?.id);
        if (!id) return;
        authorById[id] = u;
      });

      setLatestAuthorByUserId(authorById);
      setLatestDiaries(items);
    } catch (error) {
      setLatestDiaries([]);
      setLatestAuthorByUserId({});
      message.error('加载最近记录失败：' + getErrorMessage(error));
    } finally {
      setLatestLoading(false);
    }
  }, [accounts.length, isMobile]);

  const loadData = useCallback(async () => {
    setPageError(null);
    setLoading(true);

    try {
      const res = await statsAPI.dashboard({
        latest_limit: isMobile ? 40 : 80,
        latest_preview_len: isMobile ? 80 : 140,
      });
      const data = res?.data || {};

      const overview = data?.overview || {};
      const accountList = Array.isArray(data?.accounts) ? data.accounts : [];
      setAccounts(accountList);
      setStats({
        totalAccounts: overview.total_accounts ?? accountList.length,
        totalUsers: overview.total_users ?? 0,
        pairedDiaries: overview.paired_diaries_count ?? 0,
        totalMsgCount: overview.total_msg_count ?? 0,
      });

      const latest = data?.latest_paired_diaries || {};
      const items = Array.isArray(latest?.items) ? latest.items : [];
      const authors = Array.isArray(latest?.authors) ? latest.authors : [];

      const authorById = {};
      authors.forEach((u) => {
        const id = Number(u?.id);
        if (!id) return;
        authorById[id] = u;
      });

      setLatestAuthorByUserId(authorById);
      setLatestDiaries(items);
    } catch (error) {
      setAccounts([]);
      setStats({ totalAccounts: 0, totalUsers: 0, pairedDiaries: 0, totalMsgCount: 0 });
      setLatestDiaries([]);
      setLatestAuthorByUserId({});
      setPageError(error);
    } finally {
      setLoading(false);
    }
  }, [isMobile]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadPairedIncrease();
  }, [loadPairedIncrease]);

  useEffect(() => {
    loadMsgCountIncrease();
  }, [loadMsgCountIncrease]);

  const toggleAccountsCollapsed = useCallback(() => {
    setAccountsCollapsed((prev) => {
      const next = !prev;
      writeBoolStorage(DASHBOARD_ACCOUNTS_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const handleSync = async (accountId) => {
    const msgKey = `sync-${accountId}`;
    try {
      setSyncingId(accountId);
      const startedAt = Date.now();
      message.open({ key: msgKey, type: 'loading', content: '正在更新中...', duration: 0 });

      await syncAPI.trigger(accountId);
      const log = await waitForLatestSyncLog(accountId, startedAt, { timeoutMs: 15000 });

      if (log?.status === 'success') {
        message.open({
          key: msgKey,
          type: 'success',
          content: `更新完成：我的记录 ${log.diaries_count ?? '-'} 条，配对记录 ${log.paired_diaries_count ?? '-'} 条`,
        });
      } else if (log?.status === 'failed') {
        message.open({
          key: msgKey,
          type: 'warning',
          content: `更新失败：${log.error_message || '未知错误'}`,
        });
      } else {
        message.open({ key: msgKey, type: 'success', content: '更新完成' });
      }

      await Promise.all([loadData(), loadPairedIncrease(), loadMsgCountIncrease()]);
    } catch (error) {
      message.open({ key: msgKey, type: 'error', content: '更新失败：' + getErrorMessage(error) });
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        仪表盘
      </Title>

      <PageState
        loading={loading}
        error={pageError}
        onRetry={() => { loadData(); loadPairedIncrease(); loadMsgCountIncrease(); }}
      >
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card hoverable onClick={() => navigate('/accounts')} style={{ cursor: 'pointer' }}>
                <Statistic title="账号数量" value={stats.totalAccounts} prefix={<UserOutlined />} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card hoverable onClick={() => navigate('/users')} style={{ cursor: 'pointer' }}>
                <Statistic title="用户数量" value={stats.totalUsers} prefix={<TeamOutlined />} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card hoverable onClick={() => navigate('/diaries')} style={{ cursor: 'pointer' }}>
                <Statistic title="配对记录数" value={stats.pairedDiaries} prefix={<BookOutlined />} />
                <Space size={8} style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()} wrap>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    较 {pairedIncreaseSinceLabel}
                  </Text>
                  <Segmented
                    size="small"
                    value={pairedIncreaseWindow}
                    options={[
                      { label: '昨日20:00', value: 'yesterday20' },
                      { label: '今日00:00', value: 'today0' },
                    ]}
                    onChange={handlePairedIncreaseWindowChange}
                  />
                  {pairedIncreaseLoading ? (
                    <Spin size="small" />
                  ) : pairedIncreaseCount > 0 ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeltaDrawerOpen(true);
                      }}
                    >
                      +{pairedIncreaseCount}
                    </Button>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      +0
                    </Text>
                  )}
                </Space>
              </Card>
            </Col>

            <Col xs={12} md={6}>
              <Card hoverable style={{ cursor: 'default' }}>
                <div data-testid="msg-count-panel">
                  <Statistic
                    title="留言数量"
                    value={stats.totalMsgCount}
                    prefix={<MessageOutlined />}
                    formatter={(value) => (
                      <span data-testid="msg-count-total">{value}</span>
                    )}
                  />

                  <Space size={8} style={{ marginTop: 8 }} wrap>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      今日新增
                    </Text>
                    <Text data-testid="msg-count-today-increase" style={{ fontSize: 12 }}>
                      +{Number(msgCountTodayIncrease) || 0}
                    </Text>
                    {msgCountIncreaseLoading && <Spin size="small" />}
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      onClick={(e) => {
                        e?.stopPropagation?.();
                        navigate('/messages');
                      }}
                    >
                      查看所有有留言的记录
                    </Button>
                  </Space>

                  <div style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
                    <List
                      size="small"
                      dataSource={msgCountIncreaseItems}
                      loading={msgCountIncreaseLoading}
                      locale={{ emptyText: '暂无增长' }}
                      renderItem={(item, index) => {
                        const diaryId = item?.diary_id ?? item?.diaryId ?? item?.id;
                        const clickable = Boolean(diaryId);

                        const deltaNum = Number(item?.delta);
                        const deltaShown = Number.isFinite(deltaNum) ? deltaNum : 0;

                        const title = item?.diary_title || item?.title;
                        const createdDate = item?.created_date || item?.diary_created_date;
                        const middleText = title || createdDate || (diaryId ? `#Diary ${diaryId}` : '未知日记');

                        return (
                          <List.Item
                            key={`${item?.account_id ?? 'acc'}-${diaryId ?? index}`}
                            style={{
                              cursor: clickable ? 'pointer' : 'default',
                              paddingLeft: 0,
                              paddingRight: 0,
                            }}
                            onClick={() => {
                              if (!diaryId) return;
                              navigate(`/diary/${diaryId}`);
                            }}
                          >
                            <Text data-testid={`msg-count-top-item-${index}`} style={{ fontSize: 12 }}>
                              A{getShownAccountIdText(item)} · {middleText} · +{deltaShown}
                            </Text>
                          </List.Item>
                        );
                      }}
                    />
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          <Card
            title="账号列表"
            extra={
              <Space size={8}>
                <Button onClick={() => { loadData(); loadPairedIncrease(); loadMsgCountIncrease(); }} disabled={loading}>
                  刷新
                </Button>
                <Button
                  type="text"
                  icon={accountsCollapsed ? <DownOutlined /> : <UpOutlined />}
                  onClick={toggleAccountsCollapsed}
                >
                  {accountsCollapsed ? '展开' : '收起'}
                </Button>
              </Space>
            }
          >
            {accountsCollapsed ? (
              <Text type="secondary" style={{ padding: 12, display: 'block' }}>
                {accounts.length === 0
                  ? '暂无账号，请先去“账号管理”添加。'
                  : '账号列表已收起，点击右上角“展开”查看。'}
              </Text>
            ) : (
              <>
                {isMobile ? (
                  <List
                    dataSource={accounts}
                    locale={{ emptyText: '暂无账号，请先去“账号管理”添加。' }}
                    renderItem={(r) => {
                      const s = r?.token_status;
                      const tokenTag = (() => {
                        if (!s) return <Tag>未知</Tag>;
                        if (s.checked_at && !s.is_valid) return <Tag color="gold">已失效</Tag>;
                        if (s.expired) return <Tag color="gold">已过期</Tag>;
                        if (!s.checked_at) return <Tag color="blue">未校验</Tag>;
                        return <Tag color="green">有效</Tag>;
                      })();

                      return (
                        <Card style={{ marginBottom: 12 }}>
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <Space wrap>
                              <Tag color="blue">{r?.nideriji_userid ?? '-'}</Tag>
                              <Tag>{r?.user_name || '未命名'}</Tag>
                              {tokenTag}
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                              {r?.email || '无邮箱'}
                            </Text>
                            <Button
                              type="primary"
                              icon={<SyncOutlined />}
                              loading={syncingId === r.id}
                              onClick={() => handleSync(r.id)}
                              block
                            >
                              立即更新
                            </Button>
                          </Space>
                        </Card>
                      );
                    }}
                  />
                ) : (
                  <Table
                    rowKey="id"
                    dataSource={accounts}
                    pagination={false}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: '用户ID', dataIndex: 'nideriji_userid', key: 'nideriji_userid', width: 120 },
                      { title: '用户名', dataIndex: 'user_name', key: 'user_name', width: 140, render: v => v || '-' },
                      { title: '邮箱', dataIndex: 'email', key: 'email', width: 220, render: v => v || '-' },
                      {
                        title: 'Token',
                        key: 'token_status',
                        width: 120,
                        render: (_, r) => {
                          const s = r?.token_status;
                          if (!s) return <Tag>未知</Tag>;
                          if (s.checked_at && !s.is_valid) return <Tag color="gold">已失效</Tag>;
                          if (s.expired) return <Tag color="gold">已过期</Tag>;
                          if (!s.checked_at) return <Tag color="blue">未校验</Tag>;
                          return <Tag color="green">有效</Tag>;
                        },
                      },
                      {
                        title: '操作',
                        key: 'action',
                        width: 160,
                        render: (_, r) => (
                          <Space>
                            <Button
                              type="primary"
                              icon={<SyncOutlined />}
                              loading={syncingId === r.id}
                              onClick={() => handleSync(r.id)}
                            >
                              立即更新
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
                {accounts.length === 0 && (
                  <Text type="secondary" style={{ padding: 12, display: 'block' }}>
                    暂无账号，请先去“账号管理”添加。
                  </Text>
                )}
              </>
            )}
          </Card>

          <Card
            title={(
              <Space size={8} align="baseline">
                <span>最近记录</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  （今天是 {todayText}）
                </Text>
              </Space>
            )}
            style={{ marginTop: 16 }}
            extra={
              <Button
                onClick={loadLatestPairedDiaries}
                disabled={accounts.length === 0}
                loading={latestLoading}
              >
                刷新
              </Button>
            }
          >
            <Space wrap style={{ width: '100%', marginBottom: 12 }}>
              <Tag color="blue">全部账号</Tag>
              <Tag color="magenta">仅显示被匹配用户记录</Tag>
              <Tag color="purple">按 ts（最后修改）优先排序</Tag>
            </Space>

            <List
              dataSource={(latestDiaries || []).slice(0, isMobile ? 5 : 8)}
              loading={latestLoading}
              locale={{
                emptyText: accounts.length === 0
                  ? '暂无账号，请先去“账号管理”添加。'
                  : '暂无配对记录',
              }}
              renderItem={(item) => {
                const serverCount = Number(item?.word_count_no_ws);
                const wordCount = Number.isFinite(serverCount) ? serverCount : 0;

                const author = latestAuthorByUserId?.[item?.user_id];
                const authorName = author?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知作者');
                const authorText = author?.nideriji_userid ? `${authorName}（${author.nideriji_userid}）` : authorName;

                const updatedAtText = formatBeijingDateTimeFromTs(item?.ts);

                const content = String(item?.content_preview ?? '');
                const snippetLimit = isMobile ? 60 : 120;
                const snippet = content
                  ? (content.length > snippetLimit ? `${content.slice(0, snippetLimit)}…` : content)
                  : '（空）';

                return (
                  <List.Item
                    key={item?.id}
                    style={{ cursor: 'pointer', paddingLeft: 4, paddingRight: 4 }}
                    onClick={() => navigate(`/diary/${item.id}`)}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap size={8}>
                          <Tag color="gold" title={`账号 ${getShownAccountIdText(item)}`}>A{getShownAccountIdText(item)}</Tag>
                          <Tag color="magenta">{authorText}</Tag>
                          <Tag color="blue">{item?.created_date || '-'}</Tag>
                          {updatedAtText && <Tag color="purple">更新 {updatedAtText}</Tag>}
                          <Tag color="geekblue">{wordCount} 字</Tag>
                          <Tag color="volcano">留言 {getShownMsgCount(item)}</Tag>
                          <span style={{ fontWeight: 500 }}>{item?.title || '无标题'}</span>
                        </Space>
                      }
                      description={<Text type="secondary">{snippet}</Text>}
                    />
                  </List.Item>
                );
              }}
            />

            <div style={{ textAlign: 'center', marginTop: 4 }}>
              <Button type="link" onClick={() => navigate('/diaries')} disabled={accounts.length === 0}>
                显示更多
              </Button>
            </div>
          </Card>
        </>
      </PageState>

      <Drawer
        title={(
          <Space size={8} align="baseline">
            <span>新增配对记录</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              （较 {pairedIncreaseSinceLabel} +{pairedIncreaseCount}）
            </Text>
          </Space>
        )}
        open={deltaDrawerOpen}
        onClose={() => setDeltaDrawerOpen(false)}
        width={isMobile ? '100%' : 560}
      >
        <Space wrap style={{ width: '100%', marginBottom: 12 }}>
          <Tag color="green">统计起点：{pairedIncreaseSinceLabel}</Tag>
          <Tag color="magenta">仅配对用户记录</Tag>
          <Tag color="cyan">按入库时间统计</Tag>
        </Space>

        <div style={{ marginBottom: 8 }}>
          <Button
            type="link"
            size="small"
            style={{ paddingLeft: 0 }}
            onClick={() => {
              setDeltaDrawerOpen(false);
              navigate('/paired-increase-history');
            }}
          >
            查看历史（按天）
          </Button>
        </div>

        {increaseHidden > 0 && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            仅展示最近 {increaseDiariesToShow.length} 条（还有 {increaseHidden} 条未展示）
          </Text>
        )}

        <List
          dataSource={increaseDiariesToShow}
          loading={pairedIncreaseLoading}
          locale={{ emptyText: '暂无新增配对记录' }}
          renderItem={(item) => {
            const stats = getDiaryWordStats(item);
            const wordCount = stats?.content?.no_whitespace ?? 0;

            const author = pairedIncreaseAuthorByUserId?.[item?.user_id];
            const authorName = author?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知作者');
            const authorText = author?.nideriji_userid ? `${authorName}（${author.nideriji_userid}）` : authorName;

            const insertedAtText = item?.created_at ? formatBeijingDateTime(item.created_at) : '';
            const showInsertedAt = insertedAtText && insertedAtText !== '-';

            const updatedAtText = formatBeijingDateTimeFromTs(item?.ts);

            const content = String(item?.content ?? '');
            const snippetLimit = isMobile ? 60 : 120;
            const snippet = content
              ? (content.length > snippetLimit ? `${content.slice(0, snippetLimit)}…` : content)
              : '（空）';

            return (
              <List.Item
                key={item?.id}
                style={{ cursor: 'pointer', paddingLeft: 4, paddingRight: 4 }}
                onClick={() => {
                  setDeltaDrawerOpen(false);
                  navigate(`/diary/${item.id}`);
                }}
              >
                <List.Item.Meta
                  title={
                    <Space wrap size={8}>
                      <Tag color="gold" title={`账号 ${getShownAccountIdText(item)}`}>A{getShownAccountIdText(item)}</Tag>
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item?.created_date || '-'}</Tag>
                      {showInsertedAt && <Tag color="cyan">入库 {insertedAtText}</Tag>}
                      {updatedAtText && <Tag color="purple">更新 {updatedAtText}</Tag>}
                      <Tag color="geekblue">{wordCount} 字</Tag>
                      <Tag color="volcano">留言 {getShownMsgCount(item)}</Tag>
                      <span style={{ fontWeight: 500 }}>{item?.title || '无标题'}</span>
                    </Space>
                  }
                  description={<Text type="secondary">{snippet}</Text>}
                />
              </List.Item>
            );
          }}
        />

        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <Button
            type="link"
            onClick={() => {
              setDeltaDrawerOpen(false);
              navigate('/diaries');
            }}
          >
            去记录列表
          </Button>
        </div>
      </Drawer>
    </Page>
  );
}
