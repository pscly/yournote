import { useState, useEffect } from 'react';
import { Table, Select, message, Tag, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { diaryAPI, accountAPI, userAPI } from '../services/api';

export default function DiaryList() {
  const navigate = useNavigate();
  const [diaries, setDiaries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);

  useEffect(() => {
    loadAccounts();
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedAccount) {
      loadDiaries();
    }
  }, [selectedAccount]);

  const loadUsers = async () => {
    try {
      const res = await userAPI.list();
      const userMap = {};
      res.data.forEach(u => {
        userMap[u.nideriji_userid] = u.name;
      });
      setUsers(userMap);
    } catch (error) {
      console.error('加载用户失败');
    }
  };

  const loadAccounts = async () => {
    try {
      const res = await accountAPI.list();
      setAccounts(res.data);
      if (res.data.length > 0) {
        setSelectedAccount(res.data[0].id);
      }
    } catch (error) {
      message.error('加载账号失败');
    }
  };

  const loadDiaries = async () => {
    setLoading(true);
    try {
      const res = await diaryAPI.byAccount(selectedAccount);
      setDiaries(res.data);
    } catch (error) {
      message.error('加载日记失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    { title: '日期', dataIndex: 'created_date', key: 'date', width: 120 },
    { title: '标题', dataIndex: 'title', key: 'title', width: 200 },
    { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
    { title: '心情', dataIndex: 'mood', key: 'mood', width: 80, render: (mood) => mood && <Tag>{mood}</Tag> },
    { title: '天气', dataIndex: 'weather', key: 'weather', width: 80, render: (w) => w && <Tag color="blue">{w}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button type="link" onClick={() => navigate(`/diary/${record.id}`)}>
          查看详情
        </Button>
      ),
    },
  ];

  const getAccountLabel = (account) => {
    const userName = users[account.nideriji_userid];
    return userName ? `${userName} (${account.nideriji_userid})` : `账号 ${account.nideriji_userid}`;
  };

  return (
    <div style={{ padding: '24px' }}>
      <h1>日记列表</h1>
      <Select
        style={{ width: 250, marginBottom: 16 }}
        value={selectedAccount}
        onChange={setSelectedAccount}
        options={accounts.map(a => ({ label: getAccountLabel(a), value: a.id }))}
      />
      <Table columns={columns} dataSource={diaries} rowKey="id" loading={loading} />
    </div>
  );
}
