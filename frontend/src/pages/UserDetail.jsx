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

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token } = antdTheme.useToken();
  const [user, setUser] = useState(null);
  const [diaries, setDiaries] = useState([]);
  const [pairedRecord, setPairedRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const columns = useMemo(() => {
    return [
      { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },    
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
      { title: '心情', dataIndex: 'mood', key: 'mood', width: 90, render: (m) => (m ? <Tag>{m}</Tag> : '-') },
    ];
  }, [navigate, token]);

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
                  <Descriptions.Item label="个性签名" span={isMobile ? 1 : 2}>
                    {user.description || '无'}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              {pairedRecord?.mainUser?.id && (
                <Card title="被配对记录">
                  <Descriptions column={isMobile ? 1 : 2} bordered size={isMobile ? 'small' : 'middle'}>
                    <Descriptions.Item label="主账号">
                      <Tag color="geekblue">
                        {pairedRecord.mainUser?.name || '未命名'}
                        {pairedRecord.mainUser?.nideriji_userid ? `（${pairedRecord.mainUser.nideriji_userid}）` : ''}
                      </Tag>
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
                            <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                            <Tag color="geekblue">{getDiaryWordStats(item).content.no_whitespace} 字</Tag>
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
