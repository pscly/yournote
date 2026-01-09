import { useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, Card, Col, Grid, Row, Spin, Statistic, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { accountAPI, userAPI } from '../services/api';

const { Title } = Typography;

function getAvatarText(name) {
  if (!name) return '?';
  const s = String(name).trim();
  return s ? s.slice(0, 1).toUpperCase() : '?';
}

export default function AllUsers() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const pagePadding = isMobile ? 12 : 24;
  const [users, setUsers] = useState([]);
  const [pairedUserIds, setPairedUserIds] = useState(new Set());
  const [pairedSourcesByUserId, setPairedSourcesByUserId] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersRes, accountsRes] = await Promise.all([
        userAPI.list(),
        accountAPI.list(),
      ]);

      const accounts = accountsRes.data || [];
      const pairedCalls = await Promise.allSettled(
        accounts.map(a => userAPI.paired(a.id)),
      );

      const toTime = (value) => {
        if (!value) return 0;
        const t = new Date(value).getTime();
        if (Number.isNaN(t)) return 0;
        return t;
      };

      const pairedIds = new Set();
      const sourcesMap = new Map();
      pairedCalls.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const account = accounts[idx];
        (res.value?.data || []).forEach((p) => {
          const pairedUser = p?.paired_user;
          const mainUser = p?.user;
          const pairedId = pairedUser?.id;
          if (!pairedId) return;

          pairedIds.add(pairedId);

          const candidate = {
            accountId: account?.id,
            mainUserId: mainUser?.id,
            mainUserName: mainUser?.name || account?.user_name || '未命名',
            mainUserNiderijiUserid: mainUser?.nideriji_userid || account?.nideriji_userid,
            pairedTime: p?.paired_time,
          };

          const existing = sourcesMap.get(pairedId);
          if (!existing || toTime(candidate.pairedTime) >= toTime(existing.pairedTime)) {
            sourcesMap.set(pairedId, candidate);
          }
        });
      });

      setUsers(usersRes.data || []);
      setPairedUserIds(pairedIds);
      setPairedSourcesByUserId(Object.fromEntries(sourcesMap.entries()));
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const pairedCount = useMemo(() => pairedUserIds.size, [pairedUserIds]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: pagePadding }}>
      <Title level={3} style={{ marginTop: 0 }}>
        所有用户
      </Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="用户总数" value={users.length} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="配对用户数" value={pairedCount} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="提示" value="点击卡片查看详情" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {users.map((user) => {
          const isPaired = pairedUserIds.has(user.id);
          const pairedSource = pairedSourcesByUserId?.[user.id] || null;
          const card = (
            <Card
              hoverable
              onClick={() => navigate(`/user/${user.id}`)}
              styles={{ body: { textAlign: 'center' } }}
            >
              <Avatar size={56} style={{ backgroundColor: isPaired ? '#eb2f96' : '#1677ff', marginBottom: 12 }}>
                {getAvatarText(user.name)}
              </Avatar>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {user.name || '未命名'}
              </div>
              <div style={{ color: '#999', fontSize: 12 }}>
                Nideriji ID: {user.nideriji_userid}
              </div>
              <div style={{ marginTop: 8, color: '#666' }}>
                日记数：{user.diary_count ?? 0}
              </div>
              {isPaired && pairedSource && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>
                    匹配主账号：
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <Tag
                      key={`${pairedSource.accountId || 'a'}-${pairedSource.mainUserId || 'u'}`}
                      color="geekblue"
                    >
                      {pairedSource.mainUserName}
                      {pairedSource.mainUserNiderijiUserid ? `（${pairedSource.mainUserNiderijiUserid}）` : ''}
                    </Tag>
                  </div>
                </div>
              )}
            </Card>
          );

          return (
            <Col key={user.id} xs={24} sm={12} md={8} lg={6}>
              {isPaired ? (
                <Badge.Ribbon text="配对用户" color="magenta">
                  {card}
                </Badge.Ribbon>
              ) : (
                card
              )}
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
