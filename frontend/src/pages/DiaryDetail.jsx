import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BackTop,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Image,
  Input,
  Layout,
  List,
  Modal,
  Radio,
  Space,
  Spin,
  Switch,
  Tag,
  Timeline,
  Typography,
  theme,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CloudOutlined,
  MenuOutlined,
  SmileOutlined,
} from '@ant-design/icons';
import { diaryAPI, diaryHistoryAPI, userAPI } from '../services/api';
import { downloadText, formatExportTimestamp, safeFilenamePart } from '../utils/download';
import { formatBeijingDateTime, formatBeijingDateTimeFromTs, parseServerDate } from '../utils/time';
import { getDiaryWordStats } from '../utils/wordCount';

const { Sider, Content } = Layout;
const { Title, Paragraph } = Typography;
const APP_HEADER_HEIGHT = 'var(--app-header-height)';

export default function DiaryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const currentDiaryId = useMemo(() => {
    const n = Number.parseInt(id, 10);
    return Number.isFinite(n) ? n : null;
  }, [id]);

  const diaryListScrollRef = useRef(null);
  const activeDiaryItemRef = useRef(null);

  const [diary, setDiary] = useState(null);
  const [diaryList, setDiaryList] = useState([]);
  const [history, setHistory] = useState([]);
  const [showMatched, setShowMatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pairedUserId, setPairedUserId] = useState(null);
  const [pairUsers, setPairUsers] = useState({ main: null, matched: null });
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportIncludeMain, setExportIncludeMain] = useState(true);
  const [exportIncludeMatched, setExportIncludeMatched] = useState(true);
  const [exportSearch, setExportSearch] = useState('');
  const [exportOrder, setExportOrder] = useState('asc'); // asc: 从旧到新（更符合“时间线阅读”）
  const [exportFormats, setExportFormats] = useState(['txt', 'md']);
  const [exportSelectedIds, setExportSelectedIds] = useState([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 说明：这里仅希望在 id 变化时触发加载；不把 loadData 放进依赖，避免函数重建导致重复拉取
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 说明：此处仅关注 showMatched / diary / pairUsers 切换逻辑，避免函数重建导致重复拉取
  useEffect(() => {
    if (!diary) return;

    const hasPair = !!(pairUsers?.main?.id && pairUsers?.matched?.id);
    if (showMatched && (hasPair || pairedUserId)) {
      loadMatchedDiaries();
      return;
    }

    loadMyDiaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMatched, diary, pairedUserId, pairUsers]);

  // 记录详情切换时，让左侧/抽屉列表自动定位到“当前记录”位置，避免每次从顶部开始翻。
  useEffect(() => {
    if (!currentDiaryId) return;

    const t = setTimeout(() => {
      const el = activeDiaryItemRef.current;
      if (!el) return;

      const container = diaryListScrollRef.current;
      if (container) {
        const c = container.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        const inView = e.top >= c.top && e.bottom <= c.bottom;
        if (inView) return;
      }

      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, 0);

    return () => clearTimeout(t);
  }, [currentDiaryId, diaryList, showMatched, drawerVisible]);

  const loadData = async () => {
    try {
      setLoading(true);
      const diaryRes = await diaryAPI.get(id);
      const currentDiary = diaryRes.data;
      setDiary(currentDiary);

      setPairedUserId(null);
      setPairUsers({ main: null, matched: null });

      await Promise.all([
        loadMyDiaries(currentDiary.user_id),
        loadPairedUser(currentDiary.account_id, currentDiary.user_id),
        loadHistory(),
      ]);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const getDiaryTimestamp = (item) => {
    // 说明：
    // - 后端（尤其是 SQLite）可能返回不带时区的 datetime 字符串；
    // - 直接 new Date(...) 会把它当作本地时间解析，导致排序/展示偏移；
    // - 这里统一按 parseServerDate 的规则解析（无时区视为 UTC）。
    const raw = item?.created_date || item?.created_time;
    const d = parseServerDate(raw);
    if (d) return d.getTime();
    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) return 0;
    return fallback.getTime();
  };

  const getDiaryTimestampForExport = (item) => {
    const raw = item?.created_time || item?.created_date;
    const d = parseServerDate(raw);
    if (!d) return 0;
    return d.getTime();
  };

  const loadMyDiaries = async (userId = null) => {
    try {
      const uid = userId || diary.user_id;
      const listRes = await diaryAPI.list({ user_id: uid, limit: 100 });
      const sorted = (listRes.data || []).slice().sort((a, b) => (
        getDiaryTimestamp(b) - getDiaryTimestamp(a)
      ));
      setDiaryList(sorted);
    } catch {
      console.error('加载记录列表失败');
    }
  };

  const loadPairedUser = async (accountId, currentUserId) => {
    try {
      const res = await userAPI.paired(accountId);
      const relationships = res.data || [];
      const matchedRel = relationships.find((r) =>
        r?.user?.id === currentUserId || r?.paired_user?.id === currentUserId
      ) || relationships[0];

      if (!matchedRel?.user?.id || !matchedRel?.paired_user?.id) {
        setPairedUserId(null);
        setPairUsers({ main: null, matched: null });
        setShowMatched(false);
        return;
      }

      setPairUsers({ main: matchedRel.user, matched: matchedRel.paired_user });

      const otherUserId = matchedRel.user.id === currentUserId
        ? matchedRel.paired_user.id
        : matchedRel.user.id;
      setPairedUserId(otherUserId);
    } catch {
      console.error('加载配对用户失败');
    }
  };

  const loadMatchedDiaries = async () => {
    const ids = new Set();
    if (pairUsers?.main?.id) ids.add(pairUsers.main.id);
    if (pairUsers?.matched?.id) ids.add(pairUsers.matched.id);
    if (diary?.user_id) ids.add(diary.user_id);
    if (pairedUserId) ids.add(pairedUserId);

    const userIds = Array.from(ids).filter(Boolean);
    if (userIds.length <= 1) {
      await loadMyDiaries(userIds[0] || diary.user_id);
      return;
    }

    try {
      const results = await Promise.all(
        userIds.map((uid) => diaryAPI.list({ user_id: uid, limit: 100 }))
      );

      const map = new Map();
      results.forEach((res) => {
        (res.data || []).forEach((d) => {
          if (d?.id) map.set(d.id, d);
        });
      });

      const merged = Array.from(map.values()).sort((a, b) => (
        getDiaryTimestamp(b) - getDiaryTimestamp(a)
      ));

      setDiaryList(merged);
    } catch {
      message.error('加载匹配记录失败');
    }
  };

  const loadHistory = async () => {
    try {
      const historyRes = await diaryHistoryAPI.list(id);
      setHistory(historyRes.data);
    } catch {
      console.log('暂无历史记录');
    }
  };

  const refreshDiary = async () => {
    try {
      setRefreshing(true);
      const res = await diaryAPI.refresh(id);
      const refreshInfo = res.data?.refresh_info;

      await loadData();

      const usedDetail = !!refreshInfo?.used_all_by_ids;
      const detailReturned = refreshInfo?.all_by_ids_returned === true;
      const updated = refreshInfo?.updated === true;

      if (updated) {
        message.success(usedDetail ? '已刷新（记录详情已更新，使用 all_by_ids）' : '已刷新（记录内容已更新）');
      } else {
        message.warning(refreshInfo?.skipped_reason || '已刷新（内容未发生变化）');
      }

      if (refreshInfo) {
        Modal.info({
          title: '刷新结果',
          width: 640,
          content: (
            <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
              <Descriptions.Item label="阈值（字数）">{refreshInfo.min_len_threshold}</Descriptions.Item>
              <Descriptions.Item label="是否更新">{updated ? <Tag color="green">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="更新来源">{refreshInfo.update_source ? <Tag color="blue">{refreshInfo.update_source}</Tag> : '-'}</Descriptions.Item>
              <Descriptions.Item label="是否调用 sync">{refreshInfo.used_sync ? <Tag color="geekblue">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="sync 是否命中该记录">{refreshInfo.sync_found ? <Tag color="green">命中</Tag> : <Tag>未命中</Tag>}</Descriptions.Item>
              <Descriptions.Item label="sync 内容长度">{refreshInfo.sync_content_len ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="sync is_simple">{typeof refreshInfo.sync_is_simple === 'boolean' ? String(refreshInfo.sync_is_simple) : '-'}</Descriptions.Item>
              <Descriptions.Item label="是否调用 all_by_ids">{usedDetail ? <Tag color="purple">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
              <Descriptions.Item label="all_by_ids 是否返回该记录">{usedDetail ? (detailReturned ? <Tag color="green">返回</Tag> : <Tag color="red">未返回</Tag>) : '-'}</Descriptions.Item>
              <Descriptions.Item label="详情内容长度">{refreshInfo.detail_content_len ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="详情仍然过短">{typeof refreshInfo.detail_is_short === 'boolean' ? (refreshInfo.detail_is_short ? <Tag color="orange">是</Tag> : <Tag color="green">否</Tag>) : '-'}</Descriptions.Item>
              <Descriptions.Item label="详情尝试次数">{refreshInfo.detail_attempts ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="未更新原因">{refreshInfo.skipped_reason ?? '-'}</Descriptions.Item>
            </Descriptions>
          ),
        });
      }
    } catch {
      message.error('刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  const getDiaryOwner = (item) => {
    if (pairUsers?.matched?.id && item?.user_id === pairUsers.matched.id) return 'matched';
    if (pairUsers?.main?.id && item?.user_id === pairUsers.main.id) return 'main';
    if (diary?.user_id && item?.user_id === diary.user_id) return 'main';
    return 'main';
  };

  const getBorderColor = (item) => {
    return getDiaryOwner(item) === 'matched' ? token.magenta6 : token.colorPrimary;
  };

  const getActiveBgColor = (item) => {
    return getDiaryOwner(item) === 'matched' ? token.magenta1 : token.colorPrimaryBg;
  };

  const canExportMatched = !!(showMatched && pairUsers?.main?.id && pairUsers?.matched?.id);

  const wordStats = useMemo(() => getDiaryWordStats(diary), [diary]);
  const titleWordCount = wordStats?.title?.no_whitespace ?? 0;
  const contentWordCount = wordStats?.content?.no_whitespace ?? 0;
  const totalWordCount = wordStats?.total?.no_whitespace ?? 0;
  const contentRawCount = wordStats?.content?.raw ?? 0;
  const modifiedTimeText = useMemo(() => formatBeijingDateTimeFromTs(diary?.ts), [diary?.ts]);

  const diaryImages = useMemo(() => {
    const images = diary?.attachments?.images;
    return Array.isArray(images) ? images.filter(Boolean) : [];
  }, [diary]);

  const diaryImageById = useMemo(() => {
    const map = new Map();
    for (const img of (diaryImages || [])) {
      const idNum = Number(img?.image_id);
      if (Number.isFinite(idNum)) map.set(idNum, img);
    }
    return map;
  }, [diaryImages]);

  const [failedImageIds, setFailedImageIds] = useState({});
  useEffect(() => {
    // 切换记录时清空图片失败状态，避免复用旧的 error 状态
    setFailedImageIds({});
  }, [diary?.id]);

  const markImageFailed = (imageId) => {
    if (!imageId) return;
    setFailedImageIds((prev) => ({ ...(prev || {}), [imageId]: true }));
  };

  const renderDiaryContent = (raw) => {
    const text = String(raw ?? '');
    const re = /\[图(\d+)\]/g;
    const nodes = [];
    let lastIndex = 0;
    let match;

    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        nodes.push({ type: 'text', value: text.slice(lastIndex, start), key: `t-${lastIndex}` });
      }

      const imageId = Number(match[1]);
      nodes.push({ type: 'image', imageId, key: `img-${start}-${imageId}` });
      lastIndex = end;
    }
    if (lastIndex < text.length) {
      nodes.push({ type: 'text', value: text.slice(lastIndex), key: `t-${lastIndex}` });
    }

    return nodes.map((n) => {
      if (n.type === 'text') {
        return <span key={n.key}>{n.value}</span>;
      }
      const imageId = n.imageId;
      const imgInfo = diaryImageById.get(imageId);
      const src = imgInfo?.url || `/api/diaries/${diary?.id}/images/${imageId}`;

      if (failedImageIds?.[imageId]) {
        return (
          <div key={n.key} style={{ margin: '12px 0', padding: 12, borderRadius: 8, background: token.colorFillAlter, color: token.colorTextSecondary }}>
            图片 {imageId} 加载失败（可能无权限或已删除）
          </div>
        );
      }

      return (
        <div key={n.key} style={{ margin: '12px 0' }}>
          <Image
            src={src}
            alt={`图${imageId}`}
            style={{ maxWidth: '100%', borderRadius: 8 }}
            onError={() => markImageFailed(imageId)}
          />
        </div>
      );
    });
  };

  const exportCandidateDiaries = useMemo(() => {
    const list = (diaryList || []).filter(Boolean);
    const resolveOwner = (item) => {
      // 未开启“显示匹配记录”时，当前列表就是“你正在看的这位用户”的记录：
      // 这时候导出不应因为识别为 matched 而被过滤为空。
      if (!canExportMatched) return 'main';
      if (pairUsers?.matched?.id && item?.user_id === pairUsers.matched.id) return 'matched';
      if (pairUsers?.main?.id && item?.user_id === pairUsers.main.id) return 'main';
      if (diary?.user_id && item?.user_id === diary.user_id) return 'main';
      return 'main';
    };

    const filteredByOwner = list.filter((d) => {
      const owner = resolveOwner(d);
      if (owner === 'matched') return exportIncludeMatched && canExportMatched;
      return exportIncludeMain;
    });

    const kw = exportSearch.trim().toLowerCase();
    if (!kw) return filteredByOwner;

    return filteredByOwner.filter((d) => {
      const title = String(d?.title ?? '').toLowerCase();
      const content = String(d?.content ?? '').toLowerCase();
      const date = String(d?.created_date ?? '').toLowerCase();
      return title.includes(kw) || content.includes(kw) || date.includes(kw);
    });
  }, [diaryList, exportIncludeMain, exportIncludeMatched, exportSearch, canExportMatched, pairUsers, diary]);

  useEffect(() => {
    if (!exportModalOpen) return;
    if (canExportMatched) return;
    setExportIncludeMatched(false);
  }, [exportModalOpen, canExportMatched]);

  useEffect(() => {
    if (!exportModalOpen) return;
    const candidateIds = new Set(exportCandidateDiaries.map(d => d?.id).filter(Boolean));
    setExportSelectedIds((prev) => (prev || []).filter((diaryId) => candidateIds.has(diaryId)));
  }, [exportModalOpen, exportCandidateDiaries]);

  const getOwnerTextForExport = (item) => {
    if (!canExportMatched) return '我的记录';
    const owner = getDiaryOwner(item);
    if (owner === 'matched') {
      const name = pairUsers?.matched?.name ? `：${pairUsers.matched.name}` : '';
      return `被匹配用户${name}`;
    }
    const name = pairUsers?.main?.name ? `：${pairUsers.main.name}` : '';
    return `主用户${name}`;
  };

  const getUsernameForExport = (item) => {
    const uid = item?.user_id;
    if (!uid) return '未知用户';
    if (pairUsers?.matched?.id && uid === pairUsers.matched.id) return pairUsers.matched?.name || `用户 ${uid}`;
    if (pairUsers?.main?.id && uid === pairUsers.main.id) return pairUsers.main?.name || `用户 ${uid}`;
    if (diary?.user_id && uid === diary.user_id) return pairUsers.main?.name || `用户 ${uid}`;
    return `用户 ${uid}`;
  };

  const openExportModal = () => {
    const currentId = Number.parseInt(id, 10);

    setExportModalOpen(true);
    setExportSearch('');
    setExportOrder('asc');
    setExportFormats([]);

    if (canExportMatched) {
      setExportIncludeMain(true);
      setExportIncludeMatched(true);
    } else {
      setExportIncludeMain(true);
      setExportIncludeMatched(false);
    }

    if (Number.isFinite(currentId) && currentId > 0) {
      setExportSelectedIds([currentId]);
    } else {
      setExportSelectedIds([]);
    }
  };

  const buildExportText = (items) => {
    const body = items.map((d) => {
      const date = d?.created_date || '-';
      const title = d?.title || '无标题';
      const username = getUsernameForExport(d);

      const content = (d?.content ?? '').trim();
      return [
        date,
        username,
        title,
        content || '（空）',
        '',
        '----------------------------------------',
        '',
      ].join('\n');
    }).join('');

    return body;
  };

  const buildExportMarkdown = (items) => {
    const quoteBlock = (value) => {
      const s = String(value ?? '').replace(/\r\n/g, '\n');
      return s.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
    };

    return items.map((d) => {
      const date = d?.created_date || '-';
      const username = getUsernameForExport(d);
      const title = d?.title || '无标题';
      const content = (d?.content ?? '').trim() || '（空）';

      // 目标：视觉上规整，且标题/内容都在引用块里
      // - 用 `---` 作为硬分隔符（前后留空行）
      // - 头部用二级标题：日期 · 用户名
      // - 引用块里先放标题，再放内容
      return [
        `## ${date} · ${username}`,
        '',
        quoteBlock(title),
        '>',
        quoteBlock(content),
        '',
        '---',
        '',
      ].join('\n');
    }).join('\n');
  };

  const buildExportJson = (items, { order, includeMain, includeMatched, keyword }) => {
    const exportedAt = new Date();
    const payload = {
      meta: {
        exported_at: exportedAt.toISOString(),
        exported_at_local: formatBeijingDateTime(exportedAt),
        count: items.length,
        order,
        can_export_matched: canExportMatched,
        include_main: includeMain,
        include_matched: includeMatched,
        keyword: keyword?.trim() || null,
      },
      diaries: items.map((d) => ({
        id: d?.id ?? null,
        user_id: d?.user_id ?? null,
        account_id: d?.account_id ?? null,
        nideriji_diary_id: d?.nideriji_diary_id ?? null,
        title: d?.title ?? null,
        content: d?.content ?? null,
        created_date: d?.created_date ?? null,
        created_time: d?.created_time ?? null,
        weather: d?.weather ?? null,
        mood: d?.mood ?? null,
        space: d?.space ?? null,
        ts: d?.ts ?? null,
        owner: canExportMatched ? getDiaryOwner(d) : 'main',
        owner_text: getOwnerTextForExport(d),
      })),
    };
    return JSON.stringify(payload, null, 2);
  };

  const handleExport = async () => {
    if (exporting) return;

    const formats = exportFormats || [];
    if (formats.length === 0) {
      message.warning('请至少选择一种导出格式');
      return;
    }

    const selectedSet = new Set(exportSelectedIds || []);
    const selected = exportCandidateDiaries.filter((d) => selectedSet.has(d?.id));

    if (selected.length === 0) {
      message.warning('请先选择要导出的记录');
      return;
    }

    const sorted = selected.slice().sort((a, b) => {
      const ta = getDiaryTimestampForExport(a);
      const tb = getDiaryTimestampForExport(b);
      return exportOrder === 'asc' ? (ta - tb) : (tb - ta);
    });

    setExporting(true);
    try {
      const ts = formatExportTimestamp(new Date());
      const countPart = `${sorted.length}条`;
      const orderPart = exportOrder === 'asc' ? '从旧到新' : '从新到旧';

      const scopePart = canExportMatched
        ? (exportIncludeMain && exportIncludeMatched
          ? '主用户+被匹配用户'
          : exportIncludeMain
            ? '主用户'
            : '被匹配用户')
        : '我的记录';

      const keywordPart = safeFilenamePart(exportSearch.trim());
      const keywordSuffix = keywordPart ? `-${keywordPart}` : '';

      const baseName = `记录导出-${scopePart}-${orderPart}-${countPart}${keywordSuffix}-${ts}`;
      const buildOpts = {
        order: exportOrder,
        includeMain: exportIncludeMain,
        includeMatched: exportIncludeMatched,
        keyword: exportSearch,
      };

      if (formats.includes('txt')) {
        const text = buildExportText(sorted);
        downloadText(text, `${baseName}.txt`, 'text/plain;charset=utf-8');
      }
      if (formats.includes('md')) {
        const md = buildExportMarkdown(sorted);
        downloadText(md, `${baseName}.md`, 'text/markdown;charset=utf-8');
      }
      if (formats.includes('json')) {
        const json = buildExportJson(sorted, buildOpts);
        downloadText(json, `${baseName}.json`, 'application/json;charset=utf-8');
      }

      message.success(`已导出：${sorted.length} 条（${formats.join(' / ').toUpperCase()}）`);
      setExportModalOpen(false);
    } catch (e) {
      message.error(`导出失败：${e?.message || String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: `calc(100vh - ${APP_HEADER_HEIGHT})`
      }}>
        <Spin size="large" />
      </div>
    );
  }

  const DiaryListContent = () => (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: token.colorBgContainer,
    }}>
      <div style={{
        padding: '20px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
      }}>
        <Title level={4} style={{ margin: '0 0 16px 0' }}>记录列表</Title>
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Switch
              checked={showMatched}
              onChange={setShowMatched}
              disabled={!(pairUsers?.main?.id && pairUsers?.matched?.id)}
            />
            <span style={{ marginLeft: 8, fontSize: '14px' }}>显示匹配记录</span>
          </div>
          <Button onClick={openExportModal} block>
            导出…
          </Button>
          {pairUsers?.main?.id && pairUsers?.matched?.id && (
            <div style={{ fontSize: '12px', color: token.colorTextSecondary }}>
              <div>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: token.colorPrimary, marginRight: 6, borderRadius: 2 }}></span>
                主用户{pairUsers.main?.name ? `：${pairUsers.main.name}` : ''}
              </div>
              <div>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: token.magenta6, marginRight: 6, borderRadius: 2 }}></span>
                被匹配用户{pairUsers.matched?.name ? `：${pairUsers.matched.name}` : ''}
              </div>
            </div>
          )}
        </Space>
      </div>

      <div ref={diaryListScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <List
          dataSource={diaryList}
          renderItem={(item) => {
            const modifiedText = formatBeijingDateTimeFromTs(item?.ts);
            const wordCount = getDiaryWordStats(item)?.content?.no_whitespace ?? 0;
            const isActive = !!(currentDiaryId && item?.id === currentDiaryId);

            return (
              <div
                ref={(el) => {
                  if (isActive) activeDiaryItemRef.current = el;
                }}
              >
                <Card
                  hoverable
                  onClick={() => {
                    navigate(`/diary/${item.id}`);
                    if (isMobile) setDrawerVisible(false);
                  }}
                  style={{
                    marginBottom: 12,
                    borderLeft: `4px solid ${getBorderColor(item)}`,
                    background: isActive ? getActiveBgColor(item) : token.colorBgContainer,
                    cursor: 'pointer',
                  }}
                  bodyStyle={{ padding: '12px 16px' }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 4, fontSize: '14px' }}>
                    {item.title || '无标题'}
                  </div>
                  <div style={{ fontSize: '12px', color: token.colorTextSecondary }}>
                    <CalendarOutlined style={{ marginRight: 4 }} />
                    {item.created_date}
                  </div>
                  <div style={{ fontSize: '12px', color: token.colorTextSecondary, marginTop: 4 }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    最后修改 {modifiedText} · {wordCount} 字
                  </div>
                </Card>
              </div>
            );
          }}
        />
      </div>
    </div>
  );

  const stickyTop = `calc(${APP_HEADER_HEIGHT} + 24px)`;
  const stickyHeight = `calc(100vh - ${APP_HEADER_HEIGHT} - 48px)`;

  return (
    <Layout style={{ minHeight: `calc(100vh - ${APP_HEADER_HEIGHT})`, background: token.colorBgLayout }}>
      {!isMobile && (
        <Sider
          width={320}
          style={{
            background: token.colorBgContainer,
            boxShadow: '2px 0 8px rgba(0,0,0,0.05)',
            height: stickyHeight,
            position: 'sticky',
            top: stickyTop,
            overflow: 'hidden'
          }}
        >
          <DiaryListContent />
        </Sider>
      )}

      <Content style={{
        maxWidth: 1400,
        margin: '0 auto',
        width: '100%',
        minWidth: 0
      }}>
        <Space direction="vertical" size={isMobile ? 'middle' : 'large'} style={{ width: '100%' }}>
          <div
            style={{
               position: 'sticky',
               top: `calc(${APP_HEADER_HEIGHT} + 12px)`,
               zIndex: 20,
               background: token.colorBgLayout,
               backdropFilter: 'blur(8px)',
               padding: isMobile ? '8px 0' : '12px 0',
               borderBottom: `1px solid ${token.colorBorderSecondary}`,
             }}
           >
            <Space wrap size={isMobile ? 'small' : 'middle'} style={{ width: '100%' }}>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} size={isMobile ? 'middle' : 'large'}>
                返回
              </Button>
              <Button onClick={refreshDiary} loading={refreshing} size={isMobile ? 'middle' : 'large'}>
                {isMobile ? '刷新详情' : '重新访问此记录详情（强制更新）'}
              </Button>
              {isMobile && (
                <Button icon={<MenuOutlined />} onClick={() => setDrawerVisible(true)} size={isMobile ? 'middle' : 'large'}>
                  记录列表
                </Button>
              )}
            </Space>
          </div>

          <Card
            bordered={false}
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderRadius: 8
            }}
            bodyStyle={{ padding: isMobile ? 16 : 24 }}
          >
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
              <Title level={isMobile ? 3 : 2} style={{ marginBottom: 16 }}>
                {diary.title || '无标题'}
              </Title>

              <Space size={isMobile ? 'small' : 'middle'} wrap style={{ marginBottom: isMobile ? 16 : 24 }}>
                <Tag icon={<CalendarOutlined />} color="blue" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                  {diary.created_date}
                </Tag>
                {diary.mood && (
                  <Tag icon={<SmileOutlined />} color="orange" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                    {diary.mood}
                  </Tag>
                )}
                {diary.weather && (
                  <Tag icon={<CloudOutlined />} color="cyan" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                    {diary.weather}
                  </Tag>
                )}
                <Tag icon={<ClockCircleOutlined />} color="purple" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                  修改时间：{modifiedTimeText}
                </Tag>
                <Tag color="geekblue" style={{ padding: isMobile ? '2px 10px' : '4px 12px', fontSize: isMobile ? '13px' : '14px' }}>
                  字数：{contentWordCount} 字
                </Tag>
              </Space>

              <div style={{ color: token.colorTextSecondary, fontSize: 12, marginBottom: isMobile ? 12 : 16 }}>
                修改时间：{modifiedTimeText}；字数（不含空白）：标题 {titleWordCount} / 正文 {contentWordCount} / 合计 {totalWordCount}；正文原始字符数 {contentRawCount}
              </div>

              <Divider />

              <Paragraph style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                lineHeight: 1.8,
                fontSize: '15px',
                color: token.colorText,
                marginBottom: 0
              }}>
                {renderDiaryContent(diary.content)}
              </Paragraph>
            </div>
          </Card>

          {history.length > 0 && (
            <Card
              title={
                <Space>
                  <ClockCircleOutlined style={{ color: token.colorPrimary }} />
                  <span>修改历史</span>
                </Space>
              }
              bordered={false}
              style={{
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                borderRadius: 8
              }}
            >
              <Timeline>
                {history.map(h => (
                  <Timeline.Item key={h.id} color="blue">
                    <div style={{ fontSize: '12px', color: token.colorTextSecondary, marginBottom: 8 }}>
                      {formatBeijingDateTime(h.recorded_at)}
                    </div>
                    <Card
                      size="small"
                      style={{ background: token.colorFillAlter, border: 'none' }}
                    >
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>{h.title}</div>
                      <div style={{ fontSize: '14px', color: token.colorText, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{h.content}</div>
                    </Card>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Card>
          )}

          <Card
            title={`附件（图片 ${diaryImages.length}）`}
            bordered={false}
            style={{
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              borderRadius: 8,
            }}
          >
            {diaryImages.length > 0 ? (
              <Image.PreviewGroup>
                <Space wrap size={[12, 12]}>
                  {diaryImages.map((img) => {
                    const imageId = Number(img?.image_id);
                    const src = img?.url || `/api/diaries/${diary?.id}/images/${imageId}`;
                    if (!imageId) return null;

                    const failed = !!failedImageIds?.[imageId];

                    return (
                      <div key={`att-${imageId}`} style={{ width: 120 }}>
                        {failed ? (
                          <div
                            style={{
                              width: 120,
                              height: 120,
                              borderRadius: 8,
                              background: token.colorFillAlter,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 8,
                              color: token.colorTextSecondary,
                              textAlign: 'center',
                              fontSize: 12,
                            }}
                          >
                            加载失败
                          </div>
                        ) : (
                          <Image
                            src={src}
                            alt={`图${imageId}`}
                            width={120}
                            height={120}
                            style={{ objectFit: 'cover', borderRadius: 8 }}
                            onError={() => markImageFailed(imageId)}
                          />
                        )}

                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: token.colorTextSecondary,
                            textAlign: 'center',
                            lineHeight: 1.2,
                            userSelect: 'none',
                          }}
                        >
                          图{imageId}
                        </div>
                      </div>
                    );
                  })}
                </Space>
              </Image.PreviewGroup>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无附件" />
            )}
          </Card>
        </Space>
      </Content>

      {isMobile && (
        <Drawer
          title="记录列表"
          placement="left"
          onClose={() => setDrawerVisible(false)}
          open={drawerVisible}
          width={280}
        >
          <DiaryListContent />
        </Drawer>
      )}

      <Modal
        title="导出记录"
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        onOk={handleExport}
        okText={exporting ? '导出中…' : '导出'}
        cancelText="取消"
        confirmLoading={exporting}
        width={isMobile ? 'calc(100vw - 24px)' : 760}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>导出范围</div>
            {canExportMatched ? (
              <Space wrap>
                <Checkbox checked={exportIncludeMain} onChange={(e) => setExportIncludeMain(e.target.checked)}>
                  主用户（我的记录）{pairUsers?.main?.name ? `：${pairUsers.main.name}` : ''}
                </Checkbox>
                <Checkbox checked={exportIncludeMatched} onChange={(e) => setExportIncludeMatched(e.target.checked)}>
                  被匹配用户{pairUsers?.matched?.name ? `：${pairUsers.matched.name}` : ''}
                </Checkbox>
              </Space>
            ) : (
              <div style={{ color: token.colorTextSecondary }}>当前仅可导出我的记录（未开启/不可用“显示匹配记录”）。</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>排序</div>
            <Radio.Group value={exportOrder} onChange={(e) => setExportOrder(e.target.value)}>
              <Radio value="asc">从旧到新（时间线）</Radio>
              <Radio value="desc">从新到旧</Radio>
            </Radio.Group>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>格式（可多选）</div>
            <Space wrap>
              <Checkbox
                checked={(exportFormats || []).includes('txt')}
                onChange={(e) => {
                  setExportFormats((prev) => {
                    const base = new Set(prev || []);
                    if (e.target.checked) base.add('txt');
                    else base.delete('txt');
                    return Array.from(base);
                  });
                }}
              >
                TXT
              </Checkbox>
              <Checkbox
                checked={(exportFormats || []).includes('md')}
                onChange={(e) => {
                  setExportFormats((prev) => {
                    const base = new Set(prev || []);
                    if (e.target.checked) base.add('md');
                    else base.delete('md');
                    return Array.from(base);
                  });
                }}
              >
                Markdown
              </Checkbox>
              <Checkbox
                checked={(exportFormats || []).includes('json')}
                onChange={(e) => {
                  setExportFormats((prev) => {
                    const base = new Set(prev || []);
                    if (e.target.checked) base.add('json');
                    else base.delete('json');
                    return Array.from(base);
                  });
                }}
              >
                JSON（结构化，包含完整字段）
              </Checkbox>
            </Space>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>选择要导出的记录</div>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="按标题 / 内容 / 日期 搜索（可选）"
                value={exportSearch}
                onChange={(e) => setExportSearch(e.target.value)}
                allowClear
              />
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => setExportSelectedIds(exportCandidateDiaries.map(d => d?.id).filter(Boolean))}
                  disabled={exportCandidateDiaries.length === 0}
                >
                  全选当前列表
                </Button>
                <Button size="small" onClick={() => setExportSelectedIds([])}>
                  全不选
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const currentId = Number.parseInt(id, 10);
                    if (!Number.isFinite(currentId) || currentId <= 0) return;
                    setExportSelectedIds([currentId]);
                  }}
                >
                  仅当前记录
                </Button>
                <span style={{ color: token.colorTextSecondary }}>
                  已选 {exportSelectedIds.length} / {exportCandidateDiaries.length}
                </span>
              </Space>

              <div style={{ maxHeight: isMobile ? 320 : 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
                <List
                  size="small"
                  dataSource={exportCandidateDiaries}
                  locale={{ emptyText: '暂无可导出的记录' }}
                  renderItem={(item) => {
                    const checked = (exportSelectedIds || []).includes(item?.id);
                    const owner = getDiaryOwner(item);
                    const color = owner === 'matched' ? 'magenta' : 'blue';
                    return (
                      <List.Item
                        style={{ padding: '8px 6px' }}
                        onClick={() => {
                          const idNum = item?.id;
                          if (!idNum) return;
                          setExportSelectedIds((prev) => {
                            const set = new Set(prev || []);
                            if (set.has(idNum)) set.delete(idNum);
                            else set.add(idNum);
                            return Array.from(set);
                          });
                        }}
                      >
                        <Space align="start" style={{ width: '100%' }}>
                          <Checkbox checked={checked} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item?.title || '无标题'}
                            </div>
                            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                              <Tag color={color} style={{ marginRight: 6 }}>{getUsernameForExport(item)}</Tag>
                              <span>{item?.created_date || '-'}</span>
                            </div>
                          </div>
                        </Space>
                      </List.Item>
                    );
                  }}
                />
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      <BackTop />
    </Layout>
  );
}
