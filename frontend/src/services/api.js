import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 访问密码使用 Cookie 会话；跨域部署时需要携带凭证
  withCredentials: true,
  // 避免后端不可达/卡住导致前端一直转圈（尤其是仪表盘/用户页的初始加载）。
  timeout: 10000,
});

// 统一拦截未授权：后端返回 401 + ACCESS_REQUIRED 时跳转到访问密码页
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const detail = error?.response?.data?.detail;
    if (status === 401 && detail === 'ACCESS_REQUIRED') {
      const pathname = globalThis.location?.pathname || '/';
      if (!pathname.startsWith('/access')) {
        const search = globalThis.location?.search || '';
        const hash = globalThis.location?.hash || '';
        const redirect = `${pathname}${search}${hash}`;
        const target = `/access?redirect=${encodeURIComponent(redirect)}`;
        globalThis.location?.replace?.(target);
      }
    }

    return Promise.reject(error);
  },
);

// 账号管理
export const accountAPI = {
  list: () => api.get('/accounts'),      
  create: (data) => api.post('/accounts', data),
  get: (id) => api.get(`/accounts/${id}`),
  delete: (id) => api.delete(`/accounts/${id}`),
  validate: (id) => api.post(`/accounts/${id}/validate`),
  validateToken: (data) => api.post('/accounts/validate-token', data),
  updateToken: (id, data) => api.put(`/accounts/${id}/token`, data),
};

// 数据同步
export const syncAPI = {
  // 手动同步可能需要更长时间，单独放宽 timeout，避免被 axios 默认 10s 误判超时。
  trigger: (accountId, config = {}) =>
    api.post(`/sync/trigger/${accountId}`, null, { timeout: 0, ...config }),
  logs: (params) => api.get('/sync/logs', { params }),
};

// 仪表盘统计
export const statsAPI = {
  overview: () => api.get('/stats/overview'),
};

// 日记查询
export const diaryAPI = {
  list: (params) => api.get('/diaries', { params }),
  get: (id) => api.get(`/diaries/${id}`),
  byAccount: (accountId, limit = 50) => api.get(`/diaries/by-account/${accountId}`, { params: { limit } }),
  refresh: (id) => api.post(`/diaries/${id}/refresh`),
};

// 日记修改历史
export const diaryHistoryAPI = {
  list: (diaryId) => api.get(`/diary-history/${diaryId}`),
};

// 用户信息
export const userAPI = {
  list: (limit = 50) => api.get('/users', { params: { limit } }),
  get: (id) => api.get(`/users/${id}`),
  lastLogin: (id) => api.get(`/users/${id}/last-login`),
  paired: (accountId) => api.get(`/users/paired/${accountId}`),
};

// 访问日志（页面访问上报）
export const accessLogAPI = {
  pageview: (data) => api.post('/access-logs/pageview', data),
  file: (params) => api.get('/access-logs/file', { params }),
};

// 访问密码（站点级门禁）
export const accessAPI = {
  login: (data) => api.post('/access/login', data),
  logout: () => api.post('/access/logout'),
  status: () => api.get('/access/status'),
};

// 发布日记（草稿/历史/一键发布）
export const publishDiaryAPI = {
  getDraft: (date) => api.get(`/publish-diaries/draft/${encodeURIComponent(date)}`),
  saveDraft: (date, data) => api.put(`/publish-diaries/draft/${encodeURIComponent(date)}`, data),
  listRuns: (params) => api.get('/publish-diaries/runs', { params }),
  getRun: (id) => api.get(`/publish-diaries/runs/${id}`),
  publish: (data) => api.post('/publish-diaries/publish', data),
};

export default api;
