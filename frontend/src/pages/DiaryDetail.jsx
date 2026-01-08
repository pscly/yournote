import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Card, List, Button, Switch, Timeline, Spin, message, Tag, Drawer, Space, Divider, Typography } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, MenuOutlined, CalendarOutlined, CloudOutlined, SmileOutlined } from '@ant-design/icons';
import { diaryAPI, userAPI } from '../services/api';
import axios from 'axios';
import { API_BASE_URL } from '../config';

const { Sider, Content } = Layout;
const { Title, Paragraph } = Typography;

export default function DiaryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [diary, setDiary] = useState(null);
  const [diaryList, setDiaryList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pairedUserId, setPairedUserId] = useState(null);
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
    if (diary && showMatched && pairedUserId) {
      loadMatchedDiaries();
    } else if (diary && !showMatched) {
      loadMyDiaries();
    }
  }, [showMatched, diary, pairedUserId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const diaryRes = await diaryAPI.get(id);
      const currentDiary = diaryRes.data;
      setDiary(currentDiary);

      await loadMyDiaries(currentDiary.user_id);
      await loadPairedUser(currentDiary.account_id, currentDiary.user_id);
      await loadHistory();
    } catch (error) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadMyDiaries = async (userId = null) => {
    try {
      const uid = userId || diary.user_id;
      const listRes = await diaryAPI.list({ user_id: uid, limit: 100 });
      const sorted = listRes.data.sort((a, b) =>
        new Date(b.created_date) - new Date(a.created_date)
      );
      setDiaryList(sorted);
    } catch (error) {
      console.error('加载日记列表失败');
    }
  };

  const loadPairedUser = async (accountId, currentUserId) => {
    try {
      const res = await userAPI.paired(accountId);
      if (res.data && res.data.length > 0) {
        const pairedRelation = res.data[0];
        if (pairedRelation.user && pairedRelation.paired_user) {
          const pairedId = pairedRelation.user.nideriji_userid === currentUserId
            ? pairedRelation.paired_user.nideriji_userid
            : pairedRelation.user.nideriji_userid;
          setPairedUserId(pairedId);
        }
      }
    } catch (error) {
      console.error('加载配对用户失败');
    }
  };

  const loadMatchedDiaries = async () => {
    if (!pairedUserId) return;

    try {
      const [myRes, pairedRes] = await Promise.all([
        diaryAPI.list({ user_id: diary.user_id, limit: 100 }),
        diaryAPI.list({ user_id: pairedUserId, limit: 100 })
      ]);

      const myDiaries = myRes.data.map(d => ({ ...d, owner: 'me' }));
      const pairedDiaries = pairedRes.data.map(d => ({ ...d, owner: 'partner' }));

      const merged = [...myDiaries, ...pairedDiaries].sort((a, b) =>
        new Date(b.created_date) - new Date(a.created_date)
      );

      setDiaryList(merged);
    } catch (error) {
      message.error('加载匹配日记失败');
    }
  };

  const loadHistory = async () => {
    try {
      const historyRes = await axios.get(`${API_BASE_URL}/diary-history/${id}`);
      setHistory(historyRes.data);
    } catch (error) {
      console.log('暂无历史记录');
    }
  };

  const getBorderColor = (item) => {
    if (!showMatched) return '#1890ff';
    return item.owner === 'me' ? '#1890ff' : '#ff85c0';
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 'calc(100vh - 80px)'
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
              disabled={!pairedUserId}
            />
            <span style={{ marginLeft: 8, fontSize: '14px' }}>显示匹配日记</span>
          </div>
          {showMatched && (
            <div style={{ fontSize: '12px', color: '#999' }}>
              <div><span style={{ display: 'inline-block', width: 12, height: 12, background: '#1890ff', marginRight: 6, borderRadius: 2 }}></span>我的日记</div>
              <div><span style={{ display: 'inline-block', width: 12, height: 12, background: '#ff85c0', marginRight: 6, borderRadius: 2 }}></span>TA的日记</div>
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
                background: item.id === parseInt(id) ? '#e6f7ff' : '#fff',
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

  return (
    <Layout style={{ minHeight: 'calc(100vh - 80px)', background: '#f5f5f5' }}>
      {!isMobile && (
        <Sider
          width={320}
          style={{
            background: '#fff',
            boxShadow: '2px 0 8px rgba(0,0,0,0.05)',
            height: 'calc(100vh - 80px)',
            position: 'sticky',
            top: 80,
            overflow: 'hidden'
          }}
        >
          <DiaryListContent />
        </Sider>
      )}

      <Content style={{
        padding: isMobile ? '16px' : '24px 32px',
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%'
      }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
              size="large"
            >
              返回
            </Button>
            {isMobile && (
              <Button
                icon={<MenuOutlined />}
                onClick={() => setDrawerVisible(true)}
                style={{ marginLeft: 8 }}
                size="large"
              >
                日记列表
              </Button>
            )}
          </div>

          <Card
            bordered={false}
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderRadius: 8
            }}
          >
            <Title level={2} style={{ marginBottom: 16 }}>
              {diary.title || '无标题'}
            </Title>

            <Space size="middle" wrap style={{ marginBottom: 24 }}>
              <Tag icon={<CalendarOutlined />} color="blue" style={{ padding: '4px 12px', fontSize: '14px' }}>
                {diary.created_date}
              </Tag>
              {diary.mood && (
                <Tag icon={<SmileOutlined />} color="orange" style={{ padding: '4px 12px', fontSize: '14px' }}>
                  {diary.mood}
                </Tag>
              )}
              {diary.weather && (
                <Tag icon={<CloudOutlined />} color="cyan" style={{ padding: '4px 12px', fontSize: '14px' }}>
                  {diary.weather}
                </Tag>
              )}
            </Space>

            <Divider />

            <Paragraph style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.8,
              fontSize: '15px',
              color: '#333'
            }}>
              {diary.content}
            </Paragraph>
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
                      <div style={{ fontSize: '14px', color: '#666' }}>{h.content}</div>
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
    </Layout>
  );
}
