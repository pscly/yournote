import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Divider, Grid, Input, InputNumber, List, Pagination, Segmented, Skeleton, Tooltip, message, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { ClockCircleOutlined, ReloadOutlined, SaveOutlined, SendOutlined, UndoOutlined } from '@ant-design/icons';
import { accountAPI, publishDiaryAPI } from '../services/api';
import Page from '../components/Page';
import { formatBeijingDateTime, formatBeijingDateTimeFromTs } from '../utils/time';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const LAST_SELECTION_KEY = 'yournote_publish_diary_last_account_ids';
const DAILY_LATEST_PREVIEW_SETTINGS_KEY = 'yournote_publish_diary_daily_latest_preview_settings_v1';
const DEFAULT_PUBLISH_CONCURRENCY = 5;
const AUTO_SAVE_DEBOUNCE_MS = 5000;
const AUTO_SAVE_FORCE_MS = (() => {
  // 说明：
  // - 正常产品语义：连续输入时，每 30 秒也会“保底保存”一次草稿，避免长时间不落盘。
  // - E2E 测试语义：允许通过全局变量把 30s 缩短为更小值，避免用例等待太久。
  //   使用方式：在页面脚本加载前注入 `globalThis.__YOUNOTE_E2E_PUBLISH_DRAFT_FORCE_MS__ = 800`
  const raw = globalThis?.__YOUNOTE_E2E_PUBLISH_DRAFT_FORCE_MS__;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return 30000;
})();

function readLocalLastSelection() {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(v => Number.isInteger(v));
  } catch {
    return [];
  }
}

function writeLocalLastSelection(ids) {
  try {
    const list = Array.isArray(ids) ? ids.filter(v => Number.isInteger(v)) : [];
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(list));
  } catch {
    // localStorage 失败不影响业务
  }
}

function readDailyLatestPreviewSettings() {
  const fallback = { enabled: true, preview_len: 200 };
  try {
    const raw = localStorage.getItem(DAILY_LATEST_PREVIEW_SETTINGS_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    const enabled = typeof data?.enabled === 'boolean' ? data.enabled : fallback.enabled;
    const rawLen = Number(data?.preview_len);
    const previewLen = Number.isFinite(rawLen)
      ? Math.min(5000, Math.max(0, rawLen))
      : fallback.preview_len;
    return { enabled, preview_len: previewLen };
  } catch {
    return fallback;
  }
}

function writeDailyLatestPreviewSettings(next) {
  try {
    const enabled = typeof next?.enabled === 'boolean' ? next.enabled : true;
    const rawLen = Number(next?.preview_len);
    const previewLen = Number.isFinite(rawLen) ? Math.min(5000, Math.max(0, rawLen)) : 200;
    localStorage.setItem(
      DAILY_LATEST_PREVIEW_SETTINGS_KEY,
      JSON.stringify({ enabled, preview_len: previewLen }),
    );
  } catch {
    // localStorage 失败不影响业务
  }
}

async function getDefaultSelectionFromLastRun(accountList) {
  const existingIds = (accountList || []).map(a => a?.id).filter(Boolean);
  if (existingIds.length === 0) return [];

  const filterExisting = (ids) => {
    const set = new Set(existingIds);
    return (ids || []).filter(id => set.has(id));
  };

  // 1) 优先从后端“上次发布记录”读取账号组合
  try {
    const res = await publishDiaryAPI.listRuns({ limit: 1 });
    const last = res?.data?.[0];
    const ids = filterExisting(last?.target_account_ids || []);
    if (ids.length > 0) return ids;
  } catch {
    // 失败则走本地回退
  }

  // 2) 回退：使用本地缓存的“上次选择账号”
  const localIds = filterExisting(readLocalLastSelection());
  if (localIds.length > 0) return localIds;

  // 3) 兜底：全选
  return existingIds;
}

function convertQuotedTimesToBracket(value) {
  const text = String(value ?? '');
  let count = 0;
  // 规则：把正文中 “> 12:34” / “> 12:34:56” 这样的时间标记转换为 “[12:34]” / “[12:34:56]”
  // - 支持“任意位置”，但要求 `>` 前为行首或空白，避免误伤 a>12:34:56
  // - 分/秒严格限制 00-59；小时允许 1-2 位
  const out = text.replace(
    /(^|\s)>\s*((?:\d|[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)/gm,
    (_match, prefix, time) => {
      count += 1;
      return `${prefix}[${time}]`;
    },
  );
  return { text: out, count };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateYYYYMMDDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatBeijingDateYYYYMMDD(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    if (!y || !m || !day) return '';
    return `${y}-${m}-${day}`;
  } catch {
    // 极少数环境 Intl 不可用时，退回浏览器本地时区
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
}

function todayStr() {
  return formatBeijingDateYYYYMMDD(new Date());
}

function yesterdayStr() {
  const now = new Date();
  return formatBeijingDateYYYYMMDD(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

function parseDateYYYYMMDD(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  // 用 UTC 解析“纯日期”，避免不同时区/DST 引起的 +/-1 天问题
  const dt = new Date(Date.UTC(y, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function shiftDateStr(value, deltaDays) {
  const base = parseDateYYYYMMDD(value) || parseDateYYYYMMDD(todayStr());
  const days = Number(deltaDays) || 0;
  if (!base) return todayStr();
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateYYYYMMDDUTC(base);
}

export default function PublishDiary() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens?.md;

  const [activeTab, setActiveTab] = useState('edit'); // edit | history

  const [date, setDate] = useState(() => todayStr());
  // 发布历史里的“筛选日期”与编辑器日期解耦：
  // - 避免用户在历史页切换日期时，意外覆盖编辑器里的未保存内容
  const [historyDate, setHistoryDate] = useState(() => todayStr());
  const [content, setContent] = useState('');
  const [draftUpdatedAt, setDraftUpdatedAt] = useState(null);

  // 草稿自动保存（编辑后 5 秒保存）：仅用于“编辑/发布”页的正文编辑区
  const currentDateRef = useRef(date);
  const currentContentRef = useRef(content);
  const autoSaveTimerRef = useRef(null);
  const autoSaveForceTimerRef = useRef(null);
  const draftSavePromiseRef = useRef(null);
  const lastSavedContentRef = useRef('');
  const dirtyRef = useRef(false);
  const dirtySinceTsRef = useRef(0);
  const lastContentBeforeTimeConvertRef = useRef('');

  const [autoSaveUi, setAutoSaveUi] = useState({ status: 'idle', error: '' }); // idle|pending|saving|saved|error
  const [autoSavingDraft, setAutoSavingDraft] = useState(false);
  const [canUndoTimeConvert, setCanUndoTimeConvert] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState([]);

  const [draftLoading, setDraftLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // 发布历史查看方式：
  // - date：按日期筛选（查看当日所有发布）
  // - daily_latest：按天汇总（每个日期只展示“最后一次发布”，用于浏览所有日子的日终稿）
  // - daily_timeline：按天连续阅读（同样是日终稿，但用“时间线/折叠面板”承载正文）
  const [historyView, setHistoryView] = useState('date');
  const [latestByDate, setLatestByDate] = useState({
    count: 0,
    limit: 50,
    offset: 0,
    has_more: false,
    items: [],
  });
  const [latestByDateLoading, setLatestByDateLoading] = useState(false);
  const [latestByDatePage, setLatestByDatePage] = useState(1);
  const [latestByDatePageSize, setLatestByDatePageSize] = useState(50);

  const [dailyLatestPreviewEnabled, setDailyLatestPreviewEnabled] = useState(() => {
    return readDailyLatestPreviewSettings().enabled;
  });
  const [dailyLatestPreviewLen, setDailyLatestPreviewLen] = useState(() => {
    return readDailyLatestPreviewSettings().preview_len;
  });

  const [timelineOpenKeys, setTimelineOpenKeys] = useState([]);
  const [timelineRunDetailsById, setTimelineRunDetailsById] = useState({});
  const [timelineLoadingById, setTimelineLoadingById] = useState({});
  const [timelineErrorById, setTimelineErrorById] = useState({});

  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetail, setRunDetail] = useState(null);

  // 当前“后台发布”的 run（进度状态）。
  // 注意：必须与 runDetail（弹窗里查看的某次 run 详情）解耦，避免用户查看其它 run 时被后台更新覆盖。
  const [activePublishRun, setActivePublishRun] = useState(null);
  const [publishPanelOpen, setPublishPanelOpen] = useState(true);
  const publishMsgKeyRef = useRef(null);
  const publishPollTimerRef = useRef(null);
  const timelineAutoInitRef = useRef('');

  useEffect(() => {
    currentDateRef.current = date;
  }, [date]);

  useEffect(() => {
    currentContentRef.current = content;
  }, [content]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (autoSaveForceTimerRef.current) {
        clearTimeout(autoSaveForceTimerRef.current);
        autoSaveForceTimerRef.current = null;
      }
    };
  }, []);

  const draftStatusText = useMemo(() => {
    const base = draftUpdatedAt ? `草稿更新时间：${formatBeijingDateTime(draftUpdatedAt)}` : '草稿尚未保存';

    let autosave = '自动保存已开启（停顿 5 秒保存；连续输入每 30 秒也会保存一次）';
    if (autoSaveUi?.status === 'pending') autosave = '自动保存：等待输入结束…';
    else if (autoSaveUi?.status === 'saving') autosave = '自动保存中…';
    else if (autoSaveUi?.status === 'saved') autosave = '自动保存：已保存';
    else if (autoSaveUi?.status === 'error') {
      const err = String(autoSaveUi?.error || '未知错误').replace(/\s+/g, ' ').slice(0, 120);
      autosave = `自动保存失败：${err}`;
    }

    return `${base} · ${autosave}`;
  }, [autoSaveUi?.error, autoSaveUi?.status, draftUpdatedAt]);

  const hasUnsavedChanges = String(content ?? '') !== String(lastSavedContentRef.current ?? '');

  const accountOptions = useMemo(() => {
    return (accounts || []).map(a => {
      const name = a?.user_name || a?.nideriji_userid || a?.email || `账号${a?.id}`;
      const lastDiaryTs = a?.last_diary_ts;
      const lastDiaryText = lastDiaryTs ? formatBeijingDateTimeFromTs(lastDiaryTs) : '暂无';
      const label = `${name}（账号ID: ${a?.id} / 用户ID: ${a?.nideriji_userid} / 最近记录: ${lastDiaryText}）`;
      return { label, value: a.id };
    });
  }, [accounts]);

  const allAccountIds = useMemo(() => (accounts || []).map(a => a?.id).filter(Boolean), [accounts]);
  const selectedSet = useMemo(() => new Set(selectedAccountIds || []), [selectedAccountIds]);
  const checkAll = selectedAccountIds.length > 0 && selectedAccountIds.length === allAccountIds.length;
  const indeterminate = selectedAccountIds.length > 0 && selectedAccountIds.length < allAccountIds.length;

  const publishProgress = useMemo(() => {
    const run = activePublishRun;
    const items = Array.isArray(run?.items) ? run.items : [];
    const targetTotal = Array.isArray(run?.target_account_ids) ? run.target_account_ids.length : 0;
    const total = Math.max(items.length, targetTotal);

    let success = 0;
    let failed = 0;
    let running = 0;
    let unknown = 0;

    items.forEach((i) => {
      const s = i?.status;
      if (s === 'success') success += 1;
      else if (s === 'failed') failed += 1;
      else if (s === 'running') running += 1;
      else unknown += 1;
    });

    if (items.length === 0 && total > 0) unknown = total;
    const done = success + failed;

    return { total, success, failed, running, unknown, done };
  }, [activePublishRun]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await accountAPI.list();
      const list = res?.data || [];
      setAccounts(list);

      // 规则：
      // - 如果用户已手动勾选过（prev 非空）：不打扰，仅做“过滤不存在账号”
      // - 如果还没勾选（prev 为空）：默认选中“上次发布的账号组合”，无记录时再全选
      setSelectedAccountIds(prev => {
        if (Array.isArray(prev) && prev.length > 0) {
          return prev.filter(id => list.some(a => a.id === id));
        }
        // 临时返回空，避免先全选再闪一下；真正默认值异步设置
        return [];
      });

      const defaultIds = await getDefaultSelectionFromLastRun(list);
      setSelectedAccountIds(prev => (Array.isArray(prev) && prev.length > 0 ? prev : defaultIds));
    } catch (error) {
      message.error('加载账号失败: ' + (error?.message || String(error)));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  // “按天连续阅读（日终稿）”需要按需拉取每个 run 的完整正文；这里做一个轻量的缓存与并发保护。
  const timelineRunDetailsRef = useRef({});
  const timelineLoadingRef = useRef({});

  useEffect(() => {
    timelineRunDetailsRef.current = timelineRunDetailsById || {};
  }, [timelineRunDetailsById]);

  useEffect(() => {
    timelineLoadingRef.current = timelineLoadingById || {};
  }, [timelineLoadingById]);

  const ensureTimelineRunDetailLoaded = useCallback(async (runId) => {
    const idNum = Number(runId);
    if (!Number.isFinite(idNum) || idNum <= 0) return;
    const id = String(Math.trunc(idNum));

    if (timelineRunDetailsRef.current?.[id]) return;
    if (timelineLoadingRef.current?.[id]) return;

    setTimelineLoadingById(prev => ({ ...(prev || {}), [id]: true }));
    setTimelineErrorById(prev => ({ ...(prev || {}), [id]: '' }));
    try {
      const res = await publishDiaryAPI.getRun(idNum);
      const run = res?.data;
      if (run?.id) {
        setTimelineRunDetailsById(prev => ({ ...(prev || {}), [id]: run }));
      } else {
        setTimelineErrorById(prev => ({ ...(prev || {}), [id]: '返回数据不完整' }));
      }
    } catch (error) {
      const msg = error?.response?.data?.detail || error?.message || String(error);
      setTimelineErrorById(prev => ({ ...(prev || {}), [id]: String(msg || '加载失败') }));
      message.error('加载日终稿内容失败: ' + (msg || '未知错误'));
    } finally {
      setTimelineLoadingById(prev => ({ ...(prev || {}), [id]: false }));
    }
  }, []);

  const expandTimelineRecent = useCallback((count) => {
    const n = Math.max(1, Number(count) || 1);
    const items = Array.isArray(latestByDate?.items) ? latestByDate.items : [];
    const keys = items.slice(0, n).map(r => String(r?.id)).filter(Boolean);
    setTimelineOpenKeys(keys);
    keys.forEach(k => ensureTimelineRunDetailLoaded(k));
  }, [ensureTimelineRunDetailLoaded, latestByDate?.items]);

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  const clearAutoSaveForceTimer = useCallback(() => {
    if (autoSaveForceTimerRef.current) {
      clearTimeout(autoSaveForceTimerRef.current);
      autoSaveForceTimerRef.current = null;
    }
  }, []);

  const saveDraftInternal = async (targetDate, contentValue, { silent = false, reason = '' } = {}) => {
    const d = String(targetDate || '').trim();
    if (!d) return { ok: false, skipped: true, reason: 'no_date' };

    // 避免并发写草稿：若已有保存进行中，直接复用同一个 promise
    if (draftSavePromiseRef.current) {
      return await draftSavePromiseRef.current;
    }

    clearAutoSaveTimer();
    clearAutoSaveForceTimer();

    const payloadContent = String(contentValue ?? '');
    const promise = (async () => {
      if (silent) {
        setAutoSavingDraft(true);
        setAutoSaveUi({ status: 'saving', error: '' });
      } else {
        setSavingDraft(true);
      }

      try {
        const res = await publishDiaryAPI.saveDraft(d, { content: payloadContent });
        const updatedAt = res?.data?.updated_at ?? null;

        let stillDirty = false;

        // 只更新“当前编辑日期”的 UI/refs，避免切换日期后老请求覆盖新日期显示
        if (currentDateRef.current === d) {
          setDraftUpdatedAt(updatedAt);
          lastSavedContentRef.current = payloadContent;

          const latestText = String(currentContentRef.current ?? '');
          stillDirty = latestText !== payloadContent;
          dirtyRef.current = stillDirty;
          dirtySinceTsRef.current = stillDirty ? Date.now() : 0;
        }

        if (silent) {
          if (currentDateRef.current === d) {
            setAutoSaveUi(stillDirty ? { status: 'pending', error: '' } : { status: 'saved', error: '' });

            // 若保存时用户仍在继续编辑：继续按规则调度下一次保存，避免 UI 停在“已保存”但实际仍有未落盘内容
            if (stillDirty) {
              setTimeout(() => scheduleAutoSave('post_save'), 0);
            }
          }
        } else {
          message.success('草稿已保存');
          if (currentDateRef.current === d && stillDirty) {
            setAutoSaveUi({ status: 'pending', error: '' });
            setTimeout(() => scheduleAutoSave('post_save'), 0);
          }
        }

        return { ok: true, updatedAt, reason };
      } catch (error) {
        const msg = error?.response?.data?.detail || error?.message || String(error);
        const text = String(msg || '保存失败');

        if (silent) {
          if (currentDateRef.current === d) {
            setAutoSaveUi({ status: 'error', error: text });
          }
        } else {
          message.error('保存草稿失败: ' + text);
        }

        return { ok: false, error: text, reason };
      } finally {
        if (silent) setAutoSavingDraft(false);
        else setSavingDraft(false);
      }
    })();

    draftSavePromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      draftSavePromiseRef.current = null;
    }
  };

  const scheduleAutoSave = (reason = 'edit') => {
    const d = currentDateRef.current;
    if (!d) return;

    // 只要内容与上次保存一致，就无需自动保存
    const currentText = String(currentContentRef.current ?? '');
    if (currentText === lastSavedContentRef.current) {
      dirtyRef.current = false;
      dirtySinceTsRef.current = 0;
      setAutoSaveUi((prev) => (prev?.status === 'error' ? prev : { status: 'idle', error: '' }));
      clearAutoSaveTimer();
      clearAutoSaveForceTimer();
      return;
    }

    dirtyRef.current = true;
    if (!dirtySinceTsRef.current) dirtySinceTsRef.current = Date.now();
    setAutoSaveUi({ status: 'pending', error: '' });

    clearAutoSaveTimer();
    autoSaveTimerRef.current = setTimeout(() => {
      const dateToSave = String(currentDateRef.current || '').trim();
      if (!dateToSave) return;

      const textToSave = String(currentContentRef.current ?? '');
      if (textToSave === lastSavedContentRef.current) {
        dirtyRef.current = false;
        dirtySinceTsRef.current = 0;
        setAutoSaveUi((prev) => (prev?.status === 'error' ? prev : { status: 'idle', error: '' }));
        return;
      }

      // 防抖：停顿 5 秒后保存一次
      saveDraftInternal(dateToSave, textToSave, { silent: true, reason });
    }, AUTO_SAVE_DEBOUNCE_MS);

    // 保底：连续输入时，每 30 秒也保存一次（避免一直在输入导致“防抖”永远不触发）
    if (!autoSaveForceTimerRef.current && !draftSavePromiseRef.current) {
      const base = dirtySinceTsRef.current || Date.now();
      const delay = Math.max(0, base + AUTO_SAVE_FORCE_MS - Date.now());

      autoSaveForceTimerRef.current = setTimeout(() => {
        autoSaveForceTimerRef.current = null;

        const dateToSave = String(currentDateRef.current || '').trim();
        if (!dateToSave) return;

        const textToSave = String(currentContentRef.current ?? '');
        if (textToSave === lastSavedContentRef.current) {
          dirtyRef.current = false;
          dirtySinceTsRef.current = 0;
          setAutoSaveUi((prev) => (prev?.status === 'error' ? prev : { status: 'idle', error: '' }));
          return;
        }

        saveDraftInternal(dateToSave, textToSave, { silent: true, reason: `force_${reason}` });
      }, delay);
    }
  };

  const retryAutoSave = () => {
    const d = String(currentDateRef.current || '').trim();
    if (!d) return;

    const text = String(currentContentRef.current ?? '');
    if (text === lastSavedContentRef.current) return;

    saveDraftInternal(d, text, { silent: true, reason: 'retry' });
  };

  const requestDateChange = async (nextDate) => {
    const next = String(nextDate || '').trim();
    if (!next) return;
    if (next === date) return;

    // 先清理定时器，避免切换日期时“旧内容”被延迟写入
    clearAutoSaveTimer();
    clearAutoSaveForceTimer();

    // 若当前日期草稿有未保存更改：先自动保存，避免切换日期后被 loadDraft 覆盖导致丢内容
    const currentText = String(currentContentRef.current ?? '');
    const needsSave = Boolean(date) && currentText !== lastSavedContentRef.current;
    if (needsSave) {
      const res = await saveDraftInternal(date, currentText, { silent: true, reason: 'change_date' });
      if (!res?.ok) {
        message.error('自动保存失败，已阻止切换日期（请稍后重试或手动保存）');
        return;
      }
    }

    // 切换日期会触发 loadDraft 覆盖正文，因此清理“一键撤销”状态
    lastContentBeforeTimeConvertRef.current = '';
    setCanUndoTimeConvert(false);
    dirtySinceTsRef.current = 0;
    currentDateRef.current = next;
    setDate(next);
  };

  const loadDraft = useCallback(async (targetDate) => {
    if (!targetDate) return;
    clearAutoSaveTimer();
    clearAutoSaveForceTimer();
    setDraftLoading(true);
    try {
      const res = await publishDiaryAPI.getDraft(targetDate);
      const nextContent = String(res?.data?.content ?? '');
      setContent(nextContent);
      currentContentRef.current = nextContent;
      lastSavedContentRef.current = nextContent;
      dirtyRef.current = false;
      dirtySinceTsRef.current = 0;
      setAutoSaveUi({ status: 'idle', error: '' });
      setDraftUpdatedAt(res?.data?.updated_at ?? null);
    } catch (error) {
      message.error('加载草稿失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
      setContent('');
      currentContentRef.current = '';
      lastSavedContentRef.current = '';
      dirtyRef.current = false;
      dirtySinceTsRef.current = 0;
      setAutoSaveUi({ status: 'idle', error: '' });
      setDraftUpdatedAt(null);
    } finally {
      setDraftLoading(false);
    }
  }, [clearAutoSaveForceTimer, clearAutoSaveTimer]);

  const saveDraft = async () => {
    if (!date) {
      message.warning('请先选择日期');
      return;
    }
    const currentText = String(currentContentRef.current ?? content);
    const res = await saveDraftInternal(date, currentText, { silent: false, reason: 'manual' });
    if (res?.ok) setAutoSaveUi({ status: 'idle', error: '' });
  };

  const handleContentChange = (e) => {
    const next = String(e?.target?.value ?? '');
    setContent(next);
    currentContentRef.current = next;

    // 用户继续编辑后，时间转换的“一键撤销”就失去意义了（避免误操作导致丢字）
    if (canUndoTimeConvert) {
      setCanUndoTimeConvert(false);
      lastContentBeforeTimeConvertRef.current = '';
    }

    scheduleAutoSave('typing');
  };

  const handleTimeConvert = () => {
    const before = String(currentContentRef.current ?? content);
    const { text: after, count } = convertQuotedTimesToBracket(before);
    if (!count) {
      message.info('未发现可转换的时间标记（示例：> 12:34 或 > 12:34:56）');
      return;
    }

    lastContentBeforeTimeConvertRef.current = before;
    setCanUndoTimeConvert(true);
    setContent(after);
    currentContentRef.current = after;
    message.success(`已转换 ${count} 处时间标记`);
    scheduleAutoSave('time_convert');
  };

  const handleUndoTimeConvert = () => {
    const before = String(lastContentBeforeTimeConvertRef.current ?? '');
    if (!before) return;
    setContent(before);
    currentContentRef.current = before;
    lastContentBeforeTimeConvertRef.current = '';
    setCanUndoTimeConvert(false);
    message.success('已撤销时间转换');
    scheduleAutoSave('time_convert_undo');
  };

  const loadRuns = useCallback(async (targetDate) => {
    setRunsLoading(true);
    try {
      const res = await publishDiaryAPI.listRuns({ date: targetDate || undefined, limit: 50 });
      setRuns(res?.data || []);
    } catch (error) {
      message.error('加载发布历史失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadLatestRunsByDate = useCallback(async ({
    page = 1,
    pageSize = 50,
    includePreview = dailyLatestPreviewEnabled,
    previewLen = dailyLatestPreviewLen,
  } = {}) => {
    const p = Math.max(1, Number(page) || 1);
    const ps = Number(pageSize) || 50;
    const safePageSize = Math.min(200, Math.max(1, ps));
    const offset = (p - 1) * safePageSize;

    setLatestByDateLoading(true);
    try {
      const safePreviewLen = Math.min(5000, Math.max(0, Number(previewLen) || 0));
      const res = await publishDiaryAPI.listLatestRunsByDate({
        limit: safePageSize,
        offset,
        include_preview: Boolean(includePreview),
        preview_len: safePreviewLen,
      });
      const data = res?.data || {};
      const items = Array.isArray(data?.items) ? data.items : [];
      const countNum = Number(data?.count);

      setLatestByDate({
        count: Number.isFinite(countNum) ? countNum : 0,
        limit: Number(data?.limit || safePageSize) || safePageSize,
        offset: Number(data?.offset || offset) || offset,
        has_more: Boolean(data?.has_more),
        items,
      });
      setLatestByDatePage(p);
      setLatestByDatePageSize(safePageSize);
    } catch (error) {
      message.error('加载日终稿（按天汇总）失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
      setLatestByDate({
        count: 0,
        limit: safePageSize,
        offset,
        has_more: false,
        items: [],
      });
    } finally {
      setLatestByDateLoading(false);
    }
  }, [dailyLatestPreviewEnabled, dailyLatestPreviewLen]);

  useEffect(() => {
    writeDailyLatestPreviewSettings({ enabled: dailyLatestPreviewEnabled, preview_len: dailyLatestPreviewLen });
  }, [dailyLatestPreviewEnabled, dailyLatestPreviewLen]);

  const openRunDetail = async (runId) => {
    setRunModalOpen(true);
    setRunDetail(null);
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      setRunDetail(res?.data || null);
    } catch (error) {
      message.error('加载发布详情失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
      setRunDetail(null);
    } finally {
      setRunDetailLoading(false);
    }
  };

  const refreshRunDetail = async (runId) => {
    if (!runId) return;
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      setRunDetail(res?.data || null);
    } catch (error) {
      message.error('刷新发布详情失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunDetailLoading(false);
    }
  };

  const loadRunContentIntoEditor = async (runId) => {
    setRunDetailLoading(true);
    try {
      const res = await publishDiaryAPI.getRun(runId);
      const run = res?.data;
      if (!run?.date) {
        message.warning('发布记录缺少日期，无法载入');
        return;
      }
      currentDateRef.current = run.date;
      setDate(run.date);
      const nextContent = String(run?.content ?? '');
      setContent(nextContent);
      currentContentRef.current = nextContent;
      setDraftUpdatedAt(null);
      setActiveTab('edit');
      message.success('已载入发布内容，可继续修改后再发布');
    } catch (error) {
      message.error('载入失败: ' + (error?.response?.data?.detail || error?.message || String(error)));
    } finally {
      setRunDetailLoading(false);
    }
  };

  const publish = async () => {
    if (!date) {
      message.warning('请先选择日期');
      return;
    }
    if (!content || !content.trim()) {
      message.warning('记录内容不能为空');
      return;
    }
    if (!selectedAccountIds || selectedAccountIds.length === 0) {
      message.warning('请至少勾选一个账号');
      return;
    }

    if (publishing) {
      message.warning('正在发布中，请稍候…');
      return;
    }

    const publishDate = date;
    const publishContent = content;
    const publishAccountIds = [...selectedAccountIds];

    // 清理上一轮轮询计时器（避免并发轮询）
    if (publishPollTimerRef.current) {
      clearTimeout(publishPollTimerRef.current);
      publishPollTimerRef.current = null;
    }

    setPublishing(true);
    const msgKey = `publish-${Date.now()}`;
    publishMsgKeyRef.current = msgKey;
    message.open({
      key: msgKey,
      type: 'loading',
      content: '已开始后台发布…你可以刷新/关闭页面，后端仍会继续发布',
      duration: 0,
    });

    try {
      // 1) 创建 run（落库 + 创建 items），不做实际发布
      const runRes = await publishDiaryAPI.createRun({
        date: publishDate,
        content: publishContent,
        account_ids: publishAccountIds,
        save_draft: true,
      });
      const run = runRes?.data;
      if (!run?.id) {
        throw new Error('后端未返回 run_id，无法继续发布');
      }

      const targetAccountIds =
        Array.isArray(run?.target_account_ids) && run.target_account_ids.length > 0
          ? run.target_account_ids
          : publishAccountIds;

      setActivePublishRun(run || null);
      setPublishPanelOpen(true);
      setDraftUpdatedAt(null);
      writeLocalLastSelection(targetAccountIds);
      loadRuns(publishDate);

      // 兜底：若后端未返回 items，则用本地 accounts 生成一份“待发布”占位列表
      setActivePublishRun((prev) => {
        const base = prev || run;
        if (!base || base?.id !== run.id) return prev;
        const existingItems = Array.isArray(base?.items) ? base.items : [];
        if (existingItems.length > 0) return base;

        const byId = new Map((accounts || []).map((acc) => [acc.id, acc]));
        const placeholders = targetAccountIds.map((accountId) => {
          const acc = byId.get(accountId);
          return {
            account_id: accountId,
            nideriji_userid: acc?.nideriji_userid ?? 0,
            status: 'unknown',
            nideriji_diary_id: null,
            error_message: null,
          };
        });
        return { ...base, items: placeholders };
      });

      // 2) 启动后端后台任务：前端不再逐账号请求 publish-one
      const concurrency = Math.min(DEFAULT_PUBLISH_CONCURRENCY, targetAccountIds.length || 1);
      const startRes = await publishDiaryAPI.startRun(run.id, { concurrency });
      const alreadyRunning = Boolean(startRes?.data?.already_running);

      message.open({
        key: msgKey,
        type: 'loading',
        content: alreadyRunning
          ? `后台发布已在运行（Run #${run.id}）…（页面内会显示进度）`
          : `后台发布已启动（Run #${run.id}）…（页面内会显示进度）`,
        duration: 0,
      });
    } catch (error) {
      const detail = error?.response?.data?.detail;
      message.open({
        key: msgKey,
        type: 'error',
        content: '发布失败: ' + (detail || error?.message || String(error)),
        duration: 6,
      });
      publishMsgKeyRef.current = null;
      setPublishing(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // 刷新/重进页面后：自动恢复仍在进行中的后台发布（避免用户必须手动翻历史）。
  useEffect(() => {
    let cancelled = false;

    const tryResume = async () => {
      try {
        // 仅做 best-effort：不阻塞页面渲染
        const res = await publishDiaryAPI.listRuns({ limit: 10 });
        const list = Array.isArray(res?.data) ? res.data : [];
        const nowMs = Date.now();

        const candidate = list.find((r) => {
          const total = r?.target_account_ids?.length ?? 0;
          const done = (r?.success_count ?? 0) + (r?.failed_count ?? 0);
          if (!total || done >= total) return false;

          const createdAt = r?.created_at;
          if (createdAt) {
            const createdMs = new Date(createdAt).getTime();
            // 只恢复“近期”的未完成 run，避免误把很久以前的残留记录当成进行中
            if (Number.isFinite(createdMs) && nowMs - createdMs > 6 * 60 * 60 * 1000) return false;
          }

          return true;
        });

        if (!candidate?.id) return;

        const runRes = await publishDiaryAPI.getRun(candidate.id);
        const run = runRes?.data;
        if (cancelled) return;
        if (!run?.id) return;

        setActivePublishRun(run);
        setPublishPanelOpen(true);

        const items = Array.isArray(run.items) ? run.items : [];
        const targetTotal = Array.isArray(run.target_account_ids) ? run.target_account_ids.length : items.length;
        const success = items.filter((i) => i?.status === 'success').length;
        const failed = items.filter((i) => i?.status === 'failed').length;
        const running = items.filter((i) => i?.status === 'running').length;
        const done = success + failed;

        const createdAt = run?.created_at || candidate?.created_at;
        const createdMs = createdAt ? new Date(createdAt).getTime() : Number.NaN;
        const ageMs = Number.isFinite(createdMs) ? nowMs - createdMs : 0;
        const shouldPoll = (targetTotal > 0 && done < targetTotal) && (running > 0 || ageMs < 60 * 1000);

        const key = `publish-resume-${run.id}`;
        publishMsgKeyRef.current = key;
        if (shouldPoll) {
          setPublishing(true);
          message.open({
            key,
            type: 'loading',
            content: `检测到后台发布仍在进行（Run #${run.id}），已自动恢复进度显示…`,
            duration: 0,
          });
        } else {
          setPublishing(false);
          message.open({
            key,
            type: 'warning',
            content: `发现未完成的发布（Run #${run.id}），但未检测到正在发布；可能后端已重启/任务中断（可在“发布历史”查看或重新发布）`,
            duration: 6,
          });
          publishMsgKeyRef.current = null;
        }
      } catch {
        // 自动恢复失败不影响正常使用
      }
    };

    tryResume();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!date) return;
    loadDraft(date);
    loadRuns(date);
  }, [date, loadDraft, loadRuns]);

  const handleHistoryViewChange = useCallback((value) => {
    const v = String(value || '');
    if (v !== 'date' && v !== 'daily_latest' && v !== 'daily_timeline') return;

    setHistoryView(v);
    if (v === 'daily_latest' || v === 'daily_timeline') {
      // 切到“按天汇总”时，默认从第一页开始加载
      loadLatestRunsByDate({ page: 1, pageSize: latestByDatePageSize });
    }
  }, [loadLatestRunsByDate, latestByDatePageSize]);

  // 切到“发布历史（按日期）”时：使用 historyDate 拉取，避免覆盖编辑器内容
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (historyView !== 'date') return;
    if (!historyDate) return;
    loadRuns(historyDate);
  }, [activeTab, historyView, historyDate, loadRuns]);

  // 从历史页切回编辑页时：刷新一次“当天发布历史（快速查看）”，避免 run 列表停留在别的日期
  useEffect(() => {
    if (activeTab !== 'edit') return;
    if (!date) return;
    loadRuns(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 当用户切到“发布历史”页且选择“按天汇总”时，自动加载一次（避免空白页）
  useEffect(() => {
    if (activeTab !== 'history') return;
    if (historyView !== 'daily_latest' && historyView !== 'daily_timeline') return;
    loadLatestRunsByDate({ page: latestByDatePage, pageSize: latestByDatePageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, historyView]);

  // 时间线模式：进入页面后默认展开最近一天，方便“连续阅读”。
  useEffect(() => {
    if (historyView !== 'daily_timeline') {
      timelineAutoInitRef.current = '';
      return;
    }
    if (activeTab !== 'history') return;
    if (latestByDateLoading) return;

    const items = Array.isArray(latestByDate?.items) ? latestByDate.items : [];
    if (items.length === 0) return;

    const marker = `${Number(latestByDate?.offset) || 0}:${Number(latestByDate?.limit) || latestByDatePageSize}`;
	    if (timelineAutoInitRef.current === marker) return;
	    timelineAutoInitRef.current = marker;

	    // 说明：分页切换时可能残留“上一页”的展开 key；这里仅保留本页存在的 key，
	    // 若本页没有任何展开项，则默认展开最新一天。
	    const itemIdSet = new Set(items.map(i => String(i?.id)).filter(Boolean));
	    const validOpenKeys = (timelineOpenKeys || []).map(String).filter(k => itemIdSet.has(k));
	    if (timelineOpenKeys.length > 0 && validOpenKeys.length !== timelineOpenKeys.length) {
	      setTimelineOpenKeys(validOpenKeys);
	    }
	    if (validOpenKeys.length > 0) return;
	    const firstId = items[0]?.id;
	    if (!firstId) return;
	    const key = String(firstId);
    setTimelineOpenKeys([key]);
    ensureTimelineRunDetailLoaded(key);
  }, [
    activeTab,
    historyView,
    latestByDateLoading,
	    latestByDate?.offset,
	    latestByDate?.limit,
	    latestByDate?.items,
	    latestByDatePageSize,
	    timelineOpenKeys,
	    ensureTimelineRunDetailLoaded,
	  ]);

  useEffect(() => {
    if (!publishing) return;
    if (!activePublishRun?.id) return;

    let cancelled = false;
    const runId = activePublishRun.id;
    let failStreak = 0;

    const poll = async () => {
      if (cancelled) return;

      try {
        const res = await publishDiaryAPI.getRun(runId);
        const run = res?.data;
        if (cancelled) return;

        if (run?.id) {
          setActivePublishRun(run);

          const items = Array.isArray(run.items) ? run.items : [];
          const targetTotal = Array.isArray(run.target_account_ids) ? run.target_account_ids.length : items.length;
          const success = items.filter((i) => i?.status === 'success').length;
          const failed = items.filter((i) => i?.status === 'failed').length;
          const done = success + failed;

          if (targetTotal > 0 && done >= targetTotal) {
            setPublishing(false);
            loadRuns(run?.date);

            const key = publishMsgKeyRef.current;
            if (key) {
              if (failed > 0) {
                message.open({
                  key,
                  type: 'warning',
                  content: `后台发布完成：成功 ${success}，失败 ${failed}（可在“发布历史”查看明细）`,
                  duration: 6,
                });
              } else {
                message.open({
                  key,
                  type: 'success',
                  content: `后台发布完成：成功 ${success}（可在“发布历史”查看明细）`,
                  duration: 4,
                });
              }
              publishMsgKeyRef.current = null;
            } else if (failed > 0) {
              message.warning(`后台发布完成：成功 ${success}，失败 ${failed}`);
            } else {
              message.success(`后台发布完成：成功 ${success}`);
            }
            return;
          }
        }

        failStreak = 0;
      } catch {
        failStreak += 1;
      }

      const delayMs = failStreak >= 3 ? 5000 : 2000;
      publishPollTimerRef.current = setTimeout(poll, delayMs);
    };

    poll();

    return () => {
      cancelled = true;
      if (publishPollTimerRef.current) {
        clearTimeout(publishPollTimerRef.current);
        publishPollTimerRef.current = null;
      }
    };
  }, [publishing, activePublishRun?.id, loadRuns]);

  const runItemColumns = [
    { title: '账号ID', dataIndex: 'account_id', key: 'account_id', width: 90 },
    { title: '用户ID', dataIndex: 'nideriji_userid', key: 'nideriji_userid', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (val) => {
        if (val === 'success') return <Tag color="green">成功</Tag>;
        if (val === 'failed') return <Tag color="red">失败</Tag>;
        if (val === 'running') return <Tag color="blue">发布中</Tag>;
        if (val === 'unknown') return <Tag>待发布</Tag>;
        return <Tag>未知</Tag>;
      },
    },
    { title: '记录ID', dataIndex: 'nideriji_diary_id', key: 'nideriji_diary_id', width: 120, render: (v) => v || '-' },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', render: (v) => v || '-' },
  ];

  const runColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 90 },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    {
      title: '账号数',
      key: 'accounts',
      width: 90,
      render: (_, r) => (r?.target_account_ids?.length ?? 0),
    },
    { title: '成功', dataIndex: 'success_count', key: 'success_count', width: 80 },
    { title: '失败', dataIndex: 'failed_count', key: 'failed_count', width: 80 },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v) => {
        return formatBeijingDateTime(v);
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => openRunDetail(r.id)}>查看</Button>
          <Button size="small" onClick={() => loadRunContentIntoEditor(r.id)}>载入内容</Button>
        </Space>
      ),
    },
  ];

  const runStatusTag = (status) => {
    if (status === 'success') return <Tag color="green">成功</Tag>;
    if (status === 'failed') return <Tag color="red">失败</Tag>;
    if (status === 'running') return <Tag color="blue">发布中</Tag>;
    if (status === 'unknown') return <Tag>待发布</Tag>;
    return <Tag>未知</Tag>;
  };

  const runListNode = (
    <List
      dataSource={runs}
      loading={runsLoading}
      locale={{ emptyText: '暂无发布记录' }}
      renderItem={(r) => (
        <Card
          hoverable
          style={{ marginBottom: 12 }}
          bodyStyle={{ padding: 14 }}
          onClick={() => openRunDetail(r.id)}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag color="blue">Run #{r?.id ?? '-'}</Tag>
              <Tag color="purple">{r?.date || '-'}</Tag>
              <Tag color="geekblue">{r?.target_account_ids?.length ?? 0} 个账号</Tag>
              <Tag color="green">成功 {r?.success_count ?? 0}</Tag>
              <Tag color="red">失败 {r?.failed_count ?? 0}</Tag>
            </Space>
            <Text type="secondary">时间：{formatBeijingDateTime(r?.created_at)}</Text>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openRunDetail(r.id);
                }}
                block
              >
                查看
              </Button>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  loadRunContentIntoEditor(r.id);
                }}
                block
              >
                载入内容
              </Button>
            </Space>
          </Space>
        </Card>
      )}
    />
  );

  const runTableNode = (
    <Table
      rowKey="id"
      size="small"
      loading={runsLoading}
      columns={runColumns}
      dataSource={runs}
      pagination={false}
    />
  );

  const runDetailListNode = (
    <List
      dataSource={runDetail?.items || []}
      locale={{ emptyText: '暂无发布明细' }}
      renderItem={(r) => (
        <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 14 }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag color="blue">账号ID {r?.account_id ?? '-'}</Tag>
              <Tag color="purple">用户ID {r?.nideriji_userid ?? '-'}</Tag>
              {runStatusTag(r?.status)}
              <Tag color="geekblue">记录ID {r?.nideriji_diary_id || '-'}</Tag>
            </Space>
            {r?.error_message ? (
              <Text
                type="danger"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                {r.error_message}
              </Text>
            ) : (
              <Text type="secondary">无错误信息</Text>
            )}
          </Space>
        </Card>
      )}
    />
  );

  const runDetailTableNode = (
    <Table
      rowKey={(r) => `${r.account_id}-${r.nideriji_userid}`}
      size="small"
      columns={runItemColumns}
      dataSource={runDetail?.items || []}
      pagination={false}
    />
  );

  return (
    <Page maxWidth={1200}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>     
        <div>
          <Title level={3} style={{ margin: 0 }}>一键发布记录</Title>      
          <Text type="secondary">草稿/发布历史独立存储，不会和“采集记录列表”混在一起。</Text>
        </div>

        {(accounts || []).length === 0 && !accountsLoading && (
          <Alert
            type="warning"
            showIcon
            message="还没有可用账号"
            description="请先到「账号管理」添加至少一个账号，才能发布记录。"
          />
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'edit',
              label: '编辑/发布',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" title="选择日期">
                    {isMobile ? (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) => requestDateChange(e.target.value)}
                          disabled={draftLoading || savingDraft || autoSavingDraft || publishing}
                          style={{ width: '100%' }}
                        />
                        <Space wrap>
                          <Button onClick={() => requestDateChange(todayStr())} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>今天</Button>
                          <Button onClick={() => requestDateChange(yesterdayStr())} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>昨天</Button>
                          <Button onClick={() => requestDateChange(shiftDateStr(date, -1))} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>上一天</Button>
                          <Button onClick={() => requestDateChange(shiftDateStr(date, 1))} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>下一天</Button>
                        </Space>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={() => loadDraft(date)}
                          loading={draftLoading}
                          disabled={savingDraft || autoSavingDraft || publishing}
                          block
                        >
                          重新加载草稿
                        </Button>
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                          <Text type="secondary">
                            {draftStatusText}
                          </Text>
                          {autoSaveUi?.status === 'error' && hasUnsavedChanges && (
                            <Button
                              size="small"
                              onClick={retryAutoSave}
                              disabled={draftLoading || savingDraft || autoSavingDraft || publishing}
                              block
                            >
                              重试自动保存
                            </Button>
                          )}
                        </Space>
                      </Space>
                    ) : (
                      <Space wrap>
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) => requestDateChange(e.target.value)}
                          disabled={draftLoading || savingDraft || autoSavingDraft || publishing}
                          style={{ width: 170 }}
                        />
                        <Button onClick={() => requestDateChange(todayStr())} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>今天</Button>
                        <Button onClick={() => requestDateChange(yesterdayStr())} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>昨天</Button>
                        <Button onClick={() => requestDateChange(shiftDateStr(date, -1))} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>上一天</Button>
                        <Button onClick={() => requestDateChange(shiftDateStr(date, 1))} disabled={draftLoading || savingDraft || autoSavingDraft || publishing}>下一天</Button>
                        <Button icon={<ReloadOutlined />} onClick={() => loadDraft(date)} loading={draftLoading} disabled={savingDraft || autoSavingDraft || publishing}>重新加载草稿</Button>
                        <Text type="secondary">
                          {draftStatusText}
                        </Text>
                        {autoSaveUi?.status === 'error' && hasUnsavedChanges && (
                          <Button
                            size="small"
                            onClick={retryAutoSave}
                            disabled={draftLoading || savingDraft || autoSavingDraft || publishing}
                          >
                            重试自动保存
                          </Button>
                        )}
                      </Space>
                    )}
                  </Card>

                  <Card size="small" title="记录内容（发布/更新）">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <TextArea
                        value={content}
                        onChange={handleContentChange}
                        placeholder={'例如：\n[15:53]\n今天发生了什么…'}
                        autoSize={{ minRows: 10, maxRows: 24 }}
                      />
                      <Space
                        wrap
                        direction={isMobile ? 'vertical' : 'horizontal'}
                        style={{ width: isMobile ? '100%' : undefined }}
                      >
                        <Button
                          icon={<SaveOutlined />}
                          onClick={saveDraft}
                          loading={savingDraft}
                          disabled={draftLoading || publishing || savingDraft || autoSavingDraft}
                          block={isMobile}
                        >
                          保存草稿
                        </Button>
                        <Tooltip title="把正文中的 “> 12:34 / > 12:34:56” 一键转换为 “[12:34] / [12:34:56]”">
                          <Button
                            icon={<ClockCircleOutlined />}
                            onClick={handleTimeConvert}
                            disabled={draftLoading || publishing || savingDraft || autoSavingDraft}
                            block={isMobile}
                          >
                            时间转换
                          </Button>
                        </Tooltip>
                        <Tooltip title="撤销上一条“时间转换”（如果你之后又手动编辑了内容，建议直接 Ctrl+Z）">
                          <Button
                            icon={<UndoOutlined />}
                            onClick={handleUndoTimeConvert}
                            disabled={!canUndoTimeConvert || draftLoading || publishing || savingDraft || autoSavingDraft}
                            block={isMobile}
                          >
                            撤销转换
                          </Button>
                        </Tooltip>
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={publish}
                          loading={publishing}
                          disabled={draftLoading || savingDraft || publishing}
                          block={isMobile}
                        >
                          发布到所选账号
                        </Button>
                        <Button onClick={() => loadRuns(date)} loading={runsLoading} block={isMobile}>刷新历史</Button>
                      </Space>
                      <Text type="secondary">
                        小技巧：输入 <Text code>{'> 12:34'}</Text> 或 <Text code>{'> 12:34:56'}</Text> 后点“时间转换”可变成 <Text code>{'[12:34]'}</Text> / <Text code>{'[12:34:56]'}</Text>；停止输入约 5 秒会自动保存草稿，连续输入每 30 秒也会保底保存一次。
                      </Text>
                    </Space>
                  </Card>

                  {publishPanelOpen && activePublishRun?.id && (
                    <Card
                      size="small"
                      title={publishing ? `后台发布进度（Run #${activePublishRun.id}）` : `最近一次发布（Run #${activePublishRun.id}）`}
                      extra={(
                        <Space wrap>
                          <Button size="small" onClick={() => openRunDetail(activePublishRun.id)}>
                            查看明细
                          </Button>
                          <Button size="small" onClick={() => setPublishPanelOpen(false)}>
                            关闭提示
                          </Button>
                        </Space>
                      )}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap size={8}>
                          <Tag color="blue">已完成 {publishProgress.done}/{publishProgress.total}</Tag>
                          <Tag color="green">成功 {publishProgress.success}</Tag>
                          <Tag color="red">失败 {publishProgress.failed}</Tag>
                          <Tag color="geekblue">进行中 {publishProgress.running}</Tag>
                          <Tag>待发布 {publishProgress.unknown}</Tag>
                        </Space>
                        <Text type="secondary">
                          {publishing ? '发布正在后台进行，你可以继续操作或切换页面。' : '发布已结束，可在“发布历史”查看记录。'}
                        </Text>
                      </Space>
                    </Card>
                  )}

                  <Card
                    size="small"
                    title="选择发布账号"
                    extra={(
                      <Button icon={<ReloadOutlined />} onClick={loadAccounts} loading={accountsLoading}>
                        刷新账号
                      </Button>
                    )}
                  >
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Checkbox
                        indeterminate={indeterminate}
                        checked={checkAll}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const next = checked ? allAccountIds : [];
                          setSelectedAccountIds(next);
                          writeLocalLastSelection(next);
                        }}
                        disabled={accountsLoading || allAccountIds.length === 0}
                      >
                        全选（{selectedAccountIds.length}/{allAccountIds.length}）
                      </Checkbox>

                      <Checkbox.Group
                        style={{ width: '100%' }}
                        value={selectedAccountIds}
                        onChange={(vals) => {
                          setSelectedAccountIds(vals);
                          writeLocalLastSelection(vals);
                        }}
                        options={accountOptions}
                        disabled={accountsLoading}
                      />

                      {(accounts || []).some(a => selectedSet.has(a.id) && a?.token_status?.checked_at && !a?.token_status?.is_valid) && (
                        <Alert
                          type="warning"
                          showIcon
                          message="部分账号 Token 可能已失效"
                          description="发布时会尝试发布；若账号保存了密码，后端会自动重新登录刷新 token。否则请到「账号管理」更新 token。"
                        />
                      )}
                    </Space>
                  </Card>

                  <Card size="small" title="当天发布历史（快速查看）">
                    {isMobile ? runListNode : runTableNode}
                  </Card>
                </Space>
              ),
            },
            {
              key: 'history',
              label: '发布历史',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card size="small" title="查看方式">
                    <Space
                      wrap
                      direction={isMobile ? 'vertical' : 'horizontal'}
                      style={{ width: isMobile ? '100%' : undefined }}
                    >
                      <Segmented
                        value={historyView}
                        options={[
                          { label: '按日期（当日全部发布）', value: 'date' },
                          { label: '按天汇总（日终稿）', value: 'daily_latest' },
                          { label: '按天连续阅读（日终稿）', value: 'daily_timeline' },
                        ]}
                        onChange={handleHistoryViewChange}
                      />
                      <Text type="secondary">
                        提示：点击“查看”可直接阅读发布内容；点击“载入内容”可带回编辑器继续更新。
                      </Text>
                    </Space>
                  </Card>

                  {historyView === 'date' ? (
                    <Card size="small" title="按日期筛选">
                      <Space
                        wrap
                        direction={isMobile ? 'vertical' : 'horizontal'}
                        style={{ width: isMobile ? '100%' : undefined }}
                      >
                        <Input
                          type="date"
                          value={historyDate}
                          onChange={(e) => setHistoryDate(e.target.value)}
                          style={{ width: isMobile ? '100%' : 170 }}
                        />
                        <Button
                          onClick={() => loadRuns(historyDate)}
                          icon={<ReloadOutlined />}
                          loading={runsLoading}
                          block={isMobile}
                        >
                          刷新
                        </Button>
                        <Text type="secondary">查看的是该日“所有发布记录”（同一天可能多次更新）。</Text>
                      </Space>
                    </Card>
	                  ) : (
	                    <Card
	                      size="small"
	                      title={historyView === 'daily_timeline' ? '按天连续阅读（日终稿）' : '按天汇总（日终稿）'}
	                      extra={(
	                        <Button
	                          icon={<ReloadOutlined />}
	                          onClick={() => loadLatestRunsByDate({ page: latestByDatePage, pageSize: latestByDatePageSize })}
	                          loading={latestByDateLoading}
                        >
                          刷新
                        </Button>
                      )}
	                    >
	                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
	                        <Text type="secondary">
	                          {historyView === 'daily_timeline'
	                            ? '每个日期只展示“最后一次发布”（以该日最大 Run ID 作为日终稿）。展开即可连续阅读（正文按需加载）。'
	                            : '每个日期只展示“最后一次发布”（以该日最大 Run ID 作为日终稿）。点击可查看内容。'}
	                        </Text>
                        <Space wrap>
                          <Tag color="geekblue">共 {latestByDate?.count ?? 0} 天</Tag>
                          <Tag>当前 {latestByDatePage} / {Math.max(1, Math.ceil((latestByDate?.count ?? 0) / (latestByDatePageSize || 1)))}</Tag>
                        </Space>
                        <Space
                          wrap
                          align="center"
                          direction={isMobile ? 'vertical' : 'horizontal'}
                          style={{ width: isMobile ? '100%' : undefined }}
                        >
                          <Checkbox
                            checked={dailyLatestPreviewEnabled}
                            onChange={(e) => {
                              const next = Boolean(e?.target?.checked);
                              setDailyLatestPreviewEnabled(next);
                              // 开关预览会影响接口返回字段，主动刷新一次更直观
                              loadLatestRunsByDate({
                                page: latestByDatePage,
                                pageSize: latestByDatePageSize,
                                includePreview: next,
                                previewLen: dailyLatestPreviewLen,
                              });
                            }}
                          >
                            显示内容预览
                          </Checkbox>

                          <Space align="center" wrap>
                            <Text type="secondary">预览长度</Text>
                            <InputNumber
                              min={0}
                              max={5000}
                              step={50}
                              value={dailyLatestPreviewLen}
                              onChange={(v) => {
                                const n = Number(v);
                                const next = Number.isFinite(n) ? n : 0;
                                setDailyLatestPreviewLen(next);
                                if (dailyLatestPreviewEnabled) {
                                  loadLatestRunsByDate({
                                    page: latestByDatePage,
                                    pageSize: latestByDatePageSize,
                                    includePreview: dailyLatestPreviewEnabled,
                                    previewLen: next,
                                  });
                                }
                              }}
                              disabled={!dailyLatestPreviewEnabled}
                              style={{ width: isMobile ? '100%' : 140 }}
	                            />
	                            <Text type="secondary">字</Text>
	                          </Space>
	                        </Space>

	                        {historyView === 'daily_timeline' && (
	                          <Space wrap>
	                            <Button
	                              size="small"
	                              onClick={() => expandTimelineRecent(7)}
	                              disabled={latestByDateLoading || (latestByDate?.items || []).length === 0}
	                            >
	                              展开最近 7 天
	                            </Button>
	                            <Button
	                              size="small"
	                              onClick={() => setTimelineOpenKeys([])}
	                              disabled={timelineOpenKeys.length === 0}
	                            >
	                              折叠全部
	                            </Button>
	                          </Space>
	                        )}
	                      </Space>
	                    </Card>
	                  )}

	                  <Card size="small" title={historyView === 'date' ? '发布记录（当日）' : '日终稿（所有日子）'}>
	                    {historyView === 'date' ? (
	                      isMobile ? runListNode : runTableNode
	                    ) : historyView === 'daily_latest' ? (
	                      isMobile ? (
	                        <List
	                          dataSource={latestByDate?.items || []}
	                          loading={latestByDateLoading}
	                          locale={{ emptyText: '暂无发布记录' }}
	                          renderItem={(r) => (
                            <Card
                              hoverable
                              style={{ marginBottom: 12 }}
                              bodyStyle={{ padding: 14 }}
                              onClick={() => openRunDetail(r.id)}
                            >
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                <Space wrap size={8}>
                                  <Tag color="purple">{r?.date || '-'}</Tag>
                                  <Tag color="blue">Run #{r?.id ?? '-'}</Tag>
                                  <Tag color="geekblue">{r?.target_account_ids?.length ?? 0} 个账号</Tag>
                                  <Tag color="green">成功 {r?.success_count ?? 0}</Tag>
                                  <Tag color="red">失败 {r?.failed_count ?? 0}</Tag>
                                </Space>
                                <Text type="secondary">时间：{formatBeijingDateTime(r?.created_at)}</Text>
                                {dailyLatestPreviewEnabled && (
                                  <div style={{ padding: 10, border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
                                    <Text type="secondary">内容预览</Text>
                                    <Paragraph
                                      style={{
                                        marginBottom: 0,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        overflowWrap: 'anywhere',
                                      }}
                                      ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                                    >
                                      {typeof r?.content_preview === 'string' && r.content_preview
                                        ? r.content_preview
                                        : '（空）'}
                                    </Paragraph>
                                    {(Number(r?.content_word_count_no_ws) > 0 || Number(r?.content_len) > 0) && (
                                      <Text type="secondary">
                                        字数（去空白）：{Number(r?.content_word_count_no_ws) || 0}；字符：{Number(r?.content_len) || 0}
                                      </Text>
                                    )}
                                  </div>
                                )}
                                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                  <Button
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openRunDetail(r.id);
                                    }}
                                    block
                                  >
                                    查看
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      loadRunContentIntoEditor(r.id);
                                    }}
                                    block
                                  >
                                    载入内容
                                  </Button>
                                  <Button
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setHistoryView('date');
                                      setHistoryDate(r?.date || '');
                                      loadRuns(r?.date);
                                    }}
                                    block
                                  >
                                    查看当天全部发布
                                  </Button>
                                </Space>
                              </Space>
                            </Card>
	                          )}
	                        />
	                      ) : (
	                        <>
	                          <Table
                            rowKey="id"
                            size="small"
                            loading={latestByDateLoading}
                            columns={[
                              { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
                              { title: 'Run ID', dataIndex: 'id', key: 'id', width: 90 },
                              {
                                title: '内容预览',
                                key: 'content_preview',
                                render: (_, r) => {
                                  if (!dailyLatestPreviewEnabled) {
                                    return <Text type="secondary">（已关闭）</Text>;
                                  }
                                  const preview = typeof r?.content_preview === 'string' ? r.content_preview : '';
                                  const wc = Number(r?.content_word_count_no_ws) || 0;
                                  const len = Number(r?.content_len) || 0;
                                  const meta = (wc > 0 || len > 0)
                                    ? `字数（去空白）：${wc}；字符：${len}`
                                    : '';

                                  return (
                                    <Tooltip
                                      placement="topLeft"
                                      title={(
                                        <div style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>
                                          {preview ? preview : '（空）'}
                                          {meta ? `\n\n${meta}` : ''}
                                        </div>
                                      )}
                                    >
                                      <Text
                                        type="secondary"
                                        style={{
                                          display: 'inline-block',
                                          maxWidth: 520,
                                          whiteSpace: 'nowrap',
                                          cursor: 'help',
                                        }}
                                        ellipsis
                                      >
                                        {preview ? preview : '（空）'}
                                      </Text>
                                    </Tooltip>
                                  );
                                },
                              },
                              {
                                title: '账号数',
                                key: 'accounts',
                                width: 90,
                                render: (_, r) => (r?.target_account_ids?.length ?? 0),
                              },
                              { title: '成功', dataIndex: 'success_count', key: 'success_count', width: 80 },
                              { title: '失败', dataIndex: 'failed_count', key: 'failed_count', width: 80 },
                              {
                                title: '时间',
                                dataIndex: 'created_at',
                                key: 'created_at',
                                width: 180,
                                render: (v) => formatBeijingDateTime(v),
                              },
                              {
                                title: '操作',
                                key: 'actions',
                                width: 320,
                                render: (_, r) => (
                                  <Space>
                                    <Button size="small" onClick={() => openRunDetail(r.id)}>查看</Button>
                                    <Button size="small" onClick={() => loadRunContentIntoEditor(r.id)}>载入内容</Button>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setHistoryView('date');
                                        setHistoryDate(r?.date || '');
                                        loadRuns(r?.date);
                                      }}
                                    >
                                      查看当天全部发布
                                    </Button>
                                  </Space>
                                ),
                              },
                            ]}
                            dataSource={latestByDate?.items || []}
                            pagination={false}
                          />
                          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                            <Pagination
                              current={latestByDatePage}
                              pageSize={latestByDatePageSize}
                              total={Number(latestByDate?.count) || 0}
                              showSizeChanger
                              pageSizeOptions={['20', '50', '100', '200']}
                              onChange={(p, ps) => loadLatestRunsByDate({ page: p, pageSize: ps })}
                              showTotal={(t) => `共 ${t} 天`}
                            />
	                          </div>
	                        </>
	                      )
	                    ) : (
	                      <>
	                        {latestByDateLoading && <Skeleton active paragraph={{ rows: 6 }} />}
	                        {!latestByDateLoading && (latestByDate?.items || []).length === 0 && (
	                          <Text type="secondary">暂无发布记录</Text>
	                        )}
	                        {!latestByDateLoading && (latestByDate?.items || []).length > 0 && (
	                          <Collapse
	                            activeKey={timelineOpenKeys}
	                            onChange={(keys) => {
	                              const next = Array.isArray(keys) ? keys : (keys ? [keys] : []);
	                              setTimelineOpenKeys(next);
	                              next.forEach(k => ensureTimelineRunDetailLoaded(k));
	                            }}
	                            items={(latestByDate?.items || []).filter(r => r?.id).map((r) => {
	                              const runId = String(r?.id || '');
	                              const loading = Boolean(timelineLoadingById?.[runId]);
	                              const err = timelineErrorById?.[runId];
	                              const detail = timelineRunDetailsById?.[runId];
	                              const fullText = typeof detail?.content === 'string' ? detail.content : '';
	                              const metaWordCount = fullText ? String(fullText).replace(/\s+/gu, '').length : 0;
	                              const metaLen = fullText ? String(fullText).length : 0;

	                              const previewText = typeof r?.content_preview === 'string' ? r.content_preview : '';
	                              const showPreviewLine = dailyLatestPreviewEnabled && previewText;

	                              return {
	                                key: runId,
	                                label: (
	                                  <div style={{ width: '100%' }}>
	                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
	                                      <Tag color="purple">{r?.date || '-'}</Tag>
	                                      <Tag color="blue">Run #{r?.id ?? '-'}</Tag>
	                                      <Tag color="geekblue">{r?.target_account_ids?.length ?? 0} 个账号</Tag>
	                                      <Tag color="green">成功 {r?.success_count ?? 0}</Tag>
	                                      <Tag color="red">失败 {r?.failed_count ?? 0}</Tag>
	                                      <Text type="secondary">时间：{formatBeijingDateTime(r?.created_at)}</Text>
	                                    </div>
	                                    {showPreviewLine && (
	                                      <Text
	                                        type="secondary"
	                                        style={{ display: 'block', marginTop: 4 }}
	                                        ellipsis
	                                      >
	                                        {previewText}
	                                      </Text>
	                                    )}
	                                  </div>
	                                ),
	                                children: (
	                                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
	                                    <Space wrap>
	                                      <Button size="small" onClick={() => openRunDetail(r.id)}>查看（含每账号结果）</Button>
	                                      <Button size="small" onClick={() => loadRunContentIntoEditor(r.id)}>载入内容</Button>
	                                      <Button
	                                        size="small"
	                                        onClick={() => {
	                                          setHistoryView('date');
	                                          setHistoryDate(r?.date || '');
	                                          loadRuns(r?.date);
	                                        }}
	                                      >
	                                        查看当天全部发布
	                                      </Button>
	                                      {!detail?.id && !loading && (
	                                        <Button size="small" onClick={() => ensureTimelineRunDetailLoaded(runId)}>
	                                          加载正文
	                                        </Button>
	                                      )}
	                                    </Space>

	                                    {loading && <Skeleton active paragraph={{ rows: 6 }} />}
	                                    {!loading && err && (
	                                      <Alert
	                                        type="error"
	                                        showIcon
	                                        message="加载失败"
	                                        description={err}
	                                        action={(
	                                          <Button size="small" onClick={() => ensureTimelineRunDetailLoaded(runId)}>
	                                            重试
	                                          </Button>
	                                        )}
	                                      />
	                                    )}

	                                    {!loading && !err && detail?.id && (
	                                      <>
	                                        <Paragraph
	                                          copyable={{ text: fullText }}
	                                          style={{
	                                            whiteSpace: 'pre-wrap',
	                                            wordBreak: 'break-word',
	                                            overflowWrap: 'anywhere',
	                                            marginBottom: 0,
	                                          }}
	                                        >
	                                          {fullText ? fullText : '（空）'}
	                                        </Paragraph>
	                                        <Text type="secondary">字数（去空白）：{metaWordCount}；字符：{metaLen}</Text>
	                                      </>
	                                    )}

	                                    {!loading && !err && !detail?.id && (
	                                      <Text type="secondary">展开后会自动加载正文；也可点击上方“加载正文”。</Text>
	                                    )}
	                                  </Space>
	                                ),
	                              };
	                            })}
	                          />
	                        )}

	                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
	                          <Pagination
	                            current={latestByDatePage}
	                            pageSize={latestByDatePageSize}
	                            total={Number(latestByDate?.count) || 0}
	                            showSizeChanger
	                            pageSizeOptions={['20', '50', '100', '200']}
	                            onChange={(p, ps) => loadLatestRunsByDate({ page: p, pageSize: ps })}
	                            showTotal={(t) => `共 ${t} 天`}
	                          />
	                        </div>
	                      </>
	                    )}
	                  </Card>
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title={runDetail?.id ? `发布结果（Run #${runDetail.id}）` : '发布结果'}
        open={runModalOpen}
        mask={false}
        onCancel={() => setRunModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRunModalOpen(false)}>关闭</Button>,
          runDetail?.id ? (
            <Button key="refresh" onClick={() => refreshRunDetail(runDetail.id)} loading={runDetailLoading}>
              刷新
            </Button>
          ) : null,
          runDetail?.id ? (
            <Button key="load" onClick={() => loadRunContentIntoEditor(runDetail.id)} loading={runDetailLoading}>
              载入内容到编辑器
            </Button>
          ) : null,
        ].filter(Boolean)}
        width={isMobile ? 'calc(100vw - 24px)' : 900}
      >
        {runDetailLoading && <Text type="secondary">加载中...</Text>}
        {!runDetailLoading && !runDetail && <Text type="secondary">暂无数据</Text>}
        {!runDetailLoading && runDetail && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={`日期：${runDetail.date}；目标账号：${runDetail?.target_account_ids?.length ?? 0} 个；时间：${formatBeijingDateTime(runDetail?.created_at)}`}
              description="发布接口是“发布或更新”，同一天再次发布会更新该记录；历史里“日终稿”展示的是该日最后一次发布。"
            />

            <Card size="small" title="发布内容">
              <Paragraph
                copyable={{ text: runDetail?.content || '' }}
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  marginBottom: 0,
                }}
              >
                {runDetail?.content ? runDetail.content : '（空）'}
              </Paragraph>
            </Card>

            <Divider style={{ margin: '8px 0' }} />

            <Card size="small" title="每账号结果">
              {isMobile ? runDetailListNode : runDetailTableNode}
            </Card>
          </Space>
        )}
      </Modal>
    </Page>
  );
}
