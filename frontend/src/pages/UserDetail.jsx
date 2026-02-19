import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Grid, List, Space, Table, Tag, Typography, theme as antdTheme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { accountAPI, diaryAPI, userAPI } from '../services/api';
import PageState from '../components/PageState';
import { getDiaryWordStats } from '../utils/wordCount';
import { formatBeijingDateTime, parseServerDate } from '../utils/time';
import Page from '../components/Page';

const { Title, Paragraph, Text } = Typography;

function formatDateTime(value) {
  const text = formatBeijingDateTime(value);
  return text === '-' ? '未知' : text;
}

function getShownMsgCount(item) {
  const n = Number(item?.msg_count);
  const shown = Number.isFinite(n) ? n : 0;
  return shown;
}

function getShownAccountIdText(item) {
  const n = Number(item?.account_id);
  const shown = Number.isFinite(n) ? n : '-';
  return shown;
}

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token } = antdTheme.useToken();
  const [user, setUser] = useState(null);
  const [diaries, setDiaries] = useState([]);
  const [pairedRecord, setPairedRecord] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const showAccountInDiaryList = useMemo(() => {
    const ids = new Set();
    (diaries || []).forEach((d) => {
      const n = Number(d?.account_id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    });
    return ids.size > 1;
  }, [diaries]);

  const loadPairedRecord = useCallback(async (currentUserId) => {
    if (!currentUserId || Number.isNaN(currentUserId)) return null;

    const toTime = (value) => {
      const d = parseServerDate(value);
      if (!d) return 0;
      return d.getTime();
    };

    try {
      const accountsRes = await accountAPI.list();
      const accounts = accountsRes.data || [];
      if (accounts.length === 0) return null;

      const pairedCalls = await Promise.allSettled(
        accounts.map(a => userAPI.paired(a.id)),
      );

      let best = null;
      pairedCalls.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const account = accounts[idx];
        (res.value?.data || []).forEach((p) => {
          const pairedUserId = p?.paired_user?.id;
          if (pairedUserId !== currentUserId) return;

          const candidate = {
            accountId: account?.id,
            accountEmail: account?.email,
            mainUser: p?.user || null,
            pairedTime: p?.paired_time,
          };

          if (!best || toTime(candidate.pairedTime) >= toTime(best.pairedTime)) {
            best = candidate;
          }
        });
      });

      return best;
    } catch {
      return null;
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setPairedRecord(null);
      const [userRes, diariesRes] = await Promise.all([
        userAPI.get(id),
        diaryAPI.list({ user_id: id, limit: 100 }),
      ]);
      setUser(userRes.data);
      setDiaries(diariesRes.data || []);

      const record = await loadPairedRecord(Number.parseInt(id, 10));
      setPairedRecord(record);
    } catch (error) {
      setUser(null);
      setDiaries([]);
      setPairedRecord(null);
      setError(error);
    } finally {
      setLoading(false);
    }
  }, [id, loadPairedRecord]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;

    setShowPassword(false);
    setCredentials(null);

    if (!id) return () => { cancelled = true; };

    const loadCredentials = async () => {
      try {
        const res = await userAPI.credentials(id);
        if (cancelled) return;
        setCredentials(res?.data || null);
      } catch {
        if (cancelled) return;
        setCredentials({ has_account: false, email: null, password: null });
      }
    };

    loadCredentials();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const renderPassword = () => {
    if (!credentials) return '-';
    if (!credentials.has_account) return '无账号凭据';

    const password = credentials.password;
    if (password == null || password === '') return '-';

    return (
      <Space size={8} wrap>
        <Text>{showPassword ? password : '******'}</Text>
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: 'auto' }}
          aria-pressed={showPassword}
          onClick={() => setShowPassword(v => !v)}
        >
          {showPassword ? '隐藏密码' : '显示密码'}
        </Button>
      </Space>
    );
  };

  const columns = useMemo(() => {
    const cols = [
      { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },
      ...(showAccountInDiaryList ? [
        {
          title: '账号',
          key: 'account_id',
          width: 90,
          align: 'center',
          render: (_, record) => {
            const text = getShownAccountIdText(record);
            return (
              <Tag color="gold" title={`账号 ${text}`}>A{text}</Tag>
            );
          },
        },
      ] : []),
      { title: '标题', dataIndex: 'title', key: 'title', width: 220, render: (v) => v || '-' },
      {
        title: '内容',
        dataIndex: 'content',
        key: 'content',
        ellipsis: true,
        render: (v) => v || '-',
        onCell: (record) => ({
          onClick: () => navigate(`/diary/${record.id}`),
          style: { cursor: 'pointer', color: token.colorPrimary },
        }),
      },
      {
        title: '字数',
        key: 'word_count',
        width: 110,
        align: 'right',
        render: (_, record) => {
          const stats = getDiaryWordStats(record);
          const n = stats?.content?.no_whitespace ?? 0;
          return <Tag color="geekblue">{n} 字</Tag>;
        },
      },
      {
        title: '留言',
        key: 'msg_count',
        width: 110,
        align: 'right',
        render: (_, record) => <Tag color="volcano">留言 {getShownMsgCount(record)}</Tag>,
      },
      { title: '心情', dataIndex: 'mood', key: 'mood', width: 90, render: (m) => (m ? <Tag>{m}</Tag> : '-') },
    ];
    return cols;
  }, [navigate, token, showAccountInDiaryList]);

  return (
    <Page>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <div>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>    
            返回
          </Button>
        </div>

        <PageState
          loading={loading}
          error={error}
          onRetry={loadData}
        >
          {!user ? (
            <Card>
              <Text type="secondary">用户不存在或已被删除。</Text>
            </Card>
          ) : (
            <>
              <Title level={3} style={{ margin: 0 }}>
                用户详情
              </Title>

              <Card title="用户信息">
                <Descriptions column={isMobile ? 1 : 2} bordered size={isMobile ? 'small' : 'middle'}>
                  <Descriptions.Item label="用户名">{user.name || '未命名'}</Descriptions.Item>
                  <Descriptions.Item label="用户ID">{user.nideriji_userid}</Descriptions.Item>
                  <Descriptions.Item label="角色">{user.role || '-'}</Descriptions.Item>
                  <Descriptions.Item label="记录数">{user.diary_count ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="字数">{user.word_count ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="最后登录">{formatDateTime(user.last_login_time)}</Descriptions.Item>
                  <Descriptions.Item label="邮箱">{credentials?.email ? credentials.email : '-'}</Descriptions.Item>
                  <Descriptions.Item label="密码">{renderPassword()}</Descriptions.Item>
                  <Descriptions.Item label="个性签名" span={isMobile ? 1 : 2}>
                    {user.description || '无'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              {pairedRecord?.mainUser?.id && (
                <Card title="被配对记录">
                  <Descriptions column={isMobile ? 1 : 2} bordered size={isMobile ? 'small' : 'middle'}>
                    <Descriptions.Item label="主账号">
                      <Tag
                        color="geekblue"
                        title="点击查看主账号详情"
                        style={{ cursor: pairedRecord?.mainUser?.id ? 'pointer' : 'default' }}
                        onClick={() => pairedRecord?.mainUser?.id && navigate(`/user/${pairedRecord.mainUser.id}`)}
                      >
                        {pairedRecord.mainUser?.name || '未命名'}
                        {pairedRecord.mainUser?.nideriji_userid ? `（${pairedRecord.mainUser.nideriji_userid}）` : ''}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="主账号邮箱">
                      {pairedRecord.accountEmail ? (
                        <Typography.Link
                          title="点击查看主账号详情"
                          onClick={() => navigate(`/user/${pairedRecord.mainUser.id}`)}
                        >
                          {pairedRecord.accountEmail}
                        </Typography.Link>
                      ) : (
                        '-'
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="配对时间">
                      {formatDateTime(pairedRecord.pairedTime)}
                    </Descriptions.Item>
                    <Descriptions.Item label="主账号ID">
                      {pairedRecord.mainUser?.id ?? '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="账号ID">
                      {pairedRecord.accountId ?? '-'}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              )}

              <Card title={`记录列表（${diaries.length}）`}>
                {isMobile ? (
                  <List
                    dataSource={diaries}
                    locale={{ emptyText: '暂无记录' }}
                  renderItem={(item) => (
                    <Card
                      hoverable
                      style={{ marginBottom: 12 }}
                      onClick={() => navigate(`/diary/${item.id}`)}
                      bodyStyle={{ padding: 14 }}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                          {showAccountInDiaryList && (
                            <Tag color="gold" title={`账号 ${getShownAccountIdText(item)}`}>A{getShownAccountIdText(item)}</Tag>
                          )}
                          <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                          <Tag color="geekblue">{getDiaryWordStats(item).content.no_whitespace} 字</Tag>
                          <Tag color="volcano">留言 {getShownMsgCount(item)}</Tag>
                          {item.mood && <Tag>{item.mood}</Tag>}
                        </Space>
                          <Text strong>{item.title || '无标题'}</Text>
                          <Paragraph style={{ margin: 0, color: token.colorTextSecondary }} ellipsis={{ rows: 2 }}>
                            {item.content || '-'}
                          </Paragraph>
                        </Space>
                      </Card>
                    )}
                  />
                ) : (
                  <Table
                    columns={columns}
                    dataSource={diaries}
                    rowKey="id"
                    pagination={{ pageSize: 20 }}
                    scroll={{ x: 920 }}
                  />
                )}
              </Card>
            </>
          )}
        </PageState>
      </Space>
    </Page>
  );
}
