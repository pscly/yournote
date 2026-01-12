import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Divider, List, Popover, Space, Tag, Typography, message } from 'antd';
import { HistoryOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { accountAPI, syncAPI } from '../services/api';
import { formatBeijingDateTime } from '../utils/time';

const { Text } = Typography;

function formatTime(value) {
  if (!value) return '-';
  const text = formatBeijingDateTime(value);
  return text === '-' ? String(value) : text;
}

function getStatusTag(status) {
  if (status === 'running') return <Tag color="blue">进行中</Tag>;
  if (status === 'success') return <Tag color="green">成功</Tag>;
  if (status === 'failed') return <Tag color="red">失败</Tag>;
  return <Tag>{status || '未知'}</Tag>;
}

export default function SyncMonitor({ compact = false } = {}) {
  const [latestLogs, setLatestLogs] = useState([]);
  const [accountMeta, setAccountMeta] = useState(new Map());
  const [triggeringAll, setTriggeringAll] = useState(false);

  const initializedRef = useRef(false);
  const lastSeenIdRef = useRef(new Map()); // accountId -> logId
  const lastSeenStatusRef = useRef(new Map()); // accountId -> status
  const accountMetaRef = useRef(new Map());
  const pollingRef = useRef(false);
  const pollTimerRef = useRef(null);
  const pollErrorStreakRef = useRef(0);
  const unmountedRef = useRef(false);
  const pollNowRef = useRef(null);

  const loadAccounts = async ({ silent = true } = {}) => {
    try {
      // 优先走轻量接口；老后端没有该接口时回退到完整列表
      let res;
      try {
        res = await accountAPI.meta();
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          res = await accountAPI.list();
        } else {
          throw e;
        }
      }
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
    } catch (e) {
      if (!silent) message.error('加载账号失败: ' + (e?.message || String(e)));
      // 忽略：同步指示器不应影响主功能
    }
  };

  const pollLogs = async () => {
    if (pollingRef.current) return { ok: true, hasRunning: false, skipped: true };
    pollingRef.current = true;
    try {
      // 优先走 “每个账号最新一条” 的轻量接口；老后端没有该接口时回退到历史接口
      let res;
      try {
        res = await syncAPI.logsLatest({ limit: 50 });
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          res = await syncAPI.logs({ limit: 50 });
        } else {
          throw e;
        }
      }
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

      // 如果日志里出现了未知账号，后台补拉一次账号元数据（不阻塞主流程）
      try {
        const meta = accountMetaRef.current;
        const unknown = latest.some((l) => l?.account_id && !meta.has(l.account_id));
        if (unknown) loadAccounts({ silent: true });
      } catch {
        // ignore
      }

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

      return { ok: true, hasRunning: latest.some((l) => l?.status === 'running') };
    } catch {
      // 忽略网络波动
      return { ok: false, hasRunning: false };
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    unmountedRef.current = false;

    const clearPollTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const computeNextIntervalMs = ({ ok, hasRunning } = {}) => {
      if (document.hidden) return null;

      // 运行中：更快刷新；空闲：更慢刷新（降低对后端/数据库/磁盘日志的压力）
      const baseMs = hasRunning ? 3000 : 20000;

      // 连续失败：做指数退避，避免网络/后端异常时“打爆”
      if (ok === false) {
        pollErrorStreakRef.current = Math.min(pollErrorStreakRef.current + 1, 6);
      } else {
        pollErrorStreakRef.current = 0;
      }
      const factor = Math.pow(2, pollErrorStreakRef.current);
      return Math.min(baseMs * factor, 60000);
    };

    const pollOnceAndScheduleNext = async () => {
      if (unmountedRef.current) return;
      if (document.hidden) return;

      const result = await pollLogs();
      const nextMs = computeNextIntervalMs(result);
      if (typeof nextMs === 'number' && nextMs > 0) {
        clearPollTimer();
        pollTimerRef.current = setTimeout(() => {
          pollOnceAndScheduleNext();
        }, nextMs);
      }
    };

    const pollNow = async () => {
      clearPollTimer();
      await pollOnceAndScheduleNext();
    };

    pollNowRef.current = pollNow;

    const handleVisibility = () => {
      if (document.hidden) {
        clearPollTimer();
        return;
      }
      loadAccounts();
      pollNow();
    };

    document.addEventListener('visibilitychange', handleVisibility);

    loadAccounts();
    pollNow();

    return () => {
      unmountedRef.current = true;
      clearPollTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const runningLogs = useMemo(() => latestLogs.filter(l => l.status === 'running'), [latestLogs]);
  const runningCount = runningLogs.length;
  const recentFinished = useMemo(
    () => latestLogs.filter(l => l.status !== 'running').slice(0, 5),
    [latestLogs],
  );

  const handleRefresh = async () => {
    await loadAccounts({ silent: false });
    await (pollNowRef.current?.() || pollLogs());
  };

  const handleSyncAllNow = async () => {
    const msgKey = 'sync-all';
    if (triggeringAll) return;

    setTriggeringAll(true);
    try {
      await loadAccounts({ silent: false });

      const accounts = Array.from(accountMetaRef.current.values());
      if (accounts.length === 0) {
        message.info('暂无账号，请先在“账号管理”添加。');
        return;
      }

      const runningIds = new Set(runningLogs.map(l => l?.account_id).filter(Boolean));
      const targets = accounts.filter(a => !runningIds.has(a.id));
      const skipped = accounts.length - targets.length;

      if (targets.length === 0) {
        message.info('当前所有账号都在同步中');
        return;
      }

      message.open({
        key: msgKey,
        type: 'loading',
        content: `开始同步：${targets.length} 个账号...`,
        duration: 0,
      });

      let ok = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i += 1) {
        const account = targets[i];
        const label = account.user_name
          ? `${account.user_name}（${account.nideriji_userid}）`
          : `账号 ${account.nideriji_userid ?? account.id}`;

        message.open({
          key: msgKey,
          type: 'loading',
          content: `(${i + 1}/${targets.length}) ${label}：同步中...`,
          duration: 0,
        });

        try {
          await syncAPI.trigger(account.id);
          ok += 1;
        } catch (e) {
          failed += 1;
          const errText = String(e?.message || e || '未知错误');
          if (/timeout|超时/i.test(errText)) {
            message.warning(`${label}：请求超时，但后台可能仍在同步，请稍后查看结果`);
          } else {
            message.error(`${label}：同步请求失败：${errText}`);
          }
        } finally {
          await pollLogs();
        }
      }

      if (failed === 0) {
        const extra = skipped > 0 ? `（跳过正在同步的 ${skipped} 个账号）` : '';
        message.open({
          key: msgKey,
          type: 'success',
          content: `已完成：${ok} 个账号同步${extra}`,
        });
      } else {
        message.open({
          key: msgKey,
          type: 'warning',
          content: `已完成：成功 ${ok}，失败 ${failed}`,
        });
      }
    } finally {
      setTriggeringAll(false);
    }
  };

  const popoverWidth = compact
    ? 'min(360px, calc(100vw - 24px))'
    : 360;

  const popoverContent = (
    <div style={{ width: popoverWidth }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Text strong>同步状态</Text>
        <Space size={6} wrap>
          <Button
            type="primary"
            size="small"
            icon={<SyncOutlined />}
            loading={triggeringAll}
            onClick={handleSyncAllNow}
          >
            现在同步
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={triggeringAll}
            onClick={handleRefresh}
          >
            刷新
          </Button>
          <Link to="/sync-logs">
            <Button type="link" size="small" icon={<HistoryOutlined />}>
              查看记录
            </Button>
          </Link>
        </Space>
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
          icon={runningCount > 0 ? <SyncOutlined spin /> : <SyncOutlined />}
          aria-label="同步"
        >
          {!compact && '同步'}
        </Button>
      </Badge>
    </Popover>
  );
}
