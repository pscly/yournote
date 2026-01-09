import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 避免后端不可达/卡住导致前端一直转圈（尤其是仪表盘/用户页的初始加载）。
  timeout: 10000,
});

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
  trigger: (accountId) => api.post(`/sync/trigger/${accountId}`),     
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

// 发布日记（草稿/历史/一键发布）
export const publishDiaryAPI = {
  getDraft: (date) => api.get(`/publish-diaries/draft/${encodeURIComponent(date)}`),
  saveDraft: (date, data) => api.put(`/publish-diaries/draft/${encodeURIComponent(date)}`, data),
  listRuns: (params) => api.get('/publish-diaries/runs', { params }),
  getRun: (id) => api.get(`/publish-diaries/runs/${id}`),
  publish: (data) => api.post('/publish-diaries/publish', data),
};

export default api;
