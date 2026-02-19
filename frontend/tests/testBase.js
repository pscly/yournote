import { test as base, expect } from '@playwright/test';

const SAMPLE_NOW_ISO = '2026-02-08T00:00:00Z';
const SAMPLE_DATE = '2026-02-08';
const SAMPLE_TS_MS = 1770508800000;

function shouldMockApi() {
  const raw = String(process.env.E2E_MOCK_API ?? '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return {
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(data),
  };
}

function getSampleUser() {
  return {
    id: 1,
    nideriji_userid: 10001,
    name: '测试用户',
    description: null,
    role: null,
    avatar: null,
    diary_count: 1,
    word_count: 10,
    image_count: 0,
    last_login_time: SAMPLE_NOW_ISO,
    created_at: SAMPLE_NOW_ISO,
  };
}

function getSampleAccount() {
  return {
    id: 1,
    nideriji_userid: 10001,
    user_name: '测试用户',
    email: null,
    is_active: true,
    token_status: {
      is_valid: true,
      expired: false,
      expires_at: null,
      checked_at: SAMPLE_NOW_ISO,
      reason: null,
    },
    last_diary_ts: SAMPLE_TS_MS,
    created_at: SAMPLE_NOW_ISO,
    updated_at: SAMPLE_NOW_ISO,
  };
}

function getSampleDiaryListItem() {
  return {
    id: 1,
    nideriji_diary_id: 111,
    user_id: 1,
    account_id: 1,
    created_date: SAMPLE_DATE,
    ts: SAMPLE_TS_MS,
    created_at: SAMPLE_NOW_ISO,
    updated_at: SAMPLE_NOW_ISO,
    title: '测试标题',
    content_preview: '这是一个用于 E2E 的稳定测试记录预览。',
    word_count_no_ws: 16,
    msg_count: 7,
    weather: null,
    mood: null,
    space: null,
  };
}

function getSampleDiaryDetail() {
  return {
    id: 1,
    nideriji_diary_id: 111,
    user_id: 1,
    account_id: 1,
    title: '测试标题',
    content: [
      '这是一个用于 E2E 的稳定测试记录正文。',
      '',
      '[12:34] 你可以在这里测试“时间转换/阅读模式/导出”等 UI。',
    ].join('\n'),
    created_date: SAMPLE_DATE,
    created_time: SAMPLE_NOW_ISO,
    weather: null,
    mood: null,
    space: null,
    msg_count: 7,
    ts: SAMPLE_TS_MS,
    created_at: SAMPLE_NOW_ISO,
    updated_at: SAMPLE_NOW_ISO,
    attachments: { images: [] },
  };
}

function buildDiaryQueryResponse(url) {
  const limit = Math.max(1, Number(url.searchParams.get('limit') || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

  const hasItem = offset === 0;
  const items = hasItem ? [getSampleDiaryListItem()] : [];

  return {
    count: 1,
    limit,
    offset,
    has_more: offset + items.length < 1,
    took_ms: 1,
    normalized: {
      mode: String(url.searchParams.get('q_mode') || 'and'),
      syntax: String(url.searchParams.get('q_syntax') || 'smart'),
      terms: [],
      phrases: [],
      excludes: [],
    },
    items,
  };
}

function buildStatsDashboardResponse(url) {
  const latestLimit = Math.max(1, Number(url.searchParams.get('latest_limit') || 40));
  const latestPreviewLen = Math.max(0, Number(url.searchParams.get('latest_preview_len') || 120));

  return {
    overview: {
      total_accounts: 1,
      total_users: 1,
      paired_diaries_count: 0,
      total_msg_count: 7,
      last_sync_time: SAMPLE_NOW_ISO,
    },
    accounts: [getSampleAccount()],
    latest_paired_diaries: {
      limit: latestLimit,
      preview_len: latestPreviewLen,
      took_ms: 1,
      items: [],
      authors: [],
    },
  };
}

function buildMsgCountIncreaseResponse(url) {
  const limit = Math.max(1, Number(url.searchParams.get('limit') || 20));
  const sinceMs = Number(url.searchParams.get('since_ms') || '');
  const untilMs = Number(url.searchParams.get('until_ms') || '');

  const sinceTime = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : SAMPLE_NOW_ISO;
  const untilTime = Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null;

  const items = [
    {
      account_id: 1,
      diary_id: 1,
      delta: 3,
      title: '测试标题',
      created_date: SAMPLE_DATE,
      msg_count: 7,
      account_user_name: '测试用户',
      last_event_at: SAMPLE_NOW_ISO,
    },
  ];

  return {
    total_delta: 3,
    limit,
    items: items.slice(0, limit),
    since_time: sinceTime,
    until_time: untilTime,
  };
}

function buildPairedIncreaseResponse(url) {
  const sinceMs = Number(url.searchParams.get('since_ms') || '');
  const sinceTime = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : SAMPLE_NOW_ISO;

  return {
    count: 0,
    diaries: [],
    authors: [],
    since_time: sinceTime,
  };
}

export const test = base.extend({
  page: async ({ page }, withPage) => {
    if (shouldMockApi()) {
      await page.route('**/api/**', async (route, request) => {
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method().toUpperCase();

        // Access gate
        if (path === '/api/access/status' && method === 'GET') {
          await route.fulfill(jsonResponse({ ok: true }));
          return;
        }
        if (path === '/api/access/login' && method === 'POST') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        if (path === '/api/access/logout' && method === 'POST') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }

        // Access log
        if (path === '/api/access-logs/pageview' && method === 'POST') {
          await route.fulfill(jsonResponse({ ok: true, enabled: false }));
          return;
        }
        if (path === '/api/access-logs/file' && method === 'GET') {
          await route.fulfill(jsonResponse({ enabled: false, path: null }));
          return;
        }

        // Accounts
        if (path === '/api/accounts' && method === 'GET') {
          await route.fulfill(jsonResponse([getSampleAccount()]));
          return;
        }
        if (path === '/api/accounts' && method === 'POST') {
          await route.fulfill(jsonResponse(getSampleAccount()));
          return;
        }
        if (path === '/api/accounts/meta' && method === 'GET') {
          await route.fulfill(jsonResponse([
            { id: 1, nideriji_userid: 10001, user_name: '测试用户' },
          ]));
          return;
        }
        if (/^\/api\/accounts\/\d+$/.test(path) && method === 'DELETE') {
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        if (/^\/api\/accounts\/\d+\/token$/.test(path) && method === 'PUT') {
          await route.fulfill(jsonResponse(getSampleAccount()));
          return;
        }

        // Users
        if (path === '/api/users' && method === 'GET') {
          await route.fulfill(jsonResponse([getSampleUser()]));
          return;
        }
        if (/^\/api\/users\/\d+$/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse(getSampleUser()));
          return;
        }
        if (/^\/api\/users\/paired\/\d+$/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse([]));
          return;
        }

        // Diaries
        if (path === '/api/diaries/query' && method === 'GET') {
          await route.fulfill(jsonResponse(buildDiaryQueryResponse(url)));
          return;
        }
        if (path === '/api/diaries' && method === 'GET') {
          await route.fulfill(jsonResponse([getSampleDiaryDetail()]));
          return;
        }
        if (/^\/api\/diaries\/\d+$/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse(getSampleDiaryDetail()));
          return;
        }
        if (/^\/api\/diaries\/\d+\/refresh$/.test(path) && method === 'POST') {
          await route.fulfill(jsonResponse({
            diary: getSampleDiaryDetail(),
            refresh_info: {
              min_len_threshold: 0,
              used_sync: false,
              sync_found: false,
              used_all_by_ids: false,
              all_by_ids_returned: null,
              updated: false,
              update_source: null,
              skipped_reason: 'mock',
            },
          }));
          return;
        }

        // Diary history
        if (/^\/api\/diary-history\/\d+$/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse([]));
          return;
        }

        // Sync
        if (path === '/api/sync/logs/latest' && method === 'GET') {
          await route.fulfill(jsonResponse([]));
          return;
        }
        if (path === '/api/sync/logs' && method === 'GET') {
          await route.fulfill(jsonResponse([]));
          return;
        }

        // Stats
        if (path === '/api/stats/overview' && method === 'GET') {
          await route.fulfill(jsonResponse({
            total_accounts: 1,
            total_users: 1,
            paired_diaries_count: 0,
            total_msg_count: 7,
            last_sync_time: SAMPLE_NOW_ISO,
          }));
          return;
        }
        if (path === '/api/stats/dashboard' && method === 'GET') {
          await route.fulfill(jsonResponse(buildStatsDashboardResponse(url)));
          return;
        }
        if (path === '/api/stats/msg-count/increase' && method === 'GET') {
          await route.fulfill(jsonResponse(buildMsgCountIncreaseResponse(url)));
          return;
        }
        if (path === '/api/stats/paired-diaries/increase' && method === 'GET') {
          await route.fulfill(jsonResponse(buildPairedIncreaseResponse(url)));
          return;
        }

        // Publish diary
        if (path === '/api/publish-diaries/runs' && method === 'GET') {
          await route.fulfill(jsonResponse([]));
          return;
        }
        if (/^\/api\/publish-diaries\/runs\/latest-by-date$/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse({
            count: 0,
            limit: 50,
            offset: 0,
            has_more: false,
            items: [],
          }));
          return;
        }
        if (/^\/api\/publish-diaries\/draft\/.+/.test(path) && method === 'GET') {
          await route.fulfill(jsonResponse({ content: '', updated_at: null }));
          return;
        }
        if (/^\/api\/publish-diaries\/draft\/.+/.test(path) && method === 'PUT') {
          await route.fulfill(jsonResponse({ updated_at: SAMPLE_NOW_ISO }));
          return;
        }

        // Fallback: 对未覆盖的 /api 请求返回 204，保证 UI 不会因为 mock 不全而“爆红”
        await route.fulfill({ status: 204, body: '' });
      });
    }

    await withPage(page);
  },
});

export { expect };
