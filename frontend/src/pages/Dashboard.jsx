import { useState, useEffect } from 'react';
import { Card, Statistic, Row, Col, Button, message, Spin } from 'antd';
import { SyncOutlined, UserOutlined, BookOutlined } from '@ant-design/icons';
import { accountAPI, syncAPI, userAPI } from '../services/api';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState({
    totalAccounts: 0,
    totalUsers: 0,
    lastSync: null,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [accountsRes, usersRes, logsRes] = await Promise.all([
        accountAPI.list(),
        userAPI.list(),
        syncAPI.logs({ limit: 1 }),
      ]);

      setAccounts(accountsRes.data);
      setStats({
        totalAccounts: accountsRes.data.length,
        totalUsers: usersRes.data.length,
        lastSync: logsRes.data[0]?.sync_time || null,
      });
    } catch (error) {
      message.error('加载数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (accountId) => {
    try {
      setSyncing(true);
      await syncAPI.trigger(accountId);
      message.success('同步成功！');
      loadData();
    } catch (error) {
      message.error('同步失败: ' + error.message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ padding: '24px' }}>
      <h1>仪表盘</h1>

      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="账号数量"
              value={stats.totalAccounts}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="用户数量"
              value={stats.totalUsers}
              prefix={<BookOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="最后同步"
              value={stats.lastSync ? new Date(stats.lastSync).toLocaleString('zh-CN') : '未同步'}
            />
          </Card>
        </Col>
      </Row>

      <Card title="账号列表">
        {accounts.map(account => (
          <Card
            key={account.id}
            type="inner"
            style={{ marginBottom: '16px' }}
            extra={
              <Button
                type="primary"
                icon={<SyncOutlined />}
                loading={syncing}
                onClick={() => handleSync(account.id)}
              >
                同步
              </Button>
            }
          >
            <p><strong>用户ID:</strong> {account.nideriji_userid}</p>
            <p><strong>邮箱:</strong> {account.email || '未设置'}</p>
            <p><strong>状态:</strong> {account.is_active ? '活跃' : '停用'}</p>
          </Card>
        ))}
        {accounts.length === 0 && <p>暂无账号，请先添加账号</p>}
      </Card>
    </div>
  );
}
