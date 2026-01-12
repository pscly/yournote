import { useCallback, useEffect, useMemo, useState } from 'react';
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

async function runInPool(items, poolSize, worker) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(poolSize) || 1);
  const results = new Array(list.length);

  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(size, list.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= list.length) return;
      nextIndex += 1;

      try {
        const value = await worker(list[currentIndex], currentIndex);
        results[currentIndex] = { status: 'fulfilled', value };
      } catch (reason) {
        results[currentIndex] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
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

  const accountOptions = useMemo(() => {
    return (accounts || []).map(a => {
      const name = a?.user_name || a?.nideriji_userid || a?.email || `账号${a?.id}`;
      const lastDiaryTs = a?.last_diary_ts;
      const lastDiaryText = lastDiaryTs ? formatBeijingDateTimeFromTs(lastDiaryTs) : '暂无';
      const label = `${name}（账号ID: ${a?.id} / 用户ID: ${a?.nideriji_userid} / 最近日记: ${lastDiaryText}）`;
      return { label, value: a.id };
    });
  }, [accounts]);

  const allAccountIds = useMemo(() => (accounts || []).map(a => a?.id).filter(Boolean), [accounts]);
  const selectedSet = useMemo(() => new Set(selectedAccountIds || []), [selectedAccountIds]);
  const checkAll = selectedAccountIds.length > 0 && selectedAccountIds.length === allAccountIds.length;
  const indeterminate = selectedAccountIds.length > 0 && selectedAccountIds.length < allAccountIds.length;

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
      message.warning('日记内容不能为空');
      return;
    }
    if (!selectedAccountIds || selectedAccountIds.length === 0) {
      message.warning('请至少勾选一个账号');
      return;
    }

    const accountCount = selectedAccountIds.length;
    Modal.confirm({
      title: '确认发布',
      content: `将把 ${date} 的日记发布/更新到 ${accountCount} 个账号。是否继续？`,
      okText: '发布',
      cancelText: '取消',
      onOk: async () => {
        setPublishing(true);
        try {
          // 1) 先创建 run（仅落库，不执行发布），确保后续逐账号请求都能归并到同一次 run
          const runRes = await publishDiaryAPI.createRun({
            date,
            content,
            account_ids: selectedAccountIds,
            save_draft: true,
          });
          const run = runRes?.data;
          if (!run?.id) {
            throw new Error('后端未返回 run_id，无法继续发布');
          }

          const targetAccountIds =
            Array.isArray(run?.target_account_ids) && run.target_account_ids.length > 0
              ? run.target_account_ids
              : selectedAccountIds;

          // 2) 打开结果弹窗：优先展示 run，再逐个更新每个账号的状态
          setRunModalOpen(true);
          setRunDetail(run || null);
          setDraftUpdatedAt(null);
          writeLocalLastSelection(targetAccountIds);

          // 兜底：若后端未返回 items，则用本地 accounts 生成一份“待发布”占位列表
          setRunDetail((prev) => {
            const base = prev || run;
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

          const upsertItem = (patch) => {
            if (!patch || !patch.account_id) return;
            setRunDetail((prev) => {
              if (!prev) return prev;
              const prevItems = Array.isArray(prev.items) ? prev.items : [];
              const nextItems = [...prevItems];
              const index = nextItems.findIndex((i) => i.account_id === patch.account_id);
              if (index >= 0) {
                nextItems[index] = { ...nextItems[index], ...patch };
              } else {
                nextItems.push(patch);
              }
              return { ...prev, items: nextItems };
            });
          };

          // 3) 并行逐账号发布（带并发上限，避免一次性请求太多导致不稳定）
          const concurrency = Math.min(DEFAULT_PUBLISH_CONCURRENCY, targetAccountIds.length || 1);
          const results = await runInPool(targetAccountIds, concurrency, async (accountId) => {
            upsertItem({ account_id: accountId, status: 'running', error_message: null });
            const itemRes = await publishDiaryAPI.publishOne(run.id, { account_id: accountId });
            const item = itemRes?.data;
            if (item?.account_id) {
              upsertItem(item);
              return item;
            }
            const fallback = { account_id: accountId, status: 'failed', error_message: '后端返回为空' };
            upsertItem(fallback);
            return fallback;
          });

          // 4) 处理“请求级失败”（例如网络中断/被浏览器取消）
          results.forEach((r, index) => {
            if (!r || r.status !== 'rejected') return;
            const accountId = targetAccountIds[index];
            const detail =
              r.reason?.response?.data?.detail || r.reason?.message || String(r.reason || '请求失败');
            upsertItem({ account_id: accountId, status: 'failed', error_message: `请求失败: ${detail}` });
          });

          // 5) 兜底：再拉一次 run，确保结果与后端落库一致（同时尽量保留本地“请求失败”信息）
          try {
            const finalRes = await publishDiaryAPI.getRun(run.id);
            const finalRun = finalRes?.data;
            if (finalRun?.id) {
              setRunDetail((prev) => {
                if (!prev) return finalRun;

                const prevByAccountId = new Map(
                  (Array.isArray(prev.items) ? prev.items : []).map((i) => [i.account_id, i]),
                );
                const serverItems = Array.isArray(finalRun.items) ? finalRun.items : [];
                const mergedItems = serverItems.map((serverItem) => {
                  const localItem = prevByAccountId.get(serverItem.account_id);
                  if (!localItem) return serverItem;
                  // 仅当服务端还没给出结果时，保留本地“请求失败”提示
                  if (
                    (serverItem.status === 'unknown' || serverItem.status === 'running') &&
                    localItem.status === 'failed' &&
                    localItem.error_message
                  ) {
                    return { ...serverItem, status: 'failed', error_message: localItem.error_message };
                  }
                  return serverItem;
                });
                return { ...finalRun, items: mergedItems };
              });
            }
          } catch {
            // 拉取最终结果失败不影响已展示的逐账号状态
          }

          // 6) 刷新历史列表 + 结果提示
          loadRuns(date);
          const okCount = results.filter((r) => r?.status === 'fulfilled' && r?.value?.status === 'success').length;
          const failedCount = targetAccountIds.length - okCount;
          if (failedCount > 0) {
            message.warning(`发布完成：成功 ${okCount}，失败 ${failedCount}（可在“发布结果”里查看明细）`);
          } else {
            message.success(`发布完成：成功 ${okCount}`);
          }
        } catch (error) {
          const detail = error?.response?.data?.detail;
          message.error('发布失败: ' + (detail || error?.message || String(error)));
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!date) return;
    loadDraft(date);
    loadRuns(date);
  }, [date]);

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
    { title: '日记ID', dataIndex: 'nideriji_diary_id', key: 'nideriji_diary_id', width: 120, render: (v) => v || '-' },
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
              <Tag color="geekblue">日记ID {r?.nideriji_diary_id || '-'}</Tag>
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
          <Title level={3} style={{ margin: 0 }}>一键发布日记</Title>      
          <Text type="secondary">草稿/发布历史独立存储，不会和“采集日记列表”混在一起。</Text>
        </div>

        {(accounts || []).length === 0 && !accountsLoading && (
          <Alert
            type="warning"
            showIcon
            message="还没有可用账号"
            description="请先到「账号管理」添加至少一个账号，才能发布日记。"
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

                  <Card size="small" title="日记内容（发布/更新）">
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
                          disabled={draftLoading || savingDraft}
                          block={isMobile}
                        >
                          发布到所选账号
                        </Button>
                        <Button onClick={() => loadRuns(date)} loading={runsLoading} block={isMobile}>刷新历史</Button>
                      </Space>
                    </Space>
                  </Card>

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
        onCancel={() => setRunModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRunModalOpen(false)}>关闭</Button>,
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
              description="发布接口是“发布或更新”，同一天再次发布会更新该日记。"
            />
            {isMobile ? runDetailListNode : runDetailTableNode}
          </Space>
        )}
      </Modal>
    </Page>
  );
}
