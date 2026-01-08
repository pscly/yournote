import { useState, useEffect } from 'react';
import { Card, Row, Col, Spin, message, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import { userAPI, accountAPI } from '../services/api';

export default function AllUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [pairedUserIds, setPairedUserIds] = useState(new Set());
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

      const pairedIds = new Set();
      for (const account of accountsRes.data) {
        try {
          const pairedRes = await userAPI.paired(account.id);
          pairedRes.data.forEach(p => {
            pairedIds.add(p.paired_user.id);
          });
        } catch (error) {
          console.error('加载配对关系失败');
        }
      }

      setUsers(usersRes.data);
      setPairedUserIds(pairedIds);
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
    <div style={{ padding: '24px' }}>
      <h1>所有用户</h1>
      <Row gutter={[16, 16]}>
        {users.map(user => {
          const isPaired = pairedUserIds.has(user.id);
          return (
            <Col key={user.id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                onClick={() => navigate(`/user/${user.id}`)}
                style={{
                  backgroundColor: isPaired ? '#fff0f6' : '#fff',
                  borderColor: isPaired ? '#ff85c0' : '#d9d9d9',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <h3>{user.name || '未命名'}</h3>
                  {isPaired && <Tag color="magenta">配对用户</Tag>}
                  <p style={{ color: '#666', fontSize: '12px' }}>ID: {user.nideriji_userid}</p>
                  <p style={{ color: '#999', fontSize: '12px' }}>
                    日记数: {user.diary_count}
                  </p>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
