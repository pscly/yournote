import { Alert, Button, Empty, Space, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getErrorMessage } from '../utils/errorMessage';

const { Text } = Typography;

export default function PageState({
  loading = false,
  error = null,
  empty = false,
  emptyText = '暂无数据',
  onRetry = null,
  children = null,
}) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    const msg = typeof error === 'string' ? error : getErrorMessage(error);
    return (
      <div style={{ padding: 8 }}>
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={(
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="secondary">{msg}</Text>
              {typeof onRetry === 'function' && (
                <Button icon={<ReloadOutlined />} onClick={onRetry}>
                  重试
                </Button>
              )}
            </Space>
          )}
        />
      </div>
    );
  }

  if (empty) {
    return (
      <div style={{ padding: 24 }}>
        <Empty description={emptyText} />
      </div>
    );
  }

  return children;
}

