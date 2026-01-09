import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Grid, List, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { accountAPI, diaryAPI, userAPI } from '../services/api';

const { Title, Paragraph, Text } = Typography;

export default function DiaryList() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;
  const [diaries, setDiaries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [userNameByNiderijiUserid, setUserNameByNiderijiUserid] = useState({});
  const [userById, setUserById] = useState({});
  const [userIdByNiderijiUserid, setUserIdByNiderijiUserid] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);

  useEffect(() => {
    loadInit();
  }, []);

  useEffect(() => {
    if (selectedAccount) loadDiaries();
  }, [selectedAccount]);

  const loadInit = async () => {
    try {
      const [accountsRes, usersRes] = await Promise.all([accountAPI.list(), userAPI.list(5000)]);
      const accountList = accountsRes.data || [];
      setAccounts(accountList);

      const nameByNiderijiUserid = {};
      const byId = {};
      const idByNiderijiUserid = {};
      (usersRes.data || []).forEach((u) => {
        if (!u) return;
        if (u.id) byId[u.id] = u;
        if (u.nideriji_userid) {
          nameByNiderijiUserid[u.nideriji_userid] = u.name;
          idByNiderijiUserid[u.nideriji_userid] = u.id;
        }
      });
      setUserNameByNiderijiUserid(nameByNiderijiUserid);
      setUserById(byId);
      setUserIdByNiderijiUserid(idByNiderijiUserid);

      if (accountList.length > 0) {
        setSelectedAccount(accountList[0].id);
      }
    } catch (error) {
      message.error('初始化失败: ' + error.message);
    }
  };

  const loadDiaries = async () => {
    setLoading(true);
    try {
      const res = await diaryAPI.byAccount(selectedAccount);
      setDiaries(res.data || []);
    } catch (error) {
      message.error('加载日记失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const accountOptions = useMemo(() => {
    return (accounts || []).map((a) => {
      const userName = userNameByNiderijiUserid[a.nideriji_userid];
      const label = userName ? `${userName}（${a.nideriji_userid}）` : `账号 ${a.nideriji_userid}`;
      return { label, value: a.id };
    });
  }, [accounts, userNameByNiderijiUserid]);

  const displayDiaries = useMemo(() => {
    const list = diaries || [];
    const account = (accounts || []).find(a => a?.id === selectedAccount);
    const mainNiderijiUserid = account?.nideriji_userid;
    const mainUserId = mainNiderijiUserid ? userIdByNiderijiUserid?.[mainNiderijiUserid] : null;
    if (!mainUserId) return list;
    return list.filter(d => d?.user_id !== mainUserId);
  }, [diaries, accounts, selectedAccount, userIdByNiderijiUserid]);

  const columns = useMemo(() => [
    { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },
    {
      title: '作者',
      dataIndex: 'user_id',
      key: 'author',
      width: 180,
      render: (uid) => {
        const u = userById?.[uid];
        const name = u?.name || (uid ? `用户 ${uid}` : '未知');
        const text = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
        return <Tag color="magenta">{text}</Tag>;
      },
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 220,
      render: (v) => v || '-',
      onCell: (record) => ({
        onClick: () => navigate(`/diary/${record.id}`),
        style: { cursor: 'pointer' },
      }),
    },
    {
      title: '内容',
      dataIndex: 'content',
      key: 'content',
      ellipsis: true,
      render: (v) => v || '-',
      onCell: (record) => ({
        onClick: () => navigate(`/diary/${record.id}`),
        style: { cursor: 'pointer', color: '#1677ff' },
      }),
    },
    { title: '心情', dataIndex: 'mood', key: 'mood', width: 90, render: (m) => (m ? <Tag>{m}</Tag> : '-') },
    { title: '天气', dataIndex: 'weather', key: 'weather', width: 90, render: (w) => (w ? <Tag color="blue">{w}</Tag> : '-') },
  ], [navigate, userById]);

  if (accounts.length === 0) {
    return (
      <div style={{ padding: pagePadding }}>
        <Title level={3} style={{ marginTop: 0 }}>
          日记列表
        </Title>
        <Card>
          <div style={{ color: '#999' }}>暂无账号，请先去“账号管理”添加并等待同步完成。</div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: pagePadding }}>
      <Title level={3} style={{ marginTop: 0 }}>
        日记列表
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Space wrap direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: '100%' }}>
          <span style={{ color: '#666' }}>选择账号：</span>
          <Select
            style={{ width: isMobile ? '100%' : 280 }}
            value={selectedAccount}
            onChange={setSelectedAccount}
            options={accountOptions}
          />
          <Button icon={<ReloadOutlined />} onClick={loadDiaries} disabled={!selectedAccount} block={isMobile}>
            刷新
          </Button>
          <Tag color="magenta">仅显示配对用户日记</Tag>
        </Space>
      </Card>

      <Card>
        {isMobile ? (
          <List
            dataSource={displayDiaries}
            loading={loading}
            locale={{ emptyText: '暂无配对日记' }}
            renderItem={(item) => {
              const u = userById?.[item?.user_id];
              const name = u?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知');
              const authorText = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
              return (
                <Card
                  hoverable
                  style={{ marginBottom: 12 }}
                  onClick={() => navigate(`/diary/${item.id}`)}
                  bodyStyle={{ padding: 14 }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap size={8}>
                      <Tag color="magenta">{authorText}</Tag>
                      <Tag color="blue">{item.created_date || '未知日期'}</Tag>
                      {item.mood && <Tag>{item.mood}</Tag>}
                      {item.weather && <Tag color="cyan">{item.weather}</Tag>}
                    </Space>
                    <Text strong>{item.title || '无标题'}</Text>
                    <Paragraph
                      style={{ margin: 0, color: '#666' }}
                      ellipsis={{ rows: 2 }}
                    >
                      {item.content || '-'}
                    </Paragraph>
                  </Space>
                </Card>
              );
            }}
          />
        ) : (
          <Table
            columns={columns}
            dataSource={displayDiaries}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            locale={{ emptyText: '暂无配对日记' }}
            scroll={{ x: 980 }}
          />
        )}
        {loading && (
          <div style={{ display: 'none' }}>
            <Spin />
          </div>
        )}
      </Card>
    </div>
  );
}
