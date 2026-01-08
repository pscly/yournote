import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Table, Button, Spin, message, Tag } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { userAPI, diaryAPI } from '../services/api';

export default function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [diaries, setDiaries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [userRes, diariesRes] = await Promise.all([
        userAPI.get(id),
        diaryAPI.list({ user_id: id, limit: 100 }),
      ]);
      setUser(userRes.data);
      setDiaries(diariesRes.data);
    } catch (error) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },
    { title: '标题', dataIndex: 'title', key: 'title', width: 200 },
    { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
    { title: '心情', dataIndex: 'mood', key: 'mood', width: 80, render: (m) => m && <Tag>{m}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button type="link" onClick={() => navigate(`/diary/${record.id}`)}>查看</Button>
      ),
    },
  ];

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ padding: '24px' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        返回
      </Button>

      <Card title="用户信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} bordered>
          <Descriptions.Item label="用户名">{user.name || '未命名'}</Descriptions.Item>
          <Descriptions.Item label="用户ID">{user.nideriji_userid}</Descriptions.Item>
          <Descriptions.Item label="角色">{user.role}</Descriptions.Item>
          <Descriptions.Item label="日记数">{user.diary_count}</Descriptions.Item>
          <Descriptions.Item label="字数">{user.word_count}</Descriptions.Item>
          <Descriptions.Item label="最后登录">
            {user.last_login_time ? new Date(user.last_login_time).toISOString().slice(0, 19) : '未知'}
          </Descriptions.Item>
          <Descriptions.Item label="个性签名" span={2}>{user.description || '无'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title={`日记列表 (${diaries.length})`}>
        <Table columns={columns} dataSource={diaries} rowKey="id" />
      </Card>
    </div>
  );
}
