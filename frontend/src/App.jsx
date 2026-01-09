import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Button, Drawer, Grid, Layout, Menu, Space, Typography } from 'antd';
import { BookOutlined, DashboardOutlined, HistoryOutlined, SendOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { MenuOutlined } from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import AccountManage from './pages/AccountManage';
import DiaryList from './pages/DiaryList';
import DiaryDetail from './pages/DiaryDetail';
import PublishDiary from './pages/PublishDiary';
import AllUsers from './pages/AllUsers';
import UserDetail from './pages/UserDetail';
import SyncLogs from './pages/SyncLogs';
import SyncMonitor from './components/SyncMonitor';
import { accessLogAPI } from './services/api';
import './App.css';

const { Header, Content } = Layout;
const APP_HEADER_HEIGHT = 'var(--app-header-height)';

function AppHeaderMenu() {
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pathname = location.pathname || '/';
  const selectedKey = (() => {
    if (pathname.startsWith('/accounts')) return '/accounts';
    if (pathname.startsWith('/diaries') || pathname.startsWith('/diary/')) return '/diaries';
    if (pathname.startsWith('/publish')) return '/publish';
    if (pathname.startsWith('/users') || pathname.startsWith('/user/')) return '/users';
    if (pathname.startsWith('/sync-logs')) return '/sync-logs';
    return '/';
  })();

  const items = useMemo(() => ([
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">仪表盘</Link> },
    { key: '/accounts', icon: <UserOutlined />, label: <Link to="/accounts">账号管理</Link> },
    { key: '/diaries', icon: <BookOutlined />, label: <Link to="/diaries">日记列表</Link> },
    { key: '/publish', icon: <SendOutlined />, label: <Link to="/publish">发布日记</Link> },
    { key: '/users', icon: <TeamOutlined />, label: <Link to="/users">所有用户</Link> },
    { key: '/sync-logs', icon: <HistoryOutlined />, label: <Link to="/sync-logs">同步记录</Link> },
  ]), []);

  if (isMobile) {
    return (
      <>
        <Button
          type="text"
          icon={<MenuOutlined style={{ color: 'white', fontSize: 18 }} />}
          onClick={() => setDrawerOpen(true)}
          aria-label="打开菜单"
        />
        <Drawer
          title="菜单"
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={280}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={items}
            onClick={() => setDrawerOpen(false)}
          />
        </Drawer>
      </>
    );
  }

  return (
    <Menu
      theme="dark"
      mode="horizontal"
      selectedKeys={[selectedKey]}
      style={{ flex: 1, minWidth: 0 }}
      items={items}
    />
  );
}

function AppShell() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const headerPadding = isMobile ? 12 : 24;
  const location = useLocation();

  useEffect(() => {
    const path = `${location.pathname || '/'}${location.search || ''}`;

    const getClientId = () => {
      const key = 'yournote_client_id';
      try {
        const existing = localStorage.getItem(key);
        if (existing) return existing;
        const id = globalThis.crypto?.randomUUID?.() ?? `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(key, id);
        return id;
      } catch {
        return null;
      }
    };

    // 上报失败不影响页面；只做 best-effort 的本地访问记录
    accessLogAPI.pageview({
      path,
      client_id: getClientId(),
      title: document.title || null,
      referrer: document.referrer || null,
    }).catch(() => {});
  }, [location.pathname, location.search]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          position: 'fixed',
          top: 0,
          zIndex: 1000,
          width: '100%',
          height: APP_HEADER_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          paddingInline: headerPadding,
          gap: 12,
        }}
      >
        <Space align="center" style={{ flex: 1, minWidth: 0 }} size={12}>
          <Typography.Title
            level={4}
            style={{
              color: 'white',
              margin: 0,
              whiteSpace: 'nowrap',
            }}
          >
            YourNote
          </Typography.Title>
          <AppHeaderMenu />
        </Space>
        <div>
          <SyncMonitor />
        </div>
      </Header>

      <Content className="app-content" style={{ marginTop: APP_HEADER_HEIGHT }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<AccountManage />} />
          <Route path="/diaries" element={<DiaryList />} />
          <Route path="/diary/:id" element={<DiaryDetail />} />
          <Route path="/publish" element={<PublishDiary />} />
          <Route path="/users" element={<AllUsers />} />
          <Route path="/user/:id" element={<UserDetail />} />
          <Route path="/sync-logs" element={<SyncLogs />} />
        </Routes>
      </Content>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
