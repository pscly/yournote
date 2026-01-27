// 默认使用同源 `/api`，配合 Vite 代理可避免跨设备访问时 `localhost` 指向错误的问题。
// 额外处理：
// - 空字符串/全空白 -> 回退默认值
// - 尾部 `/` -> 去掉，避免拼接出 `//accounts` 这类路径
const raw = import.meta.env.VITE_API_BASE_URL;
const normalized = (typeof raw === 'string' ? raw.trim() : '') || '/api';
export const API_BASE_URL = normalized.replace(/\/+$/, '') || '/api';
