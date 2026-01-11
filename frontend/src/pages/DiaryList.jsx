import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Grid, List, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { accountAPI, diaryAPI, userAPI } from '../services/api';
import { getDiaryWordStats } from '../utils/wordCount';
import { formatBeijingDateTimeFromTs, normalizeEpochMs, parseServerDate } from '../utils/time';

const { Title, Paragraph, Text } = Typography;
const ALL_ACCOUNTS = 'all';
const FETCH_LIMIT_PER_ACCOUNT = 200;

export default function DiaryList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;
  const [diaries, setDiaries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [userNameByNiderijiUserid, setUserNameByNiderijiUserid] = useState({});
  const [userById, setUserById] = useState({});
  const [userIdByNiderijiUserid, setUserIdByNiderijiUserid] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(ALL_ACCOUNTS);

  useEffect(() => {
    loadInit();
  }, [searchParams]);

  useEffect(() => {
    if (!selectedAccount) return;
    if (selectedAccount === ALL_ACCOUNTS && accounts.length === 0) return;
    loadDiaries();
  }, [selectedAccount, accounts]);

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

      const presetIdRaw = searchParams.get('accountId') || searchParams.get('account_id');
      const presetId = presetIdRaw ? Number.parseInt(presetIdRaw, 10) : null;
      const presetExists = Number.isFinite(presetId) && accountList.some(a => a?.id === presetId);
      if (accountList.length === 0) {
        setSelectedAccount(null);
        setDiaries([]);
        return;
      }

      if (presetExists) setSelectedAccount(presetId);
      else setSelectedAccount(ALL_ACCOUNTS);
    } catch (error) {
      message.error('初始化失败: ' + error.message);
    }
  };

  const getDiarySortKey = (item) => {
    // 优先使用同步接口带回来的 ts（更像“最后修改时间”）
    const tsMs = normalizeEpochMs(item?.ts);
    if (tsMs) return tsMs;

    const raw = item?.created_time || item?.created_date;
    const d = parseServerDate(raw);
    if (d) return d.getTime();

    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) return 0;
    return fallback.getTime();
  };

  const sortDiariesByLatest = (list) => {
    return (list || []).slice().sort((a, b) => getDiarySortKey(b) - getDiarySortKey(a));
  };

  const filterMatchedDiaries = async (accountId, list) => {
    // 优先使用配对关系，确保“仅被匹配用户”的口径准确；失败时再退回“排除主用户”口径。
    try {
      const pairedRes = await userAPI.paired(accountId);
      const matchedUserIds = new Set(
        (pairedRes?.data || []).map(r => r?.paired_user?.id).filter(Boolean),
      );
      if (matchedUserIds.size === 0) return [];
      return (list || []).filter(d => matchedUserIds.has(d?.user_id));
    } catch {
      const account = (accounts || []).find(a => a?.id === accountId);
      const mainNiderijiUserid = account?.nideriji_userid;
      const mainUserId = mainNiderijiUserid ? userIdByNiderijiUserid?.[mainNiderijiUserid] : null;
      if (!mainUserId) return [];
      return (list || []).filter(d => d?.user_id !== mainUserId);
    }
  };

  const loadDiaries = async () => {
    setLoading(true);
    try {
      if (selectedAccount === ALL_ACCOUNTS) {
        const accountList = accounts || [];
        const tasks = accountList.map(async (a) => {
          const accountId = a?.id;
          if (!accountId) return [];

          const res = await diaryAPI.byAccount(accountId, FETCH_LIMIT_PER_ACCOUNT);
          const list = res.data || [];
          return await filterMatchedDiaries(accountId, list);
        });

        const settled = await Promise.allSettled(tasks);
        const mergedById = new Map();
        let failed = 0;
        settled.forEach((r) => {
          if (r.status !== 'fulfilled') {
            failed += 1;
            return;
          }
          (r.value || []).forEach((d) => {
            if (!d?.id) return;
            mergedById.set(d.id, d);
          });
        });

        const merged = Array.from(mergedById.values());
        setDiaries(sortDiariesByLatest(merged));
        if (failed > 0 && merged.length > 0) {
          message.warning(`部分账号加载失败（${failed} 个），已显示可用数据`);
        }
        return;
      }

      const accountId = selectedAccount;
      const res = await diaryAPI.byAccount(accountId, FETCH_LIMIT_PER_ACCOUNT);
      const list = res.data || [];
      const matched = await filterMatchedDiaries(accountId, list);
      setDiaries(sortDiariesByLatest(matched));
    } catch (error) {
      message.error('加载日记失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const accountOptions = useMemo(() => {
    const items = (accounts || []).map((a) => {
      const userName = userNameByNiderijiUserid[a.nideriji_userid];
      const label = userName ? `${userName}（${a.nideriji_userid}）` : `账号 ${a.nideriji_userid}`;
      return { label, value: a.id };
    });

    return [
      { label: '全部账号（仅被匹配用户）', value: ALL_ACCOUNTS },
      ...items,
    ];
  }, [accounts, userNameByNiderijiUserid]);

  const columns = useMemo(() => [
    { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },      
    {
      title: '修改时间',
      dataIndex: 'ts',
      key: 'modified_time',
      width: 190,
      render: (ts) => {
        const text = formatBeijingDateTimeFromTs(ts);
        if (text === '-') return '-';
        return <Tag color="purple">{text}</Tag>;
      },
    },
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
            dataSource={diaries}
            loading={loading}
            locale={{ emptyText: '暂无配对日记' }}
            renderItem={(item) => {
              const u = userById?.[item?.user_id];
              const name = u?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知');
              const authorText = u?.nideriji_userid ? `${name}（${u.nideriji_userid}）` : name;
              const wordStats = getDiaryWordStats(item);
              const wordCount = wordStats?.content?.no_whitespace ?? 0;
              const modifiedText = formatBeijingDateTimeFromTs(item?.ts);
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
                      {modifiedText !== '-' && <Tag color="purple">修改 {modifiedText}</Tag>}
                      <Tag color="geekblue">{wordCount} 字</Tag>
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
            dataSource={diaries}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            locale={{ emptyText: '暂无配对日记' }}
            scroll={{ x: 1300 }}
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
