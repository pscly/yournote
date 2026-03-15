import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Card,
  Col,
  List,
  Row,
  Space,
  Statistic,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from 'antd';
import { useLocation } from 'react-router-dom';
import { accountAPI, userAPI } from '../services/api';
import AppLink from '../components/AppLink';
import Page from '../components/Page';
import PageState from '../components/PageState';
import { buildDiaryDetailPath, getLocationPath } from '../utils/navigation';
import { formatBeijingDateTime, parseServerDate } from '../utils/time';

const { Title, Text } = Typography;

function getAvatarText(name) {
  if (!name) return '?';
  const s = String(name).trim();
  return s ? s.slice(0, 1).toUpperCase() : '?';
}

function toTime(value) {
  const d = parseServerDate(value);
  if (!d) return 0;
  const t = d.getTime();
  if (Number.isNaN(t)) return 0;
  return t;
}

function getUserEmail(user, accountByNid) {
  const nid = user?.nideriji_userid;
  if (!nid) return null;
  const email = accountByNid?.get?.(nid)?.email;
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (!trimmed) return null;
  return trimmed;
}

function formatUserLabel(user, accountByNid) {
  if (!user) return '未知';
  const email = getUserEmail(user, accountByNid);
  if (email) return email;
  const name = user?.name || user?.user_name || '未命名';
  const nid = user?.nideriji_userid;
  return nid ? `${name}（${nid}）` : name;
}

function formatShortTime(value) {
  if (!value) return null;
  const text = formatBeijingDateTime(value);
  return text === '-' ? String(value) : text;
}

export default function AllUsers() {
  const location = useLocation();
  const { token } = antdTheme.useToken();
  const fromPath = useMemo(() => getLocationPath(location), [location]);
  const getDiaryDetailTo = useCallback((diaryId) => buildDiaryDetailPath(diaryId, fromPath), [fromPath]);
  const [users, setUsers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activePairs, setActivePairs] = useState([]);
  const [unpairedMains, setUnpairedMains] = useState([]);
  const [historyPaired, setHistoryPaired] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [usersRes, accountsRes] = await Promise.all([
        userAPI.list(200),
        accountAPI.list(),
      ]);

      const usersList = usersRes?.data || [];
      const accounts = accountsRes?.data || [];

      const usersByNid = new Map(
        usersList
          .filter(u => u?.nideriji_userid)
          .map(u => [u.nideriji_userid, u]),
      );

      const pairedCalls = await Promise.allSettled(
        accounts.map(a => userAPI.paired(a.id, { include_inactive: true })),
      );

      const nextActivePairs = [];
      const nextUnpairedMains = [];
      const historyByUserId = new Map();

      pairedCalls.forEach((res, idx) => {
        const account = accounts[idx];
        if (!account?.id) return;
        if (res.status !== 'fulfilled') return;

        const rels = res.value?.data || [];
        const mainUserFromRel = rels.find(r => r?.user?.id)?.user || null;
        const mainUser = mainUserFromRel
          || usersByNid.get(account.nideriji_userid)
          || null;

        const activeRels = rels.filter(r => r?.is_active);
        const latestActive = activeRels
          .slice()
          .sort((a, b) => toTime(b?.paired_time) - toTime(a?.paired_time))[0]
          || null;

        if (latestActive?.paired_user?.id) {
          nextActivePairs.push({
            accountId: account.id,
            mainUser,
            pairedUser: latestActive.paired_user,
            pairedTime: latestActive.paired_time,
            pairedUserLastDiaryTime: latestActive.paired_user_last_diary_time,
            pairedUserLastDiaryId: latestActive.paired_user_last_diary_id,
          });
        } else {
          nextUnpairedMains.push({
            accountId: account.id,
            mainUser,
            pairingCancelled: rels.length > 0 && activeRels.length === 0,
          });
        }

        const inactiveRels = rels.filter(r => r?.is_active === false);
        inactiveRels.forEach((r) => {
          const pairedUser = r?.paired_user;
          if (!pairedUser?.id) return;

          const candidate = {
            pairedUser,
            mainUser,
            accountId: account.id,
            pairedTime: r?.paired_time,
          };

          const existing = historyByUserId.get(pairedUser.id);
          if (!existing || toTime(candidate.pairedTime) >= toTime(existing.pairedTime)) {
            historyByUserId.set(pairedUser.id, candidate);
          }
        });
      });

      const activePairedIds = new Set(
        nextActivePairs.map(p => p?.pairedUser?.id).filter(Boolean),
      );

      const nextHistory = Array.from(historyByUserId.values())
        .filter(h => !activePairedIds.has(h?.pairedUser?.id))
        .sort((a, b) => toTime(b?.pairedTime) - toTime(a?.pairedTime));

      nextActivePairs.sort((a, b) => (
        (a?.mainUser?.nideriji_userid ?? 0) - (b?.mainUser?.nideriji_userid ?? 0)
      ));
      nextUnpairedMains.sort((a, b) => (
        (a?.mainUser?.nideriji_userid ?? 0) - (b?.mainUser?.nideriji_userid ?? 0)
      ));

      setUsers(usersList);
      setAccounts(accounts);
      setActivePairs(nextActivePairs);
      setUnpairedMains(nextUnpairedMains);
      setHistoryPaired(nextHistory);
    } catch (e) {
      setUsers([]);
      setAccounts([]);
      setActivePairs([]);
      setUnpairedMains([]);
      setHistoryPaired([]);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pairedUserIds = useMemo(
    () => new Set(activePairs.map(p => p?.pairedUser?.id).filter(Boolean)),
    [activePairs],
  );

  const accountByNid = useMemo(() => new Map(
    accounts
      .filter(a => a?.nideriji_userid)
      .map(a => [a.nideriji_userid, a]),
  ), [accounts]);

  const pairedSourcesByUserId = useMemo(() => {
    const map = new Map();
    activePairs.forEach((p) => {
      const pairedId = p?.pairedUser?.id;
      if (!pairedId) return;
      map.set(pairedId, {
        accountId: p?.accountId,
        mainUserId: p?.mainUser?.id,
        mainUser: p?.mainUser || null,
        pairedTime: p?.pairedTime,
      });
    });
    return Object.fromEntries(map.entries());
  }, [activePairs]);

  const pairedCount = pairedUserIds.size;

  return (
    <Page>
      <Title level={3} style={{ marginTop: 0 }}>
        所有用户
      </Title>

      <PageState loading={loading} error={error} onRetry={loadData}>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="用户总数" value={users.length} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="当前配对用户数" value={pairedCount} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="提示" value="配对视图更清晰" />
            </Card>
          </Col>
        </Row>

        <Tabs
          items={[
            {
              key: 'paired',
              label: '配对视图',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card title="当前配对关系" styles={{ body: { padding: 12 } }}>
                    <List
                      dataSource={activePairs}
                      locale={{ emptyText: '没有配对用户' }}
                      renderItem={(item) => (
                        <List.Item style={{ paddingLeft: 0, paddingRight: 0 }}>
                          <Space wrap>
                            <Tag
                              color="blue"
                              style={{ cursor: item?.mainUser?.id ? 'pointer' : 'default' }}
                            >
                              <AppLink to={item?.mainUser?.id ? `/user/${item.mainUser.id}` : null}>
                                {formatUserLabel(item?.mainUser, accountByNid)}
                              </AppLink>
                            </Tag>
                            <span>-</span>
                            <Tag
                              color="magenta"
                              style={{ cursor: item?.pairedUser?.id ? 'pointer' : 'default' }}
                            >
                              <AppLink to={item?.pairedUser?.id ? `/user/${item.pairedUser.id}` : null}>
                                {formatUserLabel(item?.pairedUser, accountByNid)}
                              </AppLink>
                            </Tag>
                            {item?.pairedTime && (
                              <Tag color="geekblue">配对 {formatShortTime(item.pairedTime) || '-'}</Tag>
                            )}
                            <Tag
                              color="gold"
                              style={{ cursor: item?.pairedUserLastDiaryId ? 'pointer' : 'default' }}
                            >
                              <AppLink to={getDiaryDetailTo(item?.pairedUserLastDiaryId)}>
                                对方最后日记 {formatShortTime(item?.pairedUserLastDiaryTime) || '暂无日记'}
                              </AppLink>
                            </Tag>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>

                  <Card title="其他主账号（当前未配对）" styles={{ body: { padding: 12 } }}>
                    {unpairedMains.length === 0 ? (
                      <Text type="secondary">暂无</Text>
                    ) : (
                      <Space wrap>
                        {unpairedMains.map((item) => (
                          <Space key={item.accountId} size={6} align="center">
                            <Tag
                              data-testid={`users-unpaired-main-${item.accountId}`}
                              style={{ cursor: item?.mainUser?.id ? 'pointer' : 'default' }}
                            >
                              <AppLink to={item?.mainUser?.id ? `/user/${item.mainUser.id}` : null}>
                                {formatUserLabel(item?.mainUser, accountByNid)}
                              </AppLink>
                            </Tag>
                            {item?.pairingCancelled && (
                              <Text
                                type="warning"
                                data-testid={`users-pairing-cancelled-${item.accountId}`}
                              >
                                已取消配对
                              </Text>
                            )}
                          </Space>
                        ))}
                      </Space>
                    )}
                  </Card>

                  <Card title="其他历史被配对账号" styles={{ body: { padding: 12 } }}>
                    {historyPaired.length === 0 ? (
                      <Text type="secondary">暂无</Text>
                    ) : (
                      <Space wrap>
                        {historyPaired.map((item) => {
                          const pairedId = item?.pairedUser?.id;
                          const tipMain = item?.mainUser
                            ? formatUserLabel(item.mainUser, accountByNid)
                            : '未知主账号';
                          const tipTime = formatShortTime(item?.pairedTime) || '-';
                          const tip = `曾被 ${tipMain} 配对（${tipTime}）`;
                          return (
                            <Tooltip key={pairedId || `${tipMain}-${tipTime}`} title={tip}>
                              <Tag
                                style={{ cursor: pairedId ? 'pointer' : 'default' }}
                              >
                                <AppLink to={pairedId ? `/user/${pairedId}` : null}>
                                  {formatUserLabel(item?.pairedUser, accountByNid)}
                                </AppLink>
                              </Tag>
                            </Tooltip>
                          );
                        })}
                      </Space>
                    )}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'all',
              label: '全部用户',
              children: (
                <Row gutter={[16, 16]}>
                  {users.map((user) => {
                    const isPaired = pairedUserIds.has(user.id);
                    const pairedSource = pairedSourcesByUserId?.[user.id] || null;
                    const userLabel = formatUserLabel(user, accountByNid);
                    const userEmail = getUserEmail(user, accountByNid);
                    const card = (
                      <AppLink to={`/user/${user.id}`} block>
                        <Card
                          hoverable
                          styles={{ body: { textAlign: 'center' } }}
                        >
                          <Avatar
                            size={56}
                            style={{
                              backgroundColor: isPaired ? token.magenta6 : token.colorPrimary,
                              marginBottom: 12,
                            }}
                          >
                            {getAvatarText(userLabel)}
                          </Avatar>
                          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                            {userLabel}
                          </div>
                          {!userEmail && (
                            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                              Nideriji ID: {user.nideriji_userid}
                            </Text>
                          )}
                          <Text type="secondary" style={{ marginTop: 8, display: 'block' }}>
                            记录数：{user.diary_count ?? 0}
                          </Text>
                          {isPaired && pairedSource && (
                            <div style={{ marginTop: 10 }}>
                              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                                匹配主账号：
                              </Text>
                              <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
                                <Tag
                                  key={`${pairedSource.accountId || 'a'}-${pairedSource.mainUserId || 'u'}`}
                                  color="geekblue"
                                >
                                  {formatUserLabel(pairedSource.mainUser, accountByNid)}
                                </Tag>
                              </div>
                            </div>
                          )}
                        </Card>
                      </AppLink>
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
              ),
            },
          ]}
        />
      </PageState>
    </Page>
  );
}
