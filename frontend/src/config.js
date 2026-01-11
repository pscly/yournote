// 默认使用同源 `/api`，配合 Vite 代理可避免跨设备访问时 `localhost` 指向错误的问题
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
