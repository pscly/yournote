import axios from 'axios';
import { API_BASE_URL } from '../config';

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_GET_RETRIES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // 访问密码使用 Cookie 会话；跨域部署时需要携带凭证
  withCredentials: true,
  // 避免后端不可达/卡住导致前端一直转圈（尤其是仪表盘/用户页的初始加载）。
  // 说明：10s 在本地/低性能机器上容易误判“超时”，这里放宽默认超时，并配合 GET 自动重试提升稳定性。
  timeout: DEFAULT_TIMEOUT_MS,
});

// 统一拦截未授权：后端返回 401 + ACCESS_REQUIRED 时跳转到访问密码页
api.interceptors.response.use(
  (response) => response,
  async (error) => {
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

    // 说明：
    // - 部分接口偶发网络抖动/后端压力导致超时；
    // - 对幂等 GET 做有限次重试（指数退避），优先提升“能访问到数据”的概率；
    // - 非 GET（POST/PUT/DELETE）不自动重试，避免副作用。
    const config = error?.config;
    const method = (config?.method || '').toLowerCase();
    const timeoutMs = config?.timeout;
    const retryCount = config?.__retryCount ?? 0;

    const isTimeout = error?.code === 'ECONNABORTED'
      || (typeof error?.message === 'string' && error.message.toLowerCase().includes('timeout'));
    const isNetwork = !error?.response;

    if (
      config
      && method === 'get'
      && timeoutMs !== 0
      && retryCount < MAX_GET_RETRIES
      && (isTimeout || isNetwork)
    ) {
      config.__retryCount = retryCount + 1;
      const backoffMs = 400 * (2 ** (config.__retryCount - 1));
      await sleep(backoffMs);
      return api.request(config);
    }

    return Promise.reject(error);
  },
);

// 账号管理
export const accountAPI = {
  list: () => api.get('/accounts'),
  meta: () => api.get('/accounts/meta'),
  create: (data) => api.post('/accounts', data),
  get: (id) => api.get(`/accounts/${id}`),
  delete: (id) => api.delete(`/accounts/${id}`),
  validate: (id) => api.post(`/accounts/${id}/validate`),
  validateBatch: (data) => api.post('/accounts/validate-batch', data),
  validateToken: (data) => api.post('/accounts/validate-token', data),
  updateToken: (id, data) => api.put(`/accounts/${id}/token`, data),
};

// 数据同步
export const syncAPI = {
  // 手动同步可能需要更长时间，单独放宽 timeout，避免被 axios 默认 10s 误判超时。
  trigger: (accountId, config = {}) =>
    api.post(`/sync/trigger/${accountId}`, null, { timeout: 0, ...config }),   
  logs: (params) => api.get('/sync/logs', { params }),
  logsLatest: (params) => api.get('/sync/logs/latest', { params }),
};

// 仪表盘统计
export const statsAPI = {
  overview: () => api.get('/stats/overview'),
  dashboard: (params) => api.get('/stats/dashboard', { params }),
  pairedDiariesIncrease: (params) => api.get('/stats/paired-diaries/increase', { params }),
  msgCountIncrease: (params) => api.get('/stats/msg-count/increase', { params }),
};

// 记录查询
export const diaryAPI = {
  list: (params) => api.get('/diaries', { params }),
  query: (params) => api.get('/diaries/query', { params }),
  get: (id) => api.get(`/diaries/${id}`),
  byAccount: (accountId, limit = 50) => api.get(`/diaries/by-account/${accountId}`, { params: { limit } }),
  refresh: (id) => api.post(`/diaries/${id}/refresh`),
  setBookmark: (diaryId, bookmarked) => api.put(`/diaries/${diaryId}/bookmark`, { bookmarked }),
  setBookmarksBatch: (diaryIds, bookmarked) => api.put('/diaries/bookmarks/batch', { diary_ids: diaryIds, bookmarked }),
};

// 记录修改历史
export const diaryHistoryAPI = {
  list: (diaryId) => api.get(`/diary-history/${diaryId}`),
};

// 用户信息
export const userAPI = {
  list: (limit = 50) => api.get('/users', { params: { limit } }),
  get: (id) => api.get(`/users/${id}`),
  lastLogin: (id) => api.get(`/users/${id}/last-login`),
  credentials: (id) => api.get(`/users/${id}/credentials`),
  paired: (accountId, params) => api.get(`/users/paired/${accountId}`, { params }),
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

// 发布记录（草稿/历史/一键发布）
export const publishDiaryAPI = {
  getDraft: (date) => api.get(`/publish-diaries/draft/${encodeURIComponent(date)}`),
  saveDraft: (date, data) => api.put(`/publish-diaries/draft/${encodeURIComponent(date)}`, data),
  listRuns: (params) => api.get('/publish-diaries/runs', { params }),
  listLatestRunsByDate: (params) => api.get('/publish-diaries/runs/latest-by-date', { params }),
  getRun: (id) => api.get(`/publish-diaries/runs/${id}`),
  // 创建一次“发布 Run”（不执行发布），用于前端并行逐账号发布时先拿到 run_id
  createRun: (data, config = {}) => api.post('/publish-diaries/runs', data, { timeout: 0, ...config }),
  // 启动 run 的后台发布任务（前端可关闭/刷新页面，后端仍会继续）
  startRun: (runId, data, config = {}) =>
    api.post(`/publish-diaries/runs/${runId}/start`, data, { timeout: 0, ...config }),
  // 单账号发布（用于前端并行逐账号调用）；timeout=0 避免 axios 默认 10s 误判
  publishOne: (runId, data, config = {}) =>
    api.post(`/publish-diaries/runs/${runId}/publish-one`, data, { timeout: 0, ...config }),
  // 兼容旧版“一次性批量发布”；timeout=0 避免请求时间较长时被前端中断
  publish: (data, config = {}) => api.post('/publish-diaries/publish', data, { timeout: 0, ...config }),
};

export default api;
