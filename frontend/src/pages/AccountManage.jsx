import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Grid, Input, message, Modal, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { accountAPI } from '../services/api';
import { NIDERIJI_TOKEN } from '../config';
import { waitForLatestSyncLog } from '../utils/sync';

const { Title } = Typography;

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

export default function AccountManage() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [tokenAccount, setTokenAccount] = useState(null);
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [form] = Form.useForm();
  const [tokenForm] = Form.useForm();

  useEffect(() => {
    loadAccounts();
  }, []);

  const validateAccounts = async (list) => {
    const ids = (list || []).map(a => a?.id).filter(Boolean);
    if (ids.length === 0) return;

    setCheckingIds(new Set(ids));
    const results = await Promise.allSettled(ids.map(id => accountAPI.validate(id)));

    const statusMap = new Map();
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        statusMap.set(ids[idx], res.value?.data);
      }
    });

    setAccounts(prev => (prev || []).map(a => {
      const tokenStatus = statusMap.get(a.id);
      if (!tokenStatus) return a;
      return { ...a, token_status: tokenStatus };
    }));
    setCheckingIds(new Set());
  };

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const res = await accountAPI.list();
      setAccounts(res.data);
      validateAccounts(res.data);
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const invalidAccounts = useMemo(() => {
    return (accounts || []).filter(a => {
      const s = a?.token_status;
      if (!s) return false;
      if (s.expired) return true;
      if (!s.checked_at) return false;
      return !s.is_valid;
    });
  }, [accounts]);

  const handleOpenAdd = () => {
    form.resetFields();
    setModalVisible(true);
  };

  const handleAdd = async (values) => {
    try {
      const createRes = await accountAPI.create(values);
      const account = createRes?.data;
      message.success('添加成功！');

      setModalVisible(false);
      form.resetFields();
      loadAccounts();

      if (account?.id) {
        const startedAt = Date.now();
        const msgKey = `sync-${account.id}`;
        message.open({ key: msgKey, type: 'loading', content: '后台正在更新中（自动采集日记）...', duration: 0 });

        (async () => {
          const log = await waitForLatestSyncLog(account.id, startedAt, { timeoutMs: 60000 });
          if (!log) {
            message.open({
              key: msgKey,
              type: 'info',
              content: '已开始后台更新（可能需要更久，请稍后在仪表盘/同步记录查看结果）',
            });
            return;
          }

          if (log.status === 'success') {
            message.open({
              key: msgKey,
              type: 'success',
              content: `更新完成：我的日记 ${log.diaries_count ?? '-'} 条，配对日记 ${log.paired_diaries_count ?? '-'} 条`,
            });
            return;
          }

          message.open({
            key: msgKey,
            type: 'warning',
            content: `更新失败：${log.error_message || '未知错误'}`,
          });
        })();
      }
    } catch (error) {
      message.error('添加失败: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await accountAPI.delete(id);
      message.success('删除成功！');
      loadAccounts();
    } catch (error) {
      message.error('删除失败: ' + error.message);
    }
  };

  const openUpdateToken = (record) => {
    setTokenAccount(record);
    tokenForm.resetFields();
    setTokenModalVisible(true);
  };

  const handleUpdateToken = async (values) => {
    const accountId = tokenAccount?.id;
    if (!accountId) return;

    const msgKey = `sync-${accountId}`;
    try {
      message.open({ key: msgKey, type: 'loading', content: '正在更新 Token 并校验...', duration: 0 });
      await accountAPI.updateToken(accountId, values);
      message.open({ key: msgKey, type: 'success', content: 'Token 更新成功，已触发后台同步' });
      setTokenModalVisible(false);
      setTokenAccount(null);
      tokenForm.resetFields();
      loadAccounts();

      (async () => {
        const startedAt = Date.now();
        const log = await waitForLatestSyncLog(accountId, startedAt, { timeoutMs: 15000 });
        if (!log) return;

        if (log.status === 'success') {
          message.open({
            key: msgKey,
            type: 'success',
            content: `更新完成：我的日记 ${log.diaries_count ?? '-'} 条，配对日记 ${log.paired_diaries_count ?? '-'} 条`,
          });
        } else if (log.status === 'failed') {
          message.open({
            key: msgKey,
            type: 'warning',
            content: `更新失败：${log.error_message || '未知错误'}`,
          });
        }
      })();
    } catch (error) {
      message.open({ key: msgKey, type: 'error', content: 'Token 更新失败: ' + error.message });
    }
  };

  const handleQuickAdd = () => {
    form.setFieldsValue({
      auth_token: NIDERIJI_TOKEN,
    });
    setModalVisible(true);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: '用户ID', dataIndex: 'nideriji_userid', key: 'nideriji_userid', width: 120 },
    { title: '用户名', dataIndex: 'user_name', key: 'user_name', width: 140, render: (val) => val || '-' },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 200, render: (val) => val || '-' },
    {
      title: 'Token 状态',
      key: 'token_status',
      width: 140,
      render: (_, record) => {
        if (checkingIds.has(record?.id)) {
          return <Tag color="blue">校验中</Tag>;
        }

        const status = record?.token_status;
        if (!status) return <Tag>未知</Tag>;

        if (!status.checked_at && !status.expired) {
          return (
            <Tooltip title={status.reason || '未进行服务端校验'}>
              <Tag color="blue">未校验</Tag>
            </Tooltip>
          );
        }

        const expiresText = status.expires_at ? `到期时间：${formatDateTime(status.expires_at)}` : '到期时间未知';
        if (status.is_valid) {
          return (
            <Tooltip title={expiresText}>
              <Tag color="green">有效</Tag>
            </Tooltip>
          );
        }

        return (
          <Tooltip title={status.reason || expiresText}>
            <Tag color="gold">已失效</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (val) => (val ? '活跃' : '停用'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => openUpdateToken(record)}>
            更新Token
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: pagePadding }}>
      <Title level={3} style={{ marginTop: 0 }}>
        账号管理
      </Title>
      {invalidAccounts.length > 0 && (
        <Alert
          style={{ marginBottom: '16px' }}
          type="warning"
          showIcon
          message={`检测到 ${invalidAccounts.length} 个账号 Token 已失效`}
          description="重新添加该账号的 Token 会自动覆盖更新；失效账号将无法正常同步。"
        />
      )}

      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>
          添加账号
        </Button>
        <Button onClick={handleQuickAdd}>
          快速添加当前账号
        </Button>
        <Button onClick={() => validateAccounts(accounts)} disabled={accounts.length === 0}>
          刷新 Token 校验
        </Button>
      </div>

      <Table columns={columns} dataSource={accounts} rowKey="id" loading={loading} />

      <Modal
        title="添加账号"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item
            name="auth_token"
            label="Token"
            rules={[{ required: true, message: '请输入 Token' }]}
          >
            <Input.TextArea rows={4} placeholder="形如：token eyJhbGci..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`更新 Token${tokenAccount?.user_name ? `（${tokenAccount.user_name}）` : ''}`}
        open={tokenModalVisible}
        onCancel={() => {
          setTokenModalVisible(false);
          setTokenAccount(null);
        }}
        onOk={() => tokenForm.submit()}
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="只会更新当前账号的 Token"
          description="后端会远程校验 Token，并确保 Token 对应的 userid 与该账号一致；更新成功后会自动触发后台同步。"
        />
        <Form form={tokenForm} onFinish={handleUpdateToken} layout="vertical">
          <Form.Item
            name="auth_token"
            label="新 Token"
            rules={[{ required: true, message: '请输入新 Token' }]}
          >
            <Input.TextArea rows={4} placeholder="形如：token eyJhbGci..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
