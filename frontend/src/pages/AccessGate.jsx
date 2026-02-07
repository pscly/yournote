import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Space, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { accessAPI } from '../services/api';
import { getErrorMessage } from '../utils/errorMessage';
import { sha256Hex } from '../utils/sha256';

const { Title, Text } = Typography;

export default function AccessGate() {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const redirectTarget = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    const raw = params.get('redirect') || '/';
    return raw.startsWith('/') ? raw : '/';
  }, [location.search]);

  const handleSubmit = async (values) => {
    const password = String(values?.password ?? '').trim();
    if (!password) {
      message.error('请输入访问密码');
      return;
    }

    setSubmitting(true);
    try {
      const passwordHash = await sha256Hex(password);
      await accessAPI.login({ password_hash: passwordHash });
      message.success('验证通过');
      form.resetFields();
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (detail === 'ACCESS_DENIED') {
        message.error('访问密码错误');
        form.setFields([{ name: 'password', errors: ['访问密码错误'] }]);
        return;
      }
      message.error(`登录失败：${getErrorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <Card
        style={{ width: 'min(420px, 100%)' }}
        styles={{ body: { padding: 24 } }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Title level={3} style={{ marginTop: 0, marginBottom: 8 }}>
              请输入访问密码
            </Title>
            <Text type="secondary">
              这是门禁
            </Text>
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            requiredMark={false}
          >
            <Form.Item
              name="password"
              label="访问密码"
              rules={[{ required: true, message: '请输入访问密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="请输入访问密码"
                autoFocus
              />
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              block
            >
              进入
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
