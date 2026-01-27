import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Grid, Input, List, message, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ReloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { accountAPI, publishDiaryAPI } from '../services/api';
import Page from '../components/Page';
import { formatBeijingDateTime, formatBeijingDateTimeFromTs } from '../utils/time';

const { Title, Text } = Typography;
const { TextArea } = Input;

const LAST_SELECTION_KEY = 'yournote_publish_diary_last_account_ids';
const DEFAULT_PUBLISH_CONCURRENCY = 5;

function readLocalLastSelection() {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(v => Number.isInteger(v));
  } catch {
    return [];
  }
}

function writeLocalLastSelection(ids) {
  try {
    const list = Array.isArray(ids) ? ids.filter(v => Number.isInteger(v)) : [];
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(list));
  } catch {
    // localStorage 失败不影响业务
  }
}

async function getDefaultSelectionFromLastRun(accountList) {
  const existingIds = (accountList || []).map(a => a?.id).filter(Boolean);
  if (existingIds.length === 0) return [];

  const filterExisting = (ids) => {
    const set = new Set(existingIds);
    return (ids || []).filter(id => set.has(id));
  };

  // 1) 优先从后端“上次发布记录”读取账号组合
  try {
    const res = await publishDiaryAPI.listRuns({ limit: 1 });
    const last = res?.data?.[0];
    const ids = filterExisting(last?.target_account_ids || []);
    if (ids.length > 0) return ids;
  } catch {
    // 失败则走本地回退
  }

  // 2) 回退：使用本地缓存的“上次选择账号”
  const localIds = filterExisting(readLocalLastSelection());
  if (localIds.length > 0) return localIds;

  // 3) 兜底：全选
  return existingIds;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateYYYYMMDDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatBeijingDateYYYYMMDD(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !day) return '';
    return `${y}-${m}-${day}`;
  } catch {
    // 极少数环境 Intl 不可用时，退回浏览器本地时区
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
}

function todayStr() {
  return formatBeijingDateYYYYMMDD(new Date());
}

function yesterdayStr() {
  const now = new Date();
  return formatBeijingDateYYYYMMDD(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

function parseDateYYYYMMDD(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  // 用 UTC 解析“纯日期”，避免不同时区/DST 引起的 +/-1 天问题
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function shiftDateStr(value, deltaDays) {
  const base = parseDateYYYYMMDD(value) || parseDateYYYYMMDD(todayStr());
  const days = Number(deltaDays) || 0;
  if (!base) return todayStr();
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateYYYYMMDDUTC(base);
}

export default function PublishDiary() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens?.md;

  const [activeTab, setActiveTab] = useState('edit'); // edit | history

  const [date, setDate] = useState(() => todayStr());
  const [content, setContent] = useState('');
  const [draftUpdatedAt, setDraftUpdatedAt] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);

  const [draftLoading, setDraftLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetail, setRunDetail] = useState(null);

  // 当前“后台发布”的 run（进度状态）。
  // 注意：必须与 runDetail（弹窗里查看的某次 run 详情）解耦，避免用户查看其它 run 时被后台更新覆盖。
  const [activePublishRun, setActivePublishRun] = useState(null);
  const [publishPanelOpen, setPublishPanelOpen] = useState(true);
  const publishMsgKeyRef = useRef(null);
  const publishPollTimerRef = useRef(null);

  const accountOptions = useMemo(() => {
    return (accounts || []).map(a => {
      const name = a?.user_name || a?.nideriji_userid || a?.email || `账号${a?.id}`;
      const lastDiaryTs = a?.last_diary_ts;
      const lastDiaryText = lastDiaryTs ? formatBeijingDateTimeFromTs(lastDiaryTs) : '暂无';
      const label = `${name}（账号ID: ${a?.id} / 用户ID: ${a?.nideriji_userid} / 最近记录: ${lastDiaryText}）`;
      return { label, value: a.id };
    });
  }, [accounts]);

  const allAccountIds = useMemo(() => (accounts || []).map(a => a?.id).filter(Boolean), [accounts]);
  const selectedSet = useMemo(() => new Set(selectedAccountIds || []), [selectedAccountIds]);
  const checkAll = selectedAccountIds.length > 0 && selectedAccountIds.length === allAccountIds.length;
  const indeterminate = selectedAccountIds.length > 0 && selectedAccountIds.length < allAccountIds.length;

  const publishProgress = useMemo(() => {
    const run = activePublishRun;
    const items = Array.isArray(run?.items) ? run.items : [];
    const targetTotal = Array.isArray(run?.target_account_ids) ? run.target_account_ids.length : 0;
    const total = Math.max(items.length, targetTotal);

    let success = 0;
    let failed = 0;
    let running = 0;
    let unknown = 0;

    items.forEach((i) => {
      const s = i?.status;
      if (s === 'success') success += 1;
      else if (s === 'failed') failed += 1;
      else if (s === 'running') running += 1;
      else unknown += 1;
    });

    if (items.length === 0 && total > 0) unknown = total;
    const done = success + failed;

    return { total, success, failed, running, unknown, done };
  }, [activePublishRun]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await accountAPI.list();
      const list = res?.data || [];
      setAccounts(list);

      // 规则：
      // - 如果用户已手动勾选过（prev 非空）：不打扰，仅做“过滤不存在账号”
      // - 如果还没勾选（prev 为空）：默认选中“上次发布的账号组合”，无记录时再全选
      setSelectedAccountIds(prev => {
        if (Array.isArray(prev) && prev.length > 0) {
          return prev.filter(id => list.some(a => a.id === id));
        }
        // 临时返回空，避免先全选再闪一下；真正默认值异步设置
        return [];
      });

      const defaultIds = await getDefaultSelectionFromLastRun(list);
      setSelectedAccountIds(prev => (Array.isArray(prev) && prev.length > 0 ? prev : defaultIds));
    } catch (error) {
      message.error('加载账号失败: ' + (error?.message || String(error)));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadDraft = async (targetDate) => {
    if (!targetDate) return;
    setDraftLoading(true);
    try {
      const res = await publishDiaryAPI.getDraft(targetDate);
      setContent(res?.data?.content ?? '');
      setDraftUpdatedAt(res?.data?.updated_at ?? null);
    } catch (error) {
      message.error('加载草稿失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
      setContent('');
      setDraftUpdatedAt(null);
    } finally {
      setDraftLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!date) {
      message.warning('请先选择日期');
      return;
    }
    setSavingDraft(true);
    try {
      const res = await publishDiaryAPI.saveDraft(date, { content });
      setDraftUpdatedAt(res?.data?.updated_at ?? null);
      message.success('草稿已保存');
    } catch (error) {
      message.error('保存草稿失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setSavingDraft(false);
    }
  };

  const loadRuns = async (targetDate) => {
    setRunsLoading(true);
    try {
      const res = await publishDiaryAPI.listRuns({ date: targetDate || undefined, limit: 50 });
      setRuns(res?.data || []);
    } catch (error) {
      message.error('加载发布历史失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunsLoading(false);
    }
  };

  const openRunDetail = async (runId) => {
    setRunModalOpen(true);
    setRunDetail(null);
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      setRunDetail(res?.data || null);
    } catch (error) {
      message.error('加载发布详情失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
      setRunDetail(null);
    } finally {
      setRunDetailLoading(false);
    }
  };

  const refreshRunDetail = async (runId) => {
    if (!runId) return;
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      setRunDetail(res?.data || null);
    } catch (error) {
      message.error('刷新发布详情失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunDetailLoading(false);
    }
  };

  const loadRunContentIntoEditor = async (runId) => {
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      const run = res?.data;
      if (!run?.date) {
        message.warning('发布记录缺少日期，无法载入');
        return;
      }
      setDate(run.date);
      setContent(run?.content ?? '');
      setDraftUpdatedAt(null);
      setActiveTab('edit');
      message.success('已载入发布内容，可继续修改后再发布');
    } catch (error) {
      message.error('载入失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunDetailLoading(false);
    }
  };

  const publish = async () => {
    if (!date) {
      message.warning('请先选择日期');
      return;
    }
    if (!content || !content.trim()) {
      message.warning('记录内容不能为空');
      return;
    }
    if (!selectedAccountIds || selectedAccountIds.length === 0) {
      message.warning('请至少勾选一个账号');
      return;
    }

    if (publishing) {
      message.warning('正在发布中，请稍候…');
      return;
    }

    const publishDate = date;
    const publishContent = content;
    const publishAccountIds = [...selectedAccountIds];

    // 清理上一轮轮询计时器（避免并发轮询）
    if (publishPollTimerRef.current) {
      clearTimeout(publishPollTimerRef.current);
      publishPollTimerRef.current = null;
    }

    setPublishing(true);
    const msgKey = `publish-${Date.now()}`;
    publishMsgKeyRef.current = msgKey;
    message.open({
      key: msgKey,
      type: 'loading',
      content: '已开始后台发布…你可以刷新/关闭页面，后端仍会继续发布',
      duration: 0,
    });

    try {
      // 1) 创建 run（落库 + 创建 items），不做实际发布
      const runRes = await publishDiaryAPI.createRun({
        date: publishDate,
        content: publishContent,
        account_ids: publishAccountIds,
        save_draft: true,
      });
      const run = runRes?.data;
      if (!run?.id) {
        throw new Error('后端未返回 run_id，无法继续发布');
      }

      const targetAccountIds =
        Array.isArray(run?.target_account_ids) && run.target_account_ids.length > 0
          ? run.target_account_ids
          : publishAccountIds;

      setActivePublishRun(run || null);
      setPublishPanelOpen(true);
      setDraftUpdatedAt(null);
      writeLocalLastSelection(targetAccountIds);
      loadRuns(publishDate);

      // 兜底：若后端未返回 items，则用本地 accounts 生成一份“待发布”占位列表
      setActivePublishRun((prev) => {
        const base = prev || run;
        if (!base || base?.id !== run.id) return prev;
        const existingItems = Array.isArray(base?.items) ? base.items : [];
        if (existingItems.length > 0) return base;

        const byId = new Map((accounts || []).map((acc) => [acc.id, acc]));
        const placeholders = targetAccountIds.map((accountId) => {
          const acc = byId.get(accountId);
          return {
            account_id: accountId,
            nideriji_userid: acc?.nideriji_userid ?? 0,
            status: 'unknown',
            nideriji_diary_id: null,
            error_message: null,
          };
        });
        return { ...base, items: placeholders };
      });

      // 2) 启动后端后台任务：前端不再逐账号请求 publish-one
      const concurrency = Math.min(DEFAULT_PUBLISH_CONCURRENCY, targetAccountIds.length || 1);
      const startRes = await publishDiaryAPI.startRun(run.id, { concurrency });
      const alreadyRunning = Boolean(startRes?.data?.already_running);

      message.open({
        key: msgKey,
        type: 'loading',
        content: alreadyRunning
          ? `后台发布已在运行（Run #${run.id}）…（页面内会显示进度）`
          : `后台发布已启动（Run #${run.id}）…（页面内会显示进度）`,
        duration: 0,
      });
    } catch (error) {
      const detail = error?.response?.data?.detail;
      message.open({
        key: msgKey,
        type: 'error',
        content: '发布失败: ' + (detail || error?.message || String(error)),
        duration: 6,
      });
      publishMsgKeyRef.current = null;
      setPublishing(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 刷新/重进页面后：自动恢复仍在进行中的后台发布（避免用户必须手动翻历史）。
  useEffect(() => {
    let cancelled = false;

    const tryResume = async () => {
      try {
        // 仅做 best-effort：不阻塞页面渲染
        const res = await publishDiaryAPI.listRuns({ limit: 10 });
        const list = Array.isArray(res?.data) ? res.data : [];
        const nowMs = Date.now();

        const candidate = list.find((r) => {
          const total = r?.target_account_ids?.length ?? 0;
          const done = (r?.success_count ?? 0) + (r?.failed_count ?? 0);
          if (!total || done >= total) return false;

          const createdAt = r?.created_at;
          if (createdAt) {
            const createdMs = new Date(createdAt).getTime();
            // 只恢复“近期”的未完成 run，避免误把很久以前的残留记录当成进行中
            if (Number.isFinite(createdMs) && nowMs - createdMs > 6 * 60 * 60 * 1000) return false;
          }

          return true;
        });

        if (!candidate?.id) return;

        const runRes = await publishDiaryAPI.getRun(candidate.id);
        const run = runRes?.data;
        if (cancelled) return;
        if (!run?.id) return;

        setActivePublishRun(run);
        setPublishPanelOpen(true);

        const items = Array.isArray(run.items) ? run.items : [];
        const targetTotal = Array.isArray(run.target_account_ids) ? run.target_account_ids.length : items.length;
        const success = items.filter((i) => i?.status === 'success').length;
        const failed = items.filter((i) => i?.status === 'failed').length;
        const running = items.filter((i) => i?.status === 'running').length;
        const done = success + failed;

        const createdAt = run?.created_at || candidate?.created_at;
        const createdMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
        const ageMs = Number.isFinite(createdMs) ? nowMs - createdMs : 0;
        const shouldPoll = (targetTotal > 0 && done < targetTotal) && (running > 0 || ageMs < 60 * 1000);

        const key = `publish-resume-${run.id}`;
        publishMsgKeyRef.current = key;
        if (shouldPoll) {
          setPublishing(true);
          message.open({
            key,
            type: 'loading',
            content: `检测到后台发布仍在进行（Run #${run.id}），已自动恢复进度显示…`,
            duration: 0,
          });
        } else {
          setPublishing(false);
          message.open({
            key,
            type: 'warning',
            content: `发现未完成的发布（Run #${run.id}），但未检测到正在发布；可能后端已重启/任务中断（可在“发布历史”查看或重新发布）`,
            duration: 6,
          });
          publishMsgKeyRef.current = null;
        }
      } catch {
        // 自动恢复失败不影响正常使用
      }
    };

    tryResume();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!date) return;
    loadDraft(date);
    loadRuns(date);
  }, [date]);

  useEffect(() => {
    if (!publishing) return;
    if (!activePublishRun?.id) return;

    let cancelled = false;
    const runId = activePublishRun.id;
    let failStreak = 0;

    const poll = async () => {
      if (cancelled) return;

      try {
        const res = await publishDiaryAPI.getRun(runId);
        const run = res?.data;
        if (cancelled) return;

        if (run?.id) {
          setActivePublishRun(run);

          const items = Array.isArray(run.items) ? run.items : [];
          const targetTotal = Array.isArray(run.target_account_ids) ? run.target_account_ids.length : items.length;
          const success = items.filter((i) => i?.status === 'success').length;
          const failed = items.filter((i) => i?.status === 'failed').length;
          const done = success + failed;

          if (targetTotal > 0 && done >= targetTotal) {
            setPublishing(false);
            loadRuns(run?.date);

            const key = publishMsgKeyRef.current;
            if (key) {
              if (failed > 0) {
                message.open({
                  key,
                  type: 'warning',
                  content: `后台发布完成：成功 ${success}，失败 ${failed}（可在“发布历史”查看明细）`,
                  duration: 6,
                });
              } else {
                message.open({
                  key,
                  type: 'success',
                  content: `后台发布完成：成功 ${success}（可在“发布历史”查看明细）`,
                  duration: 4,
                });
              }
              publishMsgKeyRef.current = null;
            } else if (failed > 0) {
              message.warning(`后台发布完成：成功 ${success}，失败 ${failed}`);
            } else {
              message.success(`后台发布完成：成功 ${success}`);
            }
            return;
          }
        }

        failStreak = 0;
      } catch {
        failStreak += 1;
      }

      const delayMs = failStreak >= 3 ? 5000 : 2000;
      publishPollTimerRef.current = setTimeout(poll, delayMs);
    };

    poll();

    return () => {
      cancelled = true;
      if (publishPollTimerRef.current) {
        clearTimeout(publishPollTimerRef.current);
        publishPollTimerRef.current = null;
      }
    };
  }, [publishing, activePublishRun?.id]);

  const runItemColumns = [
    { title: '账号ID', dataIndex: 'account_id', key: 'account_id', width: 90 },
    { title: '用户ID', dataIndex: 'nideriji_userid', key: 'nideriji_userid', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (val) => {
        if (val === 'success') return <Tag color="green">成功</Tag>;
        if (val === 'failed') return <Tag color="red">失败</Tag>;
        if (val === 'running') return <Tag color="blue">发布中</Tag>;
        if (val === 'unknown') return <Tag>待发布</Tag>;
        return <Tag>未知</Tag>;
      },
    },
    { title: '记录ID', dataIndex: 'nideriji_diary_id', key: 'nideriji_diary_id', width: 120, render: (v) => v || '-' },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', render: (v) => v || '-' },
  ];

  const runColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90 },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    {
      title: '账号数',
      key: 'accounts',
      width: 90,
      render: (_, r) => (r?.target_account_ids?.length ?? 0),
    },
    { title: '成功', dataIndex: 'success_count', key: 'success_count', width: 80 },
    { title: '失败', dataIndex: 'failed_count', key: 'failed_count', width: 80 },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v) => {
        return formatBeijingDateTime(v);
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openRunDetail(r.id)}>查看</Button>
          <Button size="small" onClick={() => loadRunContentIntoEditor(r.id)}>载入内容</Button>
        </Space>
      ),
    },
  ];

  const runStatusTag = (status) => {
    if (status === 'success') return <Tag color="green">成功</Tag>;
    if (status === 'failed') return <Tag color="red">失败</Tag>;
    if (status === 'running') return <Tag color="blue">发布中</Tag>;
    if (status === 'unknown') return <Tag>待发布</Tag>;
    return <Tag>未知</Tag>;
  };

  const runListNode = (
    <List
      dataSource={runs}
      loading={runsLoading}
      locale={{ emptyText: '暂无发布记录' }}
      renderItem={(r) => (
        <Card
          hoverable
          style={{ marginBottom: 12 }}
          bodyStyle={{ padding: 14 }}
          onClick={() => openRunDetail(r.id)}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag color="blue">Run #{r?.id ?? '-'}</Tag>
              <Tag color="purple">{r?.date || '-'}</Tag>
              <Tag color="geekblue">{r?.target_account_ids?.length ?? 0} 个账号</Tag>
              <Tag color="green">成功 {r?.success_count ?? 0}</Tag>
              <Tag color="red">失败 {r?.failed_count ?? 0}</Tag>
            </Space>
            <Text type="secondary">时间：{formatBeijingDateTime(r?.created_at)}</Text>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openRunDetail(r.id);
                }}
                block
              >
                查看
              </Button>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  loadRunContentIntoEditor(r.id);
                }}
                block
              >
                载入内容
              </Button>
            </Space>
          </Space>
        </Card>
      )}
    />
  );

  const runTableNode = (
    <Table
      rowKey="id"
      size="small"
      loading={runsLoading}
      columns={runColumns}
      dataSource={runs}
      pagination={false}
    />
  );

  const runDetailListNode = (
    <List
      dataSource={runDetail?.items || []}
      locale={{ emptyText: '暂无发布明细' }}
      renderItem={(r) => (
        <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 14 }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag color="blue">账号ID {r?.account_id ?? '-'}</Tag>
              <Tag color="purple">用户ID {r?.nideriji_userid ?? '-'}</Tag>
              {runStatusTag(r?.status)}
              <Tag color="geekblue">记录ID {r?.nideriji_diary_id || '-'}</Tag>
            </Space>
            {r?.error_message ? (
              <Text
                type="danger"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                {r.error_message}
              </Text>
            ) : (
              <Text type="secondary">无错误信息</Text>
            )}
          </Space>
        </Card>
      )}
    />
  );

  const runDetailTableNode = (
    <Table
      rowKey={(r) => `${r.account_id}-${r.nideriji_userid}`}
      size="small"
      columns={runItemColumns}
      dataSource={runDetail?.items || []}
      pagination={false}
    />
  );

  return (
    <Page maxWidth={1200}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>     
        <div>
          <Title level={3} style={{ margin: 0 }}>一键发布记录</Title>      
          <Text type="secondary">草稿/发布历史独立存储，不会和“采集记录列表”混在一起。</Text>
        </div>

        {(accounts || []).length === 0 && !accountsLoading && (
          <Alert
            type="warning"
            showIcon
            message="还没有可用账号"
            description="请先到「账号管理」添加至少一个账号，才能发布记录。"
          />
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'edit',
              label: '编辑/发布',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" title="选择日期">
                    {isMobile ? (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          style={{ width: '100%' }}
                        />
                        <Space wrap>
                          <Button onClick={() => setDate(todayStr())}>今天</Button>
                          <Button onClick={() => setDate(yesterdayStr())}>昨天</Button>
                          <Button onClick={() => setDate((prev) => shiftDateStr(prev, -1))}>上一天</Button>
                          <Button onClick={() => setDate((prev) => shiftDateStr(prev, 1))}>下一天</Button>
                        </Space>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => loadDraft(date)}
                          loading={draftLoading}
                          block
                        >
                          重新加载草稿
                        </Button>
                        <Text type="secondary">
                          {draftUpdatedAt ? `草稿更新时间：${formatBeijingDateTime(draftUpdatedAt)}` : '草稿尚未保存'}
                        </Text>
                      </Space>
                    ) : (
                      <Space wrap>
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          style={{ width: 170 }}
                        />
                        <Button onClick={() => setDate(todayStr())}>今天</Button>
                        <Button onClick={() => setDate(yesterdayStr())}>昨天</Button>
                        <Button onClick={() => setDate((prev) => shiftDateStr(prev, -1))}>上一天</Button>
                        <Button onClick={() => setDate((prev) => shiftDateStr(prev, 1))}>下一天</Button>
                        <Button icon={<ReloadOutlined />} onClick={() => loadDraft(date)} loading={draftLoading}>重新加载草稿</Button>
                        <Text type="secondary">
                          {draftUpdatedAt ? `草稿更新时间：${formatBeijingDateTime(draftUpdatedAt)}` : '草稿尚未保存'}
                        </Text>
                      </Space>
                    )}
                  </Card>

                  <Card size="small" title="记录内容（发布/更新）">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <TextArea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={'例如：\n[15:53]\n今天发生了什么…'}
                        autoSize={{ minRows: 10, maxRows: 24 }}
                      />
                      <Space
                        wrap
                        direction={isMobile ? 'vertical' : 'horizontal'}
                        style={{ width: isMobile ? '100%' : undefined }}
                      >
                        <Button
                          icon={<SaveOutlined />}
                          onClick={saveDraft}
                          loading={savingDraft}
                          disabled={draftLoading || publishing}
                          block={isMobile}
                        >
                          保存草稿
                        </Button>
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={publish}
                          loading={publishing}
                          disabled={draftLoading || savingDraft || publishing}
                          block={isMobile}
                        >
                          发布到所选账号
                        </Button>
                        <Button onClick={() => loadRuns(date)} loading={runsLoading} block={isMobile}>刷新历史</Button>
                      </Space>
                    </Space>
                  </Card>

                  {publishPanelOpen && activePublishRun?.id && (
                    <Card
                      size="small"
                      title={publishing ? `后台发布进度（Run #${activePublishRun.id}）` : `最近一次发布（Run #${activePublishRun.id}）`}
                      extra={(
                        <Space wrap>
                          <Button size="small" onClick={() => openRunDetail(activePublishRun.id)}>
                            查看明细
                          </Button>
                          <Button size="small" onClick={() => setPublishPanelOpen(false)}>
                            关闭提示
                          </Button>
                        </Space>
                      )}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                          <Tag color="blue">已完成 {publishProgress.done}/{publishProgress.total}</Tag>
                          <Tag color="green">成功 {publishProgress.success}</Tag>
                          <Tag color="red">失败 {publishProgress.failed}</Tag>
                          <Tag color="geekblue">进行中 {publishProgress.running}</Tag>
                          <Tag>待发布 {publishProgress.unknown}</Tag>
                        </Space>
                        <Text type="secondary">
                          {publishing ? '发布正在后台进行，你可以继续操作或切换页面。' : '发布已结束，可在“发布历史”查看记录。'}
                        </Text>
                      </Space>
                    </Card>
                  )}

                  <Card
                    size="small"
                    title="选择发布账号"
                    extra={(
                      <Button icon={<ReloadOutlined />} onClick={loadAccounts} loading={accountsLoading}>
                        刷新账号
                      </Button>
                    )}
                  >
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Checkbox
                        indeterminate={indeterminate}
                        checked={checkAll}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const next = checked ? allAccountIds : [];
                          setSelectedAccountIds(next);
                          writeLocalLastSelection(next);
                        }}
                        disabled={accountsLoading || allAccountIds.length === 0}
                      >
                        全选（{selectedAccountIds.length}/{allAccountIds.length}）
                      </Checkbox>

                      <Checkbox.Group
                        style={{ width: '100%' }}
                        value={selectedAccountIds}
                        onChange={(vals) => {
                          setSelectedAccountIds(vals);
                          writeLocalLastSelection(vals);
                        }}
                        options={accountOptions}
                        disabled={accountsLoading}
                      />

                      {(accounts || []).some(a => selectedSet.has(a.id) && a?.token_status?.checked_at && !a?.token_status?.is_valid) && (
                        <Alert
                          type="warning"
                          showIcon
                          message="部分账号 Token 可能已失效"
                          description="发布时会尝试发布；若账号保存了密码，后端会自动重新登录刷新 token。否则请到「账号管理」更新 token。"
                        />
                      )}
                    </Space>
                  </Card>

                  <Card size="small" title="当天发布历史（快速查看）">
                    {isMobile ? runListNode : runTableNode}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'history',
              label: '发布历史',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" title="按日期筛选">
                    <Space
                      wrap
                      direction={isMobile ? 'vertical' : 'horizontal'}
                      style={{ width: isMobile ? '100%' : undefined }}
                    >
                      <Input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        style={{ width: isMobile ? '100%' : 170 }}
                      />
                      <Button
                        onClick={() => loadRuns(date)}
                        icon={<ReloadOutlined />}
                        loading={runsLoading}
                        block={isMobile}
                      >
                        刷新
                      </Button>
                      <Text type="secondary">提示：点击“载入内容”可把历史发布内容带回编辑器继续更新。</Text>
                    </Space>
                  </Card>

                  <Card size="small" title="发布记录">
                    {isMobile ? runListNode : runTableNode}
                  </Card>
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title={runDetail?.id ? `发布结果（Run #${runDetail.id}）` : '发布结果'}
        open={runModalOpen}
        mask={false}
        onCancel={() => setRunModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRunModalOpen(false)}>关闭</Button>,
          runDetail?.id ? (
            <Button key="refresh" onClick={() => refreshRunDetail(runDetail.id)} loading={runDetailLoading}>
              刷新
            </Button>
          ) : null,
          runDetail?.id ? (
            <Button key="load" onClick={() => loadRunContentIntoEditor(runDetail.id)} loading={runDetailLoading}>
              载入内容到编辑器
            </Button>
          ) : null,
        ].filter(Boolean)}
        width={isMobile ? 'calc(100vw - 24px)' : 900}
      >
        {runDetailLoading && <Text type="secondary">加载中...</Text>}
        {!runDetailLoading && !runDetail && <Text type="secondary">暂无数据</Text>}
        {!runDetailLoading && runDetail && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={`日期：${runDetail.date}；目标账号：${runDetail?.target_account_ids?.length ?? 0} 个`}
              description="发布接口是“发布或更新”，同一天再次发布会更新该记录。"
            />
            {isMobile ? runDetailListNode : runDetailTableNode}
          </Space>
        )}
      </Modal>
    </Page>
  );
}
