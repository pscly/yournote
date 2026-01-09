// 默认使用同源 `/api`，配合 Vite 代理可避免跨设备访问时 `localhost` 指向错误的问题
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const NIDERIJI_TOKEN = "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJPaFNoZW5naHVvIiwiZXhwIjoxODI5ODA4NzY0LjYzODIwMiwidXNhZ2UiOiJsb2dpbiIsInVzZXJfaWQiOjQ2MDEwMH0.QPo7_h30nVre6sZ4KyziDC5mzjc446invEsE-hHCgbc";

export const NIDERIJI_USERID = 460100;
