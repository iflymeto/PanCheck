import { api } from './authApi';

export interface SystemInfo {
  os: string;
  arch: string;
  go_version: string;
  cpu_count: number;
  memory_total: number;
  memory_used: number;
  memory_usage: number;
  disk_total: number;
  disk_used: number;
  disk_usage: number;
  hostname: string;
  start_time: string;
  uptime: string;
  goroutines: number;
}

export interface RedisStats {
  connected: boolean;
  host: string;
  port: number;
  used_memory: string;
  used_memory_human: string;
  total_keys: number;
  expired_keys: number;
  hit_rate: string;
  connected_clients: number;
  uptime_seconds: number;
  version: string;
}

export interface TableInfo {
  name: string;
  rows: number;
  size: string;
}

export interface DBStats {
  connected: boolean;
  type: string;
  host: string;
  port: number;
  database: string;
  tables: TableInfo[];
  total_size: string;
}

export const systemApi = {
  getSystemInfo: async () => {
    const response = await api.get<{ data: SystemInfo }>('/system/info');
    return response.data.data;
  },

  getRedisStats: async () => {
    const response = await api.get<{ data: RedisStats }>('/system/redis-stats');
    return response.data.data;
  },

  getDBStats: async () => {
    const response = await api.get<{ data: DBStats }>('/system/db-stats');
    return response.data.data;
  },

  testRedisConnection: async (config: { host: string; port: number; username?: string; password: string }) => {
    const response = await api.post<{ success: boolean; error?: string; message?: string; version?: string }>(
      '/system/redis-test',
      config
    );
    return response.data;
  },
};
