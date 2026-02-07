import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Grid, List, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { accountAPI, syncAPI } from '../services/api';
import { getErrorMessage } from '../utils/errorMessage';
import { waitForLatestSyncLog } from '../utils/sync';
import { formatBeijingDateTime } from '../utils/time';
import Page from '../components/Page';

const { Title } = Typography;

const ALL_ACCOUNTS = '__all__';
const VIEW_TIMELINE = 'timeline';
const VIEW_ACCOUNTS = 'accounts';

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
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);
  const [viewMode, setViewMode] = useState(VIEW_TIMELINE);
  const [syncingAccountId, setSyncingAccountId] = useState(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await accountAPI.list();
      setAccounts(res.data || []);
    } catch (e) {
      message.error('加载账号失败：' + getErrorMessage(e));
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const accountId = selectedAccount !== ALL_ACCOUNTS
        ? Number.parseInt(String(selectedAccount), 10)
        : null;

      const params = {
        limit: viewMode === VIEW_ACCOUNTS ? 200 : 100,
        ...(accountId ? { account_id: accountId } : {}),
      };
      const res = viewMode === VIEW_ACCOUNTS
        ? await syncAPI.logsLatest(params)
        : await syncAPI.logs(params);
      setLogs(res.data || []);
    } catch (e) {
      message.error('加载同步记录失败：' + getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, viewMode]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const accountOptions = useMemo(() => {
    return [
      { label: '全部账号', value: ALL_ACCOUNTS },
      ...(accounts || []).map((a) => ({
        value: String(a.id),
        label: a.user_name ? `${a.user_name}（${a.nideriji_userid}）` : `账号 ${a.nideriji_userid}`,
      })),
    ];
  }, [accounts]);

  const handleTriggerSync = useCallback(async (accountId) => {
    const id = Number(accountId);
    if (!Number.isFinite(id) || id <= 0) return;
    const msgKey = `sync-${id}`;

    try {
      setSyncingAccountId(id);
      const startedAt = Date.now();
      message.open({ key: msgKey, type: 'loading', content: '正在同步中...', duration: 0 });
      await syncAPI.trigger(id);

      const log = await waitForLatestSyncLog(id, startedAt, { timeoutMs: 15000 });
      if (log?.status === 'success') {
        message.open({
          key: msgKey,
          type: 'success',
          content: `同步完成：我的记录 ${log.diaries_count ?? '-'} 条，配对记录 ${log.paired_diaries_count ?? '-'} 条`,
        });
      } else if (log?.status === 'failed') {
        message.open({
          key: msgKey,
          type: 'warning',
          content: `同步失败：${log.error_message || '未知错误'}`,
        });
      } else {
        message.open({ key: msgKey, type: 'success', content: '同步完成' });
      }
    } catch (error) {
      message.open({ key: msgKey, type: 'error', content: '同步失败：' + getErrorMessage(error) });
    } finally {
      setSyncingAccountId(null);
      loadLogs();
    }
  }, [loadLogs]);

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        同步记录
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          gap: 12,
        }}>
          <Typography.Text type="secondary">筛选账号：</Typography.Text>
          <Select
            style={{ width: isMobile ? '100%' : 280 }}
            value={selectedAccount}
            onChange={setSelectedAccount}
            options={accountOptions}
          />
          <Segmented
            value={viewMode}
            onChange={setViewMode}
            options={[
              { label: '按时间', value: VIEW_TIMELINE },
              { label: '按账号', value: VIEW_ACCOUNTS },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadLogs} block={isMobile}>
            刷新
          </Button>
        </div>
      </Card>

      <Card>
        {isMobile ? (
          <List
            dataSource={logs}
            loading={loading}
            locale={{ emptyText: '暂无同步记录' }}
            renderItem={(log) => (
              <Card
                key={log?.id || `${log?.account_id}-${log?.sync_time}`}
                style={{ marginBottom: 12 }}
                styles={{ body: { padding: 14 } }}
              >
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                  <Space wrap size={8}>
                    {statusTag(log?.status)}
                    <Tag color="geekblue">账号ID：{log?.account_id ?? '-'}</Tag>
                    <Tag color="blue">{formatTime(log?.sync_time)}</Tag>
                  </Space>

                  <Space wrap size={8}>
                    <Tag>我的记录：{log?.diaries_count ?? '-'}</Tag>
                    <Tag>配对记录：{log?.paired_diaries_count ?? '-'}</Tag>
                  </Space>

                  {log?.error_message ? (
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0, fontSize: 12 }}
                      ellipsis={{ rows: 2 }}
                    >
                      {log.error_message}
                    </Typography.Paragraph>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      无错误信息
                    </Typography.Text>
                  )}

                  {(viewMode === VIEW_ACCOUNTS || log?.status === 'failed') && (
                    <Button
                      icon={<SyncOutlined />}
                      onClick={() => handleTriggerSync(log?.account_id)}
                      loading={syncingAccountId === log?.account_id}
                      block
                    >
                      {log?.status === 'failed' ? '重试同步' : '立即同步'}
                    </Button>
                  )}
                </Space>
              </Card>
            )}
          />
        ) : (
          <Table
            rowKey="id"
            dataSource={logs}
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1000 }}
            columns={[
              { title: '时间', dataIndex: 'sync_time', key: 'sync_time', width: 200, render: formatTime },
              { title: '账号ID', dataIndex: 'account_id', key: 'account_id', width: 100 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: statusTag },
              { title: '我的记录', dataIndex: 'diaries_count', key: 'diaries_count', width: 110, render: v => v ?? '-' },
              { title: '配对记录', dataIndex: 'paired_diaries_count', key: 'paired_diaries_count', width: 110, render: v => v ?? '-' },
              { title: '错误', dataIndex: 'error_message', key: 'error_message', ellipsis: true, render: v => v || '-' },
              {
                title: '操作',
                key: 'actions',
                width: 160,
                render: (_, record) => (
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    onClick={() => handleTriggerSync(record?.account_id)}
                    loading={syncingAccountId === record?.account_id}
                  >
                    {record?.status === 'failed' ? '重试' : '同步'}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Page>
  );
}
