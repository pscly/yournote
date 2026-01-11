import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { accountAPI, syncAPI } from '../services/api';
import { formatBeijingDateTime } from '../utils/time';
import Page from '../components/Page';

const { Title } = Typography;

function formatTime(value) {
  if (!value) return '-';
  const text = formatBeijingDateTime(value);
  return text === '-' ? String(value) : text;
}

function statusTag(status) {
  if (status === 'running') return <Tag color="blue">进行中</Tag>;
  if (status === 'success') return <Tag color="green">成功</Tag>;
  if (status === 'failed') return <Tag color="red">失败</Tag>;
  return <Tag>{status || '未知'}</Tag>;
}

export default function SyncLogs() {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await accountAPI.list();
      setAccounts(res.data || []);
    } catch (e) {
      message.error('加载账号失败: ' + e.message);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await syncAPI.logs({
        limit: 100,
        ...(selectedAccount ? { account_id: selectedAccount } : {}),
      });
      setLogs(res.data || []);
    } catch (e) {
      message.error('加载同步记录失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const accountOptions = useMemo(() => {
    return [
      { label: '全部账号', value: null },
      ...(accounts || []).map((a) => ({
        value: a.id,
        label: a.user_name ? `${a.user_name}（${a.nideriji_userid}）` : `账号 ${a.nideriji_userid}`,
      })),
    ];
  }, [accounts]);

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        同步记录
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Typography.Text type="secondary">筛选账号：</Typography.Text>
          <Select
            style={{ width: 280 }}
            value={selectedAccount}
            onChange={setSelectedAccount}
            options={accountOptions}
          />
          <Button icon={<ReloadOutlined />} onClick={loadLogs}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card>
        <Table
          rowKey="id"
          dataSource={logs}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={[
            { title: '时间', dataIndex: 'sync_time', key: 'sync_time', width: 200, render: formatTime },
            { title: '账号ID', dataIndex: 'account_id', key: 'account_id', width: 100 },
            { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: statusTag },
            { title: '我的日记', dataIndex: 'diaries_count', key: 'diaries_count', width: 110, render: v => v ?? '-' },
            { title: '配对日记', dataIndex: 'paired_diaries_count', key: 'paired_diaries_count', width: 110, render: v => v ?? '-' },
            { title: '错误', dataIndex: 'error_message', key: 'error_message', ellipsis: true, render: v => v || '-' },
          ]}
        />
      </Card>
    </Page>
  );
}
