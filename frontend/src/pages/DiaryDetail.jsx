import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Layout, Card, List, Button, Switch, Timeline, Spin, message, Tag } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { diaryAPI, userAPI } from '../services/api';
import axios from 'axios';

const { Sider, Content } = Layout;

export default function DiaryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [diary, setDiary] = useState(null);
  const [diaryList, setDiaryList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const diaryRes = await diaryAPI.get(id);
      setDiary(diaryRes.data);

      // 加载该用户的日记列表
      const listRes = await diaryAPI.list({ user_id: diaryRes.data.user_id, limit: 100 });
      setDiaryList(listRes.data);

      // 加载历史记录
      try {
        const historyRes = await axios.get(`http://localhost:8000/api/diary-history/${id}`);
        setHistory(historyRes.data);
      } catch (error) {
        console.log('No history');
      }
    } catch (error) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  return (
    <Layout style={{ padding: '24px', minHeight: '100vh' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16, width: 100 }}>
        返回
      </Button>

      <Layout style={{ background: '#fff' }}>
        <Sider width={300} style={{ background: '#fafafa', padding: '16px' }}>
          <h3>日记列表</h3>
          <Switch
            checked={showMatched}
            onChange={setShowMatched}
            style={{ marginBottom: 16 }}
          />
          <span style={{ marginLeft: 8 }}>显示匹配日记</span>

          <List
            dataSource={diaryList}
            renderItem={item => (
              <List.Item
                onClick={() => navigate(`/diary/${item.id}`)}
                style={{
                  cursor: 'pointer',
                  background: item.id === parseInt(id) ? '#e6f7ff' : '#fff',
                  padding: '8px',
                  marginBottom: '8px',
                  borderRadius: '4px',
                  borderLeft: `4px solid #ff85c0`
                }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ fontWeight: 'bold' }}>{item.title || '无标题'}</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>{item.created_date}</div>
                </div>
              </List.Item>
            )}
          />
        </Sider>

        <Content style={{ padding: '0 24px', minHeight: 280 }}>
          <Card title={diary.title || '无标题'}>
            <div style={{ marginBottom: 16 }}>
              <Tag>{diary.created_date}</Tag>
              {diary.mood && <Tag>{diary.mood}</Tag>}
              {diary.weather && <Tag color="blue">{diary.weather}</Tag>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
              {diary.content}
            </div>
          </Card>

          {history.length > 0 && (
            <Card title={<><ClockCircleOutlined /> 修改历史</>} style={{ marginTop: 16 }}>
              <Timeline>
                {history.map(h => (
                  <Timeline.Item key={h.id}>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      {new Date(h.recorded_at).toLocaleString('zh-CN')}
                    </div>
                    <div style={{ marginTop: 8, padding: '8px', background: '#fafafa', borderRadius: '4px' }}>
                      <div style={{ fontWeight: 'bold' }}>{h.title}</div>
                      <div style={{ marginTop: 4, fontSize: '14px' }}>{h.content}</div>
                    </div>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
