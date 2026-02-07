import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Grid, Input, List, Space, Switch, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, CalendarOutlined, HistoryOutlined } from '@ant-design/icons';

import { statsAPI } from '../services/api';
import Page from '../components/Page';
import { getErrorMessage } from '../utils/errorMessage';
import { beijingDateStringToUtcRangeMs, formatBeijingDateTime, formatBeijingDateTimeFromTs, getBeijingDateString } from '../utils/time';
import { getDiaryWordStats } from '../utils/wordCount';

const { Title, Text } = Typography;

const HISTORY_LIMIT = 300;

export default function PairedIncreaseHistory() {
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const todayText = useMemo(() => getBeijingDateString(0), []);
  const yesterdayText = useMemo(() => getBeijingDateString(-1), []);
  const beforeYesterdayText = useMemo(() => getBeijingDateString(-2), []);

  const [selectedDate, setSelectedDate] = useState(() => todayText);
  // 与仪表盘“新增配对记录”口径保持一致：默认包含停用账号，避免漏算。
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);
  const [diaries, setDiaries] = useState([]);
  const [authorByUserId, setAuthorByUserId] = useState({});

  const hiddenCount = Math.max(0, (Number(count) || 0) - (Array.isArray(diaries) ? diaries.length : 0));

  const loadData = useCallback(async () => {
    const { since_ms, until_ms } = beijingDateStringToUtcRangeMs(selectedDate);
    if (!since_ms || !until_ms) {
      setCount(0);
      setDiaries([]);
      setAuthorByUserId({});
      return;
    }

    setLoading(true);
    try {
      const res = await statsAPI.pairedDiariesIncrease({
        since_ms,
        until_ms,
        limit: HISTORY_LIMIT,
        include_inactive: includeInactive,
      });
      const data = res?.data || {};

      const list = Array.isArray(data?.diaries) ? data.diaries : [];
      const authors = Array.isArray(data?.authors) ? data.authors : [];

      const map = {};
      authors.forEach((u) => {
        const id = Number(u?.id);
        if (!id) return;
        map[id] = u;
      });

      setCount(Number(data?.count || 0));
      setDiaries(list);
      setAuthorByUserId(map);
    } catch (error) {
      message.error('加载新增配对记录历史失败：' + getErrorMessage(error));
      setCount(0);
      setDiaries([]);
      setAuthorByUserId({});
    } finally {
      setLoading(false);
    }
  }, [selectedDate, includeInactive]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <Page>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space wrap align="baseline" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Title level={3} style={{ marginTop: 0, marginBottom: 0 }}>
            新增配对记录（历史）
          </Title>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
            返回
          </Button>
        </Space>

        <Text type="secondary">
          按入库时间（created_at）统计，口径为“配对用户记录”。选择日期以北京时间为准。
        </Text>

        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap style={{ width: '100%' }}>
              <Button
                size="small"
                type={selectedDate === todayText ? 'primary' : 'default'}
                icon={<HistoryOutlined />}
                onClick={() => setSelectedDate(todayText)}
              >
                今天
              </Button>
              <Button
                size="small"
                type={selectedDate === yesterdayText ? 'primary' : 'default'}
                onClick={() => setSelectedDate(yesterdayText)}
              >
                昨天
              </Button>
              <Button
                size="small"
                type={selectedDate === beforeYesterdayText ? 'primary' : 'default'}
                onClick={() => setSelectedDate(beforeYesterdayText)}
              >
                前天
              </Button>

              <Space size={8} wrap>
                <CalendarOutlined />
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ width: isMobile ? 160 : 180 }}
                />
              </Space>

              <Space size={8} wrap style={{ marginLeft: 'auto' }}>
                <Text type="secondary">包含停用账号</Text>
                <Switch checked={includeInactive} onChange={setIncludeInactive} />
              </Space>
            </Space>

            <Space wrap>
              <Tag color="blue">统计日期：{selectedDate}（北京时间）</Tag>
              <Tag color="cyan">按入库时间统计</Tag>
              <Tag color={includeInactive ? 'gold' : 'green'}>
                {includeInactive ? '包含停用账号' : '仅启用账号'}
              </Tag>
              <Tag color="geekblue">共 {Number(count) || 0} 条</Tag>
            </Space>

            {hiddenCount > 0 && (
              <Text type="secondary">
                仅展示最近 {diaries.length} 条（还有 {hiddenCount} 条未展示）
              </Text>
            )}
          </Space>
        </Card>

        <Card bordered={false}>
          <List
            dataSource={diaries}
            loading={loading}
            locale={{ emptyText: '当日暂无新增配对记录' }}
            renderItem={(item) => {
              const stats = getDiaryWordStats(item);
              const wordCount = stats?.content?.no_whitespace ?? 0;

              const author = authorByUserId?.[item?.user_id];
              const authorName = author?.name || (item?.user_id ? `用户 ${item.user_id}` : '未知作者');
              const authorText = author?.nideriji_userid ? `${authorName}（${author.nideriji_userid}）` : authorName;

              const insertedAtText = item?.created_at ? formatBeijingDateTime(item.created_at) : '';
              const showInsertedAt = insertedAtText && insertedAtText !== '-';

              const updatedAtText = formatBeijingDateTimeFromTs(item?.ts);

              const content = String(item?.content ?? '');
              const snippetLimit = isMobile ? 60 : 120;
              const snippet = content
                ? (content.length > snippetLimit ? `${content.slice(0, snippetLimit)}…` : content)
                : '（空）';

              return (
                <List.Item
                  key={item?.id}
                  style={{ cursor: 'pointer', paddingLeft: 4, paddingRight: 4 }}
                  onClick={() => navigate(`/diary/${item.id}`)}
                >
                  <List.Item.Meta
                    title={(
                      <Space wrap size={8}>
                        <Tag color="magenta">{authorText}</Tag>
                        <Tag color="blue">{item?.created_date || '-'}</Tag>
                        {showInsertedAt && <Tag color="cyan">入库 {insertedAtText}</Tag>}
                        {updatedAtText && <Tag color="purple">更新 {updatedAtText}</Tag>}
                        <Tag color="geekblue">{wordCount} 字</Tag>
                        <span style={{ fontWeight: 500 }}>{item?.title || '无标题'}</span>
                      </Space>
                    )}
                    description={<Text type="secondary">{snippet}</Text>}
                  />
                </List.Item>
              );
            }}
          />
        </Card>
      </Space>
    </Page>
  );
}
