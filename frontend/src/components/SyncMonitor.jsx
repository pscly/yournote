import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Divider, List, Popover, Space, Tag, Typography, message } from 'antd';
import { HistoryOutlined, SyncOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { accountAPI, syncAPI } from '../services/api';

const { Text } = Typography;

function formatTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN');
}

function getStatusTag(status) {
  if (status === 'running') return <Tag color="blue">进行中</Tag>;
  if (status === 'success') return <Tag color="green">成功</Tag>;
  if (status === 'failed') return <Tag color="red">失败</Tag>;
  return <Tag>{status || '未知'}</Tag>;
}

export default function SyncMonitor() {
  const [latestLogs, setLatestLogs] = useState([]);
  const [accountMeta, setAccountMeta] = useState(new Map());

  const initializedRef = useRef(false);
  const lastSeenIdRef = useRef(new Map()); // accountId -> logId
  const lastSeenStatusRef = useRef(new Map()); // accountId -> status
  const accountMetaRef = useRef(new Map());
  const pollingRef = useRef(false);

  const loadAccounts = async () => {
    try {
      const res = await accountAPI.list();
      const map = new Map();
      (res.data || []).forEach((a) => {
        map.set(a.id, {
          id: a.id,
          nideriji_userid: a.nideriji_userid,
          user_name: a.user_name,
        });
      });
      setAccountMeta(map);
      accountMetaRef.current = map;
    } catch {
      // 忽略：同步指示器不应影响主功能
    }
  };

  const pollLogs = async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await syncAPI.logs({ limit: 50 });
      const logs = res.data || [];

      // 取每个账号最新一条日志（按 sync_time desc 已排序，但这里做一次兜底）
      const byAccount = new Map();
      for (const log of logs) {
        const accountId = log?.account_id;
        if (!accountId) continue;
        if (!byAccount.has(accountId)) byAccount.set(accountId, log);
      }

      const latest = Array.from(byAccount.values());
      setLatestLogs(latest);

      if (!initializedRef.current) {
        latest.forEach((log) => {
          lastSeenIdRef.current.set(log.account_id, log.id);
          lastSeenStatusRef.current.set(log.account_id, log.status);
        });
        initializedRef.current = true;
        return;
      }

      // 后台同步提示（包括定时任务触发的同步）
      latest.forEach((log) => {
        const accountId = log.account_id;
        const prevId = lastSeenIdRef.current.get(accountId);
        const prevStatus = lastSeenStatusRef.current.get(accountId);
        const key = `sync-${accountId}`;

        const labelMeta = accountMetaRef.current.get(accountId);
        const accountLabel = labelMeta?.user_name
          ? `${labelMeta.user_name}（${labelMeta.nideriji_userid}）`
          : `账号 ${accountId}`;

        if (prevId !== log.id) {
          lastSeenIdRef.current.set(accountId, log.id);
          lastSeenStatusRef.current.set(accountId, log.status);

          if (log.status === 'running') {
            message.open({
              key,
              type: 'loading',
              content: `${accountLabel}：正在更新中...`,
              duration: 0,
            });
          }
          return;
        }

        if (prevStatus !== log.status) {
          lastSeenStatusRef.current.set(accountId, log.status);

          if (log.status === 'running') {
            message.open({
              key,
              type: 'loading',
              content: `${accountLabel}：正在更新中...`,
              duration: 0,
            });
            return;
          }

          if (log.status === 'success') {
            message.open({
              key,
              type: 'success',
              content: `${accountLabel}：更新完成（我的 ${log.diaries_count ?? '-'} 条 / 配对 ${log.paired_diaries_count ?? '-'} 条）`,
            });
            return;
          }

          if (log.status === 'failed') {
            message.open({
              key,
              type: 'warning',
              content: `${accountLabel}：更新失败（${log.error_message || '未知错误'}）`,
            });
          }
        }
      });
    } catch {
      // 忽略网络波动
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    loadAccounts();
    pollLogs();

    const logTimer = setInterval(() => {
      pollLogs();
    }, 5000);

    const accountTimer = setInterval(() => {
      loadAccounts();
    }, 30000);

    return () => {
      clearInterval(logTimer);
      clearInterval(accountTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningLogs = useMemo(() => latestLogs.filter(l => l.status === 'running'), [latestLogs]);
  const runningCount = runningLogs.length;
  const recentFinished = useMemo(
    () => latestLogs.filter(l => l.status !== 'running').slice(0, 5),
    [latestLogs],
  );

  const popoverContent = (
    <div style={{ width: 360 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text strong>同步状态</Text>
        <Link to="/sync-logs">
          <Button type="link" size="small" icon={<HistoryOutlined />}>
            查看记录
          </Button>
        </Link>
      </Space>

      <Divider style={{ margin: '12px 0' }} />

      {runningCount > 0 ? (
        <>
          <Text type="secondary">进行中（{runningCount}）</Text>
          <List
            size="small"
            dataSource={runningLogs}
            renderItem={(log) => {
              const meta = accountMeta.get(log.account_id);
              const title = meta?.user_name
                ? `${meta.user_name}（${meta.nideriji_userid}）`
                : `账号 ${log.account_id}`;
              return (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Space>
                      {getStatusTag(log.status)}
                      <Text>{title}</Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      开始时间：{formatTime(log.sync_time)}
                    </Text>
                  </Space>
                </List.Item>
              );
            }}
          />
        </>
      ) : (
        <Text type="secondary">当前没有进行中的同步</Text>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <Text type="secondary">最近结果</Text>
      <List
        size="small"
        dataSource={recentFinished}
        renderItem={(log) => {
          const meta = accountMeta.get(log.account_id);
          const title = meta?.user_name
            ? `${meta.user_name}（${meta.nideriji_userid}）`
            : `账号 ${log.account_id}`;
          return (
            <List.Item>
              <Space direction="vertical" size={0}>
                <Space>
                  {getStatusTag(log.status)}
                  <Text>{title}</Text>
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  时间：{formatTime(log.sync_time)}
                </Text>
              </Space>
            </List.Item>
          );
        }}
      />
    </div>
  );

  return (
    <Popover content={popoverContent} trigger="click" placement="bottomRight">
      <Badge count={runningCount} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          style={{ color: 'rgba(255,255,255,0.85)' }}
          icon={runningCount > 0 ? <SyncOutlined spin /> : <SyncOutlined />}
        >
          同步
        </Button>
      </Badge>
    </Popover>
  );
}
