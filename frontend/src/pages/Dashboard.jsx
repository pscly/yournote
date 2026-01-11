import { useEffect, useState } from 'react';
import { Button, Card, Col, Grid, List, Row, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { BookOutlined, SyncOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { accountAPI, diaryAPI, statsAPI, syncAPI, userAPI } from '../services/api';
import { waitForLatestSyncLog } from '../utils/sync';
import { useNavigate } from 'react-router-dom';
import { formatBeijingDateTimeFromTs, normalizeEpochMs, parseServerDate } from '../utils/time';
import { getDiaryWordStats } from '../utils/wordCount';
import Page from '../components/Page';

const { Title, Text } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    totalUsers: 0,
    pairedDiaries: 0,
  });
  const [latestLoading, setLatestLoading] = useState(false);
  const [latestDiaries, setLatestDiaries] = useState([]);
  const [latestAuthorByUserId, setLatestAuthorByUserId] = useState({});   
  const todayText = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replace(/\//g, '-');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accountsRes, statsRes] = await Promise.all([
        accountAPI.list(),
        statsAPI.overview(),
      ]);

      const accountList = accountsRes.data || [];
      setAccounts(accountList);
      const overview = statsRes?.data || {};
      setStats({
        totalAccounts: overview.total_accounts ?? accountList.length,     
        totalUsers: overview.total_users ?? 0,
        pairedDiaries: overview.paired_diaries_count ?? 0,
      });

      // 最近日记（被匹配用户）默认聚合所有账号；这里做 best-effort 的异步刷新
      loadLatestPairedDiariesAll(accountList);
    } catch (error) {
      message.error('加载数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getDiaryTimestamp = (item) => {
    const raw = item?.created_date || item?.created_time;
    const d = parseServerDate(raw);
    if (!d) return 0;
    return d.getTime();
  };

  const getDiarySortKey = (item) => {
    // 优先使用同步接口带回来的 ts（更像“最后修改时间”）
    const tsMs = normalizeEpochMs(item?.ts);
    if (tsMs) return tsMs;
    return getDiaryTimestamp(item);
  };

  const loadLatestPairedDiariesAll = async (accountList = accounts) => {
    const list = accountList || [];
    if (list.length === 0) {
      setLatestDiaries([]);
      setLatestAuthorByUserId({});
      return;
    }

    setLatestLoading(true);
    try {
      const results = await Promise.all(
        list.map(async (acc) => {
          const accountId = acc?.id;
          if (!accountId) return { diaries: [], authors: {} };

          // 先取配对关系（用于确定“被匹配用户”是谁）
          const pairedRes = await userAPI.paired(accountId);
          const relationships = pairedRes?.data || [];

          const matchedUsers = relationships
            .map(r => r?.paired_user)
            .filter(u => u?.id);

          const authors = {};
          matchedUsers.forEach((u) => {
            authors[u.id] = u;
          });

          const matchedUserIds = new Set(matchedUsers.map(u => u.id));
          if (matchedUserIds.size === 0) return { diaries: [], authors };

          // 再取该账号的日记列表，并仅保留“被匹配用户”的日记
          const diariesRes = await diaryAPI.byAccount(accountId, 100);
          const filtered = (diariesRes?.data || []).filter(d => matchedUserIds.has(d?.user_id));
          return { diaries: filtered, authors };
        }),
      );

      const mergedById = new Map();
      const authorById = {};

      results.forEach((r) => {
        Object.assign(authorById, r?.authors || {});
        (r?.diaries || []).forEach((d) => {
          if (!d) return;
          const key = d?.id ?? `${d?.account_id ?? 'acc'}_${d?.nideriji_diary_id ?? 'nid'}_${d?.created_date ?? 'date'}_${d?.user_id ?? 'uid'}`;
          mergedById.set(key, d);
        });
      });

      const merged = Array.from(mergedById.values()).sort((a, b) => (
        getDiarySortKey(b) - getDiarySortKey(a)
      ));

      setLatestAuthorByUserId(authorById);
      setLatestDiaries(merged);
    } catch (error) {
      setLatestDiaries([]);
      setLatestAuthorByUserId({});
      message.error('加载最近日记失败: ' + error.message);
    } finally {
      setLatestLoading(false);
    }
  };

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
          content: `更新完成：我的日记 ${log.diaries_count ?? '-'} 条，配对日记 ${log.paired_diaries_count ?? '-'} 条`,
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

      await loadData();
    } catch (error) {
      message.open({ key: msgKey, type: 'error', content: '更新失败: ' + error.message });
    } finally {
      setSyncingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        仪表盘
      </Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={8}>
          <Card hoverable onClick={() => navigate('/accounts')} style={{ cursor: 'pointer' }}>
            <Statistic title="账号数量" value={stats.totalAccounts} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card hoverable onClick={() => navigate('/users')} style={{ cursor: 'pointer' }}>
            <Statistic title="用户数量" value={stats.totalUsers} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card hoverable onClick={() => navigate('/diaries')} style={{ cursor: 'pointer' }}>
            <Statistic title="配对日记数" value={stats.pairedDiaries} prefix={<BookOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card
        title="账号列表"
        extra={
          <Button onClick={loadData} disabled={loading}>
            刷新
          </Button>
        }
      >
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
                <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 14 }}>
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
      </Card>

      <Card
        title={(
          <Space size={8} align="baseline">
            <span>最近日记</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              （今天是 {todayText}）
            </Text>
          </Space>
        )}
        style={{ marginTop: 16 }}
        extra={
          <Button
            onClick={() => loadLatestPairedDiariesAll()}
            disabled={accounts.length === 0}
            loading={latestLoading}
          >
            刷新
          </Button>
        }
      >
        <Space wrap style={{ width: '100%', marginBottom: 12 }}>
          <Tag color="blue">全部账号</Tag>
          <Tag color="magenta">仅显示被匹配用户日记</Tag>
          <Tag color="purple">按 ts（最后修改）优先排序</Tag>
        </Space>

        <List
          dataSource={(latestDiaries || []).slice(0, isMobile ? 5 : 8)}
          loading={latestLoading}
          locale={{
            emptyText: accounts.length === 0
              ? '暂无账号，请先去“账号管理”添加。'
              : '暂无配对日记',
          }}
          renderItem={(item) => {
            const stats = getDiaryWordStats(item);
            const wordCount = stats?.content?.no_whitespace ?? 0;

            const author = latestAuthorByUserId?.[item?.user_id];
            const authorName = author?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知作者');
            const authorText = author?.nideriji_userid ? `${authorName}（${author.nideriji_userid}）` : authorName;

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
                onClick={() => navigate(`/diary/${item.id}`)}
              >
                <List.Item.Meta
                  title={
                    <Space wrap size={8}>
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item?.created_date || '-'}</Tag>
                      {updatedAtText && <Tag color="purple">更新 {updatedAtText}</Tag>}
                      <Tag color="geekblue">{wordCount} 字</Tag>
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
    </Page>
  );
}
