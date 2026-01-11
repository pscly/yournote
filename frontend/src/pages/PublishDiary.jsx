import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Grid, Input, message, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ReloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { accountAPI, publishDiaryAPI } from '../services/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateYYYYMMDD(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
  return formatDateYYYYMMDD(new Date());
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDateYYYYMMDD(d);
}

function parseDateYYYYMMDD(value) {
  const raw = String(value || '').trim();
  const parts = raw.split('-').map(v => Number.parseInt(v, 10));
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // 使用本地时区构造，避免 new Date('YYYY-MM-DD') 的 UTC 解析差异
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function shiftDateStr(value, deltaDays) {
  const base = parseDateYYYYMMDD(value) || new Date();
  base.setDate(base.getDate() + (Number(deltaDays) || 0));
  return formatDateYYYYMMDD(base);
}

export default function PublishDiary() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;

  const LAST_SELECTION_KEY = 'yournote_publish_diary_last_account_ids';

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
      const label = `${name}（账号ID: ${a?.id} / 用户ID: ${a?.nideriji_userid}）`;
      return { label, value: a.id };
    });
  }, [accounts]);

  const allAccountIds = useMemo(() => (accounts || []).map(a => a?.id).filter(Boolean), [accounts]);
  const selectedSet = useMemo(() => new Set(selectedAccountIds || []), [selectedAccountIds]);
  const checkAll = selectedAccountIds.length > 0 && selectedAccountIds.length === allAccountIds.length;
  const indeterminate = selectedAccountIds.length > 0 && selectedAccountIds.length < allAccountIds.length;

  const readLocalLastSelection = () => {
    try {
      const raw = localStorage.getItem(LAST_SELECTION_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data.filter(v => Number.isInteger(v));
    } catch {
      return [];
    }
  };

  const writeLocalLastSelection = (ids) => {
    try {
      const list = Array.isArray(ids) ? ids.filter(v => Number.isInteger(v)) : [];
      localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(list));
    } catch {
      // localStorage 失败不影响业务
    }
  };

  const getDefaultSelectionFromLastRun = async (accountList) => {
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
  };

  const loadAccounts = async () => {
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
  };

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
          const res = await publishDiaryAPI.publish({
            date,
            content,
            account_ids: selectedAccountIds,
            save_draft: true,
          });
          const run = res?.data;
          message.success('发布完成');
          setRunDetail(run || null);
          setRunModalOpen(true);
          loadRuns(date);
          setDraftUpdatedAt(null);
          if (run?.target_account_ids?.length) {
            writeLocalLastSelection(run.target_account_ids);
          } else {
            writeLocalLastSelection(selectedAccountIds);
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
  }, []);

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
        if (!v) return '-';
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return String(v);
        return d.toLocaleString();
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

  return (
    <div style={{ padding: pagePadding, maxWidth: 1200, margin: '0 auto' }}>
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
                        {draftUpdatedAt ? `草稿更新时间：${new Date(draftUpdatedAt).toLocaleString()}` : '草稿尚未保存'}
                      </Text>
                    </Space>
                  </Card>

                  <Card size="small" title="日记内容（发布/更新）">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <TextArea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={'例如：\n[15:53]\n今天发生了什么…'}
                        autoSize={{ minRows: 10, maxRows: 24 }}
                      />
                      <Space wrap>
                        <Button
                          icon={<SaveOutlined />}
                          onClick={saveDraft}
                          loading={savingDraft}
                          disabled={draftLoading || publishing}
                        >
                          保存草稿
                        </Button>
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={publish}
                          loading={publishing}
                          disabled={draftLoading || savingDraft}
                        >
                          发布到所选账号
                        </Button>
                        <Button onClick={() => loadRuns(date)} loading={runsLoading}>刷新历史</Button>
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
                    <Table
                      rowKey="id"
                      size="small"
                      loading={runsLoading}
                      columns={runColumns}
                      dataSource={runs}
                      pagination={false}
                      scroll={isMobile ? { x: 900 } : undefined}
                    />
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
                    <Space wrap>
                      <Input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        style={{ width: 170 }}
                      />
                      <Button onClick={() => loadRuns(date)} icon={<ReloadOutlined />} loading={runsLoading}>
                        刷新
                      </Button>
                      <Text type="secondary">提示：点击“载入内容”可把历史发布内容带回编辑器继续更新。</Text>
                    </Space>
                  </Card>

                  <Card size="small" title="发布记录">
                    <Table
                      rowKey="id"
                      loading={runsLoading}
                      columns={runColumns}
                      dataSource={runs}
                      pagination={false}
                      scroll={isMobile ? { x: 900 } : undefined}
                    />
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
        width={isMobile ? 360 : 900}
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
            <Table
              rowKey={(r) => `${r.account_id}-${r.nideriji_userid}`}
              size="small"
              columns={runItemColumns}
              dataSource={runDetail.items || []}
              pagination={false}
              scroll={isMobile ? { x: 700 } : undefined}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
