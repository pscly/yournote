import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Card, List, Button, Switch, Timeline, Spin, message, Tag, Drawer, Space, Divider, Typography, Modal, Descriptions, BackTop } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, MenuOutlined, CalendarOutlined, CloudOutlined, SmileOutlined } from '@ant-design/icons';
import { diaryAPI, userAPI } from '../services/api';
import axios from 'axios';
import { API_BASE_URL } from '../config';

const { Sider, Content } = Layout;
const { Title, Paragraph } = Typography;
const APP_HEADER_HEIGHT = 'var(--app-header-height)';

export default function DiaryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [diary, setDiary] = useState(null);
  const [diaryList, setDiaryList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pairedUserId, setPairedUserId] = useState(null);
  const [pairUsers, setPairUsers] = useState({ main: null, matched: null });
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadData();
  }, [id]);

  useEffect(() => {
    if (!diary) return;

    const hasPair = !!(pairUsers?.main?.id && pairUsers?.matched?.id);
    if (showMatched && (hasPair || pairedUserId)) {
      loadMatchedDiaries();
      return;
    }

    loadMyDiaries();
  }, [showMatched, diary, pairedUserId, pairUsers]);

  const loadData = async () => {
    try {
      setLoading(true);
      const diaryRes = await diaryAPI.get(id);
      const currentDiary = diaryRes.data;
      setDiary(currentDiary);

      setPairedUserId(null);
      setPairUsers({ main: null, matched: null });

      await Promise.all([
        loadMyDiaries(currentDiary.user_id),
        loadPairedUser(currentDiary.account_id, currentDiary.user_id),
        loadHistory(),
      ]);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const getDiaryTimestamp = (item) => {
    const raw = item?.created_time || item?.created_date;
    const ts = new Date(raw).getTime();
    if (Number.isNaN(ts)) return 0;
    return ts;
  };

  const loadMyDiaries = async (userId = null) => {
    try {
      const uid = userId || diary.user_id;
      const listRes = await diaryAPI.list({ user_id: uid, limit: 100 });
      const sorted = (listRes.data || []).slice().sort((a, b) => (
        getDiaryTimestamp(b) - getDiaryTimestamp(a)
      ));
      setDiaryList(sorted);
    } catch {
      console.error('加载日记列表失败');
    }
  };

  const loadPairedUser = async (accountId, currentUserId) => {
    try {
      const res = await userAPI.paired(accountId);
      const relationships = res.data || [];
      const matchedRel = relationships.find((r) =>
        r?.user?.id === currentUserId || r?.paired_user?.id === currentUserId
      ) || relationships[0];

      if (!matchedRel?.user?.id || !matchedRel?.paired_user?.id) {
        setPairedUserId(null);
        setPairUsers({ main: null, matched: null });
        setShowMatched(false);
        return;
      }

      setPairUsers({ main: matchedRel.user, matched: matchedRel.paired_user });

      const otherUserId = matchedRel.user.id === currentUserId
        ? matchedRel.paired_user.id
        : matchedRel.user.id;
      setPairedUserId(otherUserId);
    } catch {
      console.error('加载配对用户失败');
    }
  };

  const loadMatchedDiaries = async () => {
    const ids = new Set();
    if (pairUsers?.main?.id) ids.add(pairUsers.main.id);
    if (pairUsers?.matched?.id) ids.add(pairUsers.matched.id);
    if (diary?.user_id) ids.add(diary.user_id);
    if (pairedUserId) ids.add(pairedUserId);

    const userIds = Array.from(ids).filter(Boolean);
    if (userIds.length <= 1) {
      await loadMyDiaries(userIds[0] || diary.user_id);
      return;
    }

    try {
      const results = await Promise.all(
        userIds.map((uid) => diaryAPI.list({ user_id: uid, limit: 100 }))
      );

      const map = new Map();
      results.forEach((res) => {
        (res.data || []).forEach((d) => {
          if (d?.id) map.set(d.id, d);
        });
      });

      const merged = Array.from(map.values()).sort((a, b) => (
        getDiaryTimestamp(b) - getDiaryTimestamp(a)
      ));

      setDiaryList(merged);
    } catch {
      message.error('加载匹配日记失败');
    }
  };

  const loadHistory = async () => {
    try {
      const historyRes = await axios.get(`${API_BASE_URL}/diary-history/${id}`);
      setHistory(historyRes.data);
    } catch {
      console.log('暂无历史记录');
    }
  };

  const refreshDiary = async () => {
    try {
      setRefreshing(true);
      const res = await diaryAPI.refresh(id);
      const refreshInfo = res.data?.refresh_info;

      await loadData();

      const usedDetail = !!refreshInfo?.used_all_by_ids;
      const detailReturned = refreshInfo?.all_by_ids_returned === true;
      const updated = refreshInfo?.updated === true;

      if (updated) {
        message.success(usedDetail ? '已刷新（日记详情已更新，使用 all_by_ids）' : '已刷新（日记内容已更新）');
      } else {
        message.warning(refreshInfo?.skipped_reason || '已刷新（内容未发生变化）');
      }

      if (refreshInfo) {
        Modal.info({
          title: '刷新结果',
          width: 640,
          content: (
            <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
              <Descriptions.Item label="阈值（字数）">{refreshInfo.min_len_threshold}</Descriptions.Item>
              <Descriptions.Item label="是否更新">{updated ? <Tag color="green">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="更新来源">{refreshInfo.update_source ? <Tag color="blue">{refreshInfo.update_source}</Tag> : '-'}</Descriptions.Item>
              <Descriptions.Item label="是否调用 sync">{refreshInfo.used_sync ? <Tag color="geekblue">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="sync 是否命中该日记">{refreshInfo.sync_found ? <Tag color="green">命中</Tag> : <Tag>未命中</Tag>}</Descriptions.Item>
              <Descriptions.Item label="sync 内容长度">{refreshInfo.sync_content_len ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="sync is_simple">{typeof refreshInfo.sync_is_simple === 'boolean' ? String(refreshInfo.sync_is_simple) : '-'}</Descriptions.Item>
              <Descriptions.Item label="是否调用 all_by_ids">{usedDetail ? <Tag color="purple">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="all_by_ids 是否返回该日记">{usedDetail ? (detailReturned ? <Tag color="green">返回</Tag> : <Tag color="red">未返回</Tag>) : '-'}</Descriptions.Item>
              <Descriptions.Item label="详情内容长度">{refreshInfo.detail_content_len ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="详情仍然过短">{typeof refreshInfo.detail_is_short === 'boolean' ? (refreshInfo.detail_is_short ? <Tag color="orange">是</Tag> : <Tag color="green">否</Tag>) : '-'}</Descriptions.Item>
              <Descriptions.Item label="详情尝试次数">{refreshInfo.detail_attempts ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="未更新原因">{refreshInfo.skipped_reason ?? '-'}</Descriptions.Item>
            </Descriptions>
          ),
        });
      }
    } catch {
      message.error('刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const getDiaryOwner = (item) => {
    if (pairUsers?.matched?.id && item?.user_id === pairUsers.matched.id) return 'matched';
    if (pairUsers?.main?.id && item?.user_id === pairUsers.main.id) return 'main';
    if (diary?.user_id && item?.user_id === diary.user_id) return 'main';
    return 'main';
  };

  const getBorderColor = (item) => {
    return getDiaryOwner(item) === 'matched' ? '#ff85c0' : '#1890ff';
  };

  const getActiveBgColor = (item) => {
    return getDiaryOwner(item) === 'matched' ? '#fff0f6' : '#e6f7ff';
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: `calc(100vh - ${APP_HEADER_HEIGHT})`
      }}>
        <Spin size="large" />
      </div>
    );
  }

  const DiaryListContent = () => (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff'
    }}>
      <div style={{
        padding: '20px',
        borderBottom: '1px solid #f0f0f0',
        background: '#fafafa'
      }}>
        <Title level={4} style={{ margin: '0 0 16px 0' }}>日记列表</Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Switch
                checked={showMatched}
                onChange={setShowMatched}
                disabled={!(pairUsers?.main?.id && pairUsers?.matched?.id)}
              />
              <span style={{ marginLeft: 8, fontSize: '14px' }}>显示匹配日记</span>
            </div>
            {pairUsers?.main?.id && pairUsers?.matched?.id && (
              <div style={{ fontSize: '12px', color: '#999' }}>
                <div>
                  <span style={{ display: 'inline-block', width: 12, height: 12, background: '#1890ff', marginRight: 6, borderRadius: 2 }}></span>
                  主用户{pairUsers.main?.name ? `：${pairUsers.main.name}` : ''}
                </div>
                <div>
                  <span style={{ display: 'inline-block', width: 12, height: 12, background: '#ff85c0', marginRight: 6, borderRadius: 2 }}></span>
                  被匹配用户{pairUsers.matched?.name ? `：${pairUsers.matched.name}` : ''}
                </div>
              </div>
            )}
          </Space>
        </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <List
          dataSource={diaryList}
          renderItem={item => (
            <Card
              hoverable
              onClick={() => {
                navigate(`/diary/${item.id}`);
                if (isMobile) setDrawerVisible(false);
              }}
              style={{
                marginBottom: 12,
                borderLeft: `4px solid ${getBorderColor(item)}`,
                background: item.id === parseInt(id) ? getActiveBgColor(item) : '#fff',
                cursor: 'pointer'
              }}
              bodyStyle={{ padding: '12px 16px' }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4, fontSize: '14px' }}>
                {item.title || '无标题'}
              </div>
              <div style={{ fontSize: '12px', color: '#999' }}>
                <CalendarOutlined style={{ marginRight: 4 }} />
                {item.created_date}
              </div>
            </Card>
          )}
        />
      </div>
    </div>
  );

  const stickyTop = `calc(${APP_HEADER_HEIGHT} + 24px)`;
  const stickyHeight = `calc(100vh - ${APP_HEADER_HEIGHT} - 48px)`;

  return (
    <Layout style={{ minHeight: `calc(100vh - ${APP_HEADER_HEIGHT})`, background: '#f5f5f5' }}>
      {!isMobile && (
        <Sider
          width={320}
          style={{
            background: '#fff',
            boxShadow: '2px 0 8px rgba(0,0,0,0.05)',
            height: stickyHeight,
            position: 'sticky',
            top: stickyTop,
            overflow: 'hidden'
          }}
        >
          <DiaryListContent />
        </Sider>
      )}

      <Content style={{
        maxWidth: 1400,
        margin: '0 auto',
        width: '100%',
        minWidth: 0
      }}>
        <Space direction="vertical" size={isMobile ? 'middle' : 'large'} style={{ width: '100%' }}>
          <div
            style={{
              position: 'sticky',
              top: `calc(${APP_HEADER_HEIGHT} + 12px)`,
              zIndex: 20,
              background: 'rgba(245,245,245,0.92)',
              backdropFilter: 'blur(8px)',
              padding: isMobile ? '8px 0' : '12px 0',
              borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}
          >
            <Space wrap size={isMobile ? 'small' : 'middle'} style={{ width: '100%' }}>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} size={isMobile ? 'middle' : 'large'}>
                返回
              </Button>
              <Button onClick={refreshDiary} loading={refreshing} size={isMobile ? 'middle' : 'large'}>
                {isMobile ? '刷新详情' : '重新访问此日记详情（强制更新）'}
              </Button>
              {isMobile && (
                <Button icon={<MenuOutlined />} onClick={() => setDrawerVisible(true)} size={isMobile ? 'middle' : 'large'}>
                  日记列表
                </Button>
              )}
            </Space>
          </div>

          <Card
            bordered={false}
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderRadius: 8
            }}
            bodyStyle={{ padding: isMobile ? 16 : 24 }}
          >
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
              <Title level={isMobile ? 3 : 2} style={{ marginBottom: 16 }}>
                {diary.title || '无标题'}
              </Title>

              <Space size={isMobile ? 'small' : 'middle'} wrap style={{ marginBottom: isMobile ? 16 : 24 }}>
                <Tag icon={<CalendarOutlined />} color="blue" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                  {diary.created_date}
                </Tag>
                {diary.mood && (
                  <Tag icon={<SmileOutlined />} color="orange" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                    {diary.mood}
                  </Tag>
                )}
                {diary.weather && (
                  <Tag icon={<CloudOutlined />} color="cyan" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                    {diary.weather}
                  </Tag>
                )}
              </Space>

              <Divider />

              <Paragraph style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                lineHeight: 1.8,
                fontSize: '15px',
                color: '#333',
                marginBottom: 0
              }}>
                {diary.content}
              </Paragraph>
            </div>
          </Card>

          {history.length > 0 && (
            <Card
              title={
                <Space>
                  <ClockCircleOutlined style={{ color: '#1890ff' }} />
                  <span>修改历史</span>
                </Space>
              }
              bordered={false}
              style={{
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                borderRadius: 8
              }}
            >
              <Timeline>
                {history.map(h => (
                  <Timeline.Item key={h.id} color="blue">
                    <div style={{ fontSize: '12px', color: '#999', marginBottom: 8 }}>
                      {new Date(h.recorded_at).toLocaleString('zh-CN')}
                    </div>
                    <Card
                      size="small"
                      style={{ background: '#fafafa', border: 'none' }}
                    >
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>{h.title}</div>
                      <div style={{ fontSize: '14px', color: '#666', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{h.content}</div>
                    </Card>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          )}
        </Space>
      </Content>

      {isMobile && (
        <Drawer
          title="日记列表"
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          width={300}
        >
          <DiaryListContent />
        </Drawer>
      )}

      <BackTop />
    </Layout>
  );
}
