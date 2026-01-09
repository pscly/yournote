import { syncAPI } from '../services/api';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForLatestSyncLog(accountId, startedAtMs, options = {}) {
  const {
    intervalMs = 2000,
    timeoutMs = 60000,
    acceptRunning = false,
  } = options;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await syncAPI.logs({ account_id: accountId, limit: 1 });
      const log = res?.data?.[0];
      if (log?.sync_time) {
        const t = new Date(log.sync_time).getTime();
        if (!Number.isNaN(t) && t >= startedAtMs - 2000) {
          if (acceptRunning || log.status !== 'running') return log;
        }
      }
    } catch {
      // 轮询期间忽略临时错误，继续重试
    }

    await sleep(intervalMs);
  }

  return null;
}
