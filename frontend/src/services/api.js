import axios from 'axios';
import { API_BASE_URL } from '../config';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 账号管理
export const accountAPI = {
  list: () => api.get('/accounts'),
  create: (data) => api.post('/accounts', data),
  get: (id) => api.get(`/accounts/${id}`),
  delete: (id) => api.delete(`/accounts/${id}`),
};

// 数据同步
export const syncAPI = {
  trigger: (accountId) => api.post(`/sync/trigger/${accountId}`),
  logs: (params) => api.get('/sync/logs', { params }),
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

export default api;
