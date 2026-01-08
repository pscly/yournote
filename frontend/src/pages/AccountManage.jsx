import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { accountAPI } from '../services/api';
import { NIDERIJI_TOKEN, NIDERIJI_USERID } from '../config';

export default function AccountManage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const res = await accountAPI.list();
      setAccounts(res.data);
    } catch (error) {
      message.error('加载失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (values) => {
    try {
      await accountAPI.create(values);
      message.success('添加成功！');
      setModalVisible(false);
      form.resetFields();
      loadAccounts();
    } catch (error) {
      message.error('添加失败: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await accountAPI.delete(id);
      message.success('删除成功！');
      loadAccounts();
    } catch (error) {
      message.error('删除失败: ' + error.message);
    }
  };

  const handleQuickAdd = () => {
    form.setFieldsValue({
      nideriji_userid: NIDERIJI_USERID,
      auth_token: NIDERIJI_TOKEN,
      email: '550191537@qq.com',
    });
    setModalVisible(true);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id' },
    { title: '用户ID', dataIndex: 'nideriji_userid', key: 'nideriji_userid' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '状态', dataIndex: 'is_active', key: 'is_active', render: (val) => val ? '活跃' : '停用' },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)}>
          删除
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleQuickAdd}>
          快速添加当前账号
        </Button>
      </div>

      <Table columns={columns} dataSource={accounts} rowKey="id" loading={loading} />

      <Modal
        title="添加账号"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="nideriji_userid" label="用户ID" rules={[{ required: true }]}>
            <Input type="number" />
          </Form.Item>
          <Form.Item name="auth_token" label="Token" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
