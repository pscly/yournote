import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Grid, List, Row, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { BookOutlined, SyncOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { accountAPI, statsAPI, syncAPI } from '../services/api';
import { waitForLatestSyncLog } from '../utils/sync';
import { useNavigate } from 'react-router-dom';
import { formatBeijingDateTime } from '../utils/time';

const { Title } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    totalUsers: 0,
    pairedDiaries: 0,
    lastSync: null,
  });

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

      setAccounts(accountsRes.data);
      const overview = statsRes?.data || {};
      setStats({
        totalAccounts: overview.total_accounts ?? accountsRes.data.length,
        totalUsers: overview.total_users ?? 0,
        pairedDiaries: overview.paired_diaries_count ?? 0,
        lastSync: overview.last_sync_time || null,
      });
    } catch (error) {
      message.error('加载数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const latestSyncTimeText = useMemo(() => {
    if (!stats.lastSync) return '未同步';
    const text = formatBeijingDateTime(stats.lastSync);
    return text === '-' ? String(stats.lastSync) : text;
  }, [stats.lastSync]);

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

      loadData();
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
    <div style={{ padding: pagePadding }}>
      <Title level={3} style={{ marginTop: 0 }}>
        仪表盘
      </Title>

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
            <Statistic title="配对日记数" value={stats.pairedDiaries} prefix={<BookOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="最后同步" value={latestSyncTimeText} />
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
                    <div style={{ color: '#999', fontSize: 12 }}>
                      {r?.email || '无邮箱'}
                    </div>
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
        {accounts.length === 0 && <div style={{ padding: 12, color: '#999' }}>暂无账号，请先去“账号管理”添加。</div>}
      </Card>
    </div>
  );
}
