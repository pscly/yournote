import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import { DashboardOutlined, UserOutlined, BookOutlined, TeamOutlined } from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import AccountManage from './pages/AccountManage';
import DiaryList from './pages/DiaryList';
import DiaryDetail from './pages/DiaryDetail';
import AllUsers from './pages/AllUsers';
import UserDetail from './pages/UserDetail';
import './App.css';

const { Header, Content } = Layout;

function App() {
  return (
    <BrowserRouter>
      <Layout style={{ minHeight: '100vh' }}>
        <Header>
          <div style={{ color: 'white', fontSize: '20px', float: 'left', marginRight: '50px' }}>
            YourNote
          </div>
          <Menu theme="dark" mode="horizontal" defaultSelectedKeys={['1']}>
            <Menu.Item key="1" icon={<DashboardOutlined />}>
              <Link to="/">仪表盘</Link>
            </Menu.Item>
            <Menu.Item key="2" icon={<UserOutlined />}>
              <Link to="/accounts">账号管理</Link>
            </Menu.Item>
            <Menu.Item key="3" icon={<BookOutlined />}>
              <Link to="/diaries">日记列表</Link>
            </Menu.Item>
            <Menu.Item key="4" icon={<TeamOutlined />}>
              <Link to="/users">所有用户</Link>
            </Menu.Item>
          </Menu>
        </Header>
        <Content style={{ padding: '0 50px', marginTop: 64 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<AccountManage />} />
            <Route path="/diaries" element={<DiaryList />} />
            <Route path="/diary/:id" element={<DiaryDetail />} />
            <Route path="/users" element={<AllUsers />} />
            <Route path="/user/:id" element={<UserDetail />} />
          </Routes>
        </Content>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
