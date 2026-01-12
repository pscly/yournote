import { syncAPI } from '../services/api';
import { parseServerDate } from './time';

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
      // 优先走轻量接口；老后端没有该接口时回退到历史接口
      let res;
      try {
        res = await syncAPI.logsLatest({ account_id: accountId, limit: 1 });
      } catch (e) {
        const status = e?.response?.status;
        if (status === 404) {
          res = await syncAPI.logs({ account_id: accountId, limit: 1 });
        } else {
          throw e;
        }
      }
      const log = res?.data?.[0];
      if (log?.sync_time) {
        const t = parseServerDate(log.sync_time)?.getTime();
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
