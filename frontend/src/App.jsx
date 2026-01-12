import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  ConfigProvider,
  Drawer,
  Grid,
  Layout,
  Menu,
  Space,
  Switch,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  SendOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';

import Dashboard from './pages/Dashboard';
import AccountManage from './pages/AccountManage';
import DiaryList from './pages/DiaryList';
import DiaryDetail from './pages/DiaryDetail';
import PublishDiary from './pages/PublishDiary';
import AllUsers from './pages/AllUsers';
import UserDetail from './pages/UserDetail';
import SyncLogs from './pages/SyncLogs';
import AccessGate from './pages/AccessGate';

import SyncMonitor from './components/SyncMonitor';
import { accessAPI, accessLogAPI } from './services/api';
import './App.css';

const { Header, Sider, Content } = Layout;

const THEME_KEY = 'yournote_theme_mode';

function getInitialThemeMode() {
  const apply = (mode) => {
    try {
      document.documentElement.setAttribute('data-theme', mode);
    } catch {
      // ignore
    }
    return mode;
  };

  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return apply(saved);
  } catch {
    // ignore
  }
  const prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  return apply(prefersDark ? 'dark' : 'light');
}

function BeijingClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const text = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now).replace(/\//g, '-');
    } catch {
      return '';
    }
  }, [now]);

  if (!text) return null;
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
      北京时间 {text}
    </Typography.Text>
  );
}

function AppShell({ themeMode, setThemeMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();

  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const isAccessPage = (location.pathname || '').startsWith('/access');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  const selectedKey = useMemo(() => {
    const pathname = location.pathname || '/';
    if (pathname === '/' || pathname.startsWith('/dashboard')) return '/';
    if (pathname.startsWith('/accounts')) return '/accounts';
    if (pathname.startsWith('/diaries') || pathname.startsWith('/diary/')) return '/diaries';
    if (pathname.startsWith('/publish')) return '/publish';
    if (pathname.startsWith('/users') || pathname.startsWith('/user/')) return '/users';
    if (pathname.startsWith('/sync-logs')) return '/sync-logs';
    return null;
  }, [location.pathname]);

  const navItems = useMemo(() => ([
    { key: '/', icon: <AppstoreOutlined />, label: '仪表盘' },
    { key: '/accounts', icon: <UserOutlined />, label: '账号管理' },
    { key: '/diaries', icon: <BookOutlined />, label: '日记列表' },
    { key: '/publish', icon: <SendOutlined />, label: '发布日记' },
    { key: '/users', icon: <TeamOutlined />, label: '所有用户' },
    { key: '/sync-logs', icon: <HistoryOutlined />, label: '同步记录' },
  ]), []);

  const titleText = useMemo(() => {
    const match = navItems.find(i => i.key === selectedKey);
    return match?.label || 'YourNote';
  }, [navItems, selectedKey]);

  const menuNode = (
    <Menu
      mode="inline"
      selectedKeys={selectedKey ? [selectedKey] : []}
      items={navItems}
      onClick={(e) => {
        setDrawerOpen(false);
        if (e?.key) navigate(e.key);
      }}
      style={{ borderInlineEnd: 0 }}
    />
  );

  useEffect(() => {
    const path = `${location.pathname || '/'}${location.search || ''}`;

    const getClientId = () => {
      const key = 'yournote_client_id';
      try {
        const existing = localStorage.getItem(key);
        if (existing) return existing;
        const id = globalThis.crypto?.randomUUID?.()
          ?? `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

  const handleThemeChange = (checked) => {
    setThemeMode(checked ? 'dark' : 'light');
  };

  const handleLogout = async () => {
    try {
      await accessAPI.logout();
    } catch {
      // ignore
    } finally {
      message.info('已退出访问');
      navigate('/access', { replace: true });
    }
  };

  const logoGradient = `linear-gradient(135deg, ${token.colorPrimary}, ${token.colorPrimaryHover || token.colorPrimary})`;

  return (
    <Layout style={{ minHeight: '100vh' }}>
        {!isAccessPage && !isMobile && (
          <Sider
            collapsible
            collapsed={siderCollapsed}
            onCollapse={setSiderCollapsed}
            width={240}
            style={{
              background: token.colorBgContainer,
              borderRight: `1px solid ${token.colorBorderSecondary}`,
              // PC 端：左侧导航栏固定在视窗内，避免页面滚动时一起“跑掉”
              position: 'sticky',
              top: 0,
              height: '100vh',
              overflowY: 'auto',
            }}
          >
          <div
            style={{
              height: 64,
              display: 'flex',
              alignItems: 'center',
              paddingInline: siderCollapsed ? 12 : 16,
              gap: 10,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: logoGradient,
              }}
            />
            {!siderCollapsed && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, lineHeight: 1.1 }}>YourNote</div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>本地日记采集与发布</div>
              </div>
            )}
          </div>

          <div style={{ padding: 8 }}>
            {menuNode}
          </div>
        </Sider>
      )}

      <Layout>
        {!isAccessPage && (
          <Header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 100,
              height: 64,
              paddingInline: isMobile ? 12 : 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              overflow: 'hidden',
              background: token.colorBgContainer,
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                  aria-label="打开菜单"
                />
              )}
              <Typography.Title
                level={4}
                style={{
                  margin: 0,
                  minWidth: 0,
                  fontSize: isMobile ? 16 : undefined,
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {titleText}
              </Typography.Title>
              {!isMobile && <BeijingClock />}
            </div>

            <Space align="center" size={isMobile ? 8 : 12}>
              <Switch
                checked={themeMode === 'dark'}
                onChange={handleThemeChange}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
                size={isMobile ? 'small' : 'default'}
              />
              <SyncMonitor compact={isMobile} />
              <Button
                type="text"
                icon={<LogoutOutlined />}
                onClick={handleLogout}
                aria-label="退出访问"
              />
            </Space>
          </Header>
        )}

        {isMobile && !isAccessPage && (
          <Drawer
            title="菜单"
            placement="left"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            width={280}
            styles={{ body: { padding: 8 } }}
          >
            {menuNode}
          </Drawer>
        )}

        <Content className="app-content" style={{ padding: 0 }}>
          <Routes>
            <Route path="/access" element={<AccessGate />} />
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
    </Layout>
  );
}

export default function App() {
  const [themeMode, setThemeMode] = useState(() => getInitialThemeMode());

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, themeMode);
    } catch {
      // ignore
    }
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const themeConfig = useMemo(() => {
    const isDark = themeMode === 'dark';
    return {
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: isDark ? '#3b82f6' : '#1677ff',
        borderRadius: 10,
      },
    };
  }, [themeMode]);

  return (
    <ConfigProvider theme={themeConfig}>
      <BrowserRouter>
        <AppShell themeMode={themeMode} setThemeMode={setThemeMode} />
      </BrowserRouter>
    </ConfigProvider>
  );
}
