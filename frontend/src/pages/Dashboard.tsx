import { useState, useEffect, useRef } from 'react';
import { statisticsApi, type StatisticsOverview, type PlatformInvalidCount, type TimeSeriesData } from '@/api/statisticsApi';
import { systemApi, type SystemInfo, type RedisStats, type DBStats } from '@/api/systemApi';
import { PLATFORM_NAMES } from '@/utils/constants';
import { TimeRangeSelector, type TimeRange } from '@/components/TimeRangeSelector';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { linkApi } from '@/api/linkApi';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface RateLimitedLink {
  id: number;
  link: string;
  platform: string;
  failure_reason: string;
  check_duration?: number;
  is_rate_limited: boolean;
  submission_id?: number;
  created_at: string;
}

const BAR_COLORS = ['#ef6b4a', '#14b8a6', '#264653', '#f59e0b', '#22c55e', '#8b5cf6', '#2563eb', '#ec4899', '#06b6d4'];

export function Dashboard() {
  const [overview, setOverview] = useState<StatisticsOverview | null>(null);
  const [platformCounts, setPlatformCounts] = useState<PlatformInvalidCount[]>([]);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeSeriesLoading, setTimeSeriesLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('last7d');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [redisStats, setRedisStats] = useState<RedisStats | null>(null);
  const [dbStats, setDbStats] = useState<DBStats | null>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const lineChartRef = useRef<HTMLDivElement>(null);

  const [rateLimitedDialogOpen, setRateLimitedDialogOpen] = useState(false);
  const [rateLimitedLinks, setRateLimitedLinks] = useState<RateLimitedLink[]>([]);
  const [rateLimitedLoading, setRateLimitedLoading] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [rateLimitedPage, setRateLimitedPage] = useState(1);
  const [rateLimitedTotal, setRateLimitedTotal] = useState(0);
  const pageSize = 20;

  const getDateRange = (range: TimeRange): { start?: string; end?: string; granularity: 'hour' | 'day' } => {
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start: string;
    let granularity: 'hour' | 'day' = 'day';

    switch (range) {
      case 'today': start = end; granularity = 'hour'; break;
      case 'last24h': {
        const d = new Date(today); d.setDate(d.getDate() - 1);
        start = d.toISOString().split('T')[0]; granularity = 'hour'; break;
      }
      case 'thisWeek': {
        const d = new Date(today);
        const dow = today.getDay();
        d.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        start = d.toISOString().split('T')[0]; break;
      }
      case 'last7d': {
        const d = new Date(today); d.setDate(d.getDate() - 7);
        start = d.toISOString().split('T')[0]; break;
      }
      case 'thisMonth': {
        const d = new Date(today.getFullYear(), today.getMonth(), 1);
        start = d.toISOString().split('T')[0]; break;
      }
      case 'last30d': {
        const d = new Date(today); d.setDate(d.getDate() - 30);
        start = d.toISOString().split('T')[0]; break;
      }
      case 'last90d': {
        const d = new Date(today); d.setDate(d.getDate() - 90);
        start = d.toISOString().split('T')[0]; break;
      }
      default: start = end;
    }
    return { start, end, granularity };
  };

  const loadOverviewData = async () => {
    setLoading(true);
    try {
      const [overviewData, platformData] = await Promise.all([
        statisticsApi.getOverview(),
        statisticsApi.getPlatformInvalidCounts(),
      ]);
      setOverview(overviewData);
      setPlatformCounts(platformData.filter(p => p.count > 0));
    } catch (error: any) {
      toast.error('加载统计数据失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const [sysInfo, redis, db] = await Promise.all([
        systemApi.getSystemInfo(),
        systemApi.getRedisStats(),
        systemApi.getDBStats(),
      ]);
      setSystemInfo(sysInfo);
      setRedisStats(redis);
      setDbStats(db);
    } catch (error: any) {
      console.error('加载系统信息失败:', error);
    }
  };

  const loadTimeSeriesData = async () => {
    setTimeSeriesLoading(true);
    try {
      const dateRange = getDateRange(timeRange);
      const timeSeries = await statisticsApi.getSubmissionTimeSeries(
        dateRange.start, dateRange.end, dateRange.granularity
      );
      setTimeSeriesData(timeSeries);
    } catch (error: any) {
      toast.error('加载时间序列数据失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setTimeSeriesLoading(false);
    }
  };

  useEffect(() => { loadOverviewData(); loadSystemInfo(); }, []);
  useEffect(() => { loadTimeSeriesData(); }, [timeRange]);

  const loadRateLimitedLinks = async () => {
    setRateLimitedLoading(true);
    try {
      const result = await linkApi.listRateLimitedLinks(
        rateLimitedPage, pageSize, selectedPlatform === 'all' ? undefined : selectedPlatform
      );
      setRateLimitedLinks(result.data);
      setRateLimitedTotal(result.total);
    } catch (error: any) {
      toast.error('加载受限链接失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setRateLimitedLoading(false);
    }
  };

  useEffect(() => {
    if (rateLimitedDialogOpen) loadRateLimitedLinks();
  }, [rateLimitedDialogOpen, rateLimitedPage, selectedPlatform]);

  const handleClearRateLimitedLinks = async () => {
    if (!confirm('确定要清空所有受限链接吗？')) return;
    try {
      await linkApi.clearRateLimitedLinks();
      toast.success('已清空所有受限链接');
      await loadRateLimitedLinks();
      await loadOverviewData();
    } catch (error: any) {
      toast.error('清空受限链接失败: ' + (error.response?.data?.error || error.message));
    }
  };

  useEffect(() => { if (rateLimitedDialogOpen) setRateLimitedPage(1); }, [selectedPlatform, rateLimitedDialogOpen]);

  const maxPlatformCount = Math.max(...platformCounts.map(p => p.count), 1);

  const formatTimeLabel = (dateStr: string, range: TimeRange): string => {
    try {
      let date: Date;
      if (dateStr.includes('T')) date = new Date(dateStr);
      else if (dateStr.includes(' ')) date = new Date(dateStr.replace(' ', 'T') + '+08:00');
      else date = new Date(dateStr + 'T00:00:00+08:00');
      if (range === 'today' || range === 'last24h') {
        return date.getHours().toString().padStart(2, '0') + ':00';
      }
      return (date.getMonth() + 1).toString().padStart(2, '0') + '-' + date.getDate().toString().padStart(2, '0');
    } catch { return dateStr; }
  };

  const linePoints = timeSeriesData.map((item, i, arr) => {
    const x = arr.length > 1 ? (i / (arr.length - 1)) * 740 + 30 : 400;
    const maxVal = Math.max(...arr.map(d => d.count), 1);
    const y = 260 - (item.count / maxVal) * 220;
    return { x, y, count: item.count, label: formatTimeLabel(item.date, timeRange) };
  });

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 32px 40px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>系统仪表盘</h1>
          <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 14 }}>
            查看链接检测、提交记录、系统资源和服务连接状态
          </p>
        </div>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
        {[
          { label: '总失效链接数', value: overview?.total_invalid_links ?? 0, color: 'orange', badge: '需关注', badgeColor: '#f97316' },
          { label: '总提交记录数', value: overview?.total_submissions ?? 0, color: 'blue', badge: '稳定', badgeColor: '#2563eb' },
          { label: '已完成检测', value: overview?.completed_submissions ?? 0, color: 'green', badge: '100%', badgeColor: '#16a34a' },
          { label: '受限检测链接数', value: overview?.rate_limited_links ?? 0, color: 'purple', badge: '需处理', badgeColor: '#7c3aed', onClick: () => setRateLimitedDialogOpen(true) },
        ].map((kpi, i) => (
          <div
            key={i}
            onClick={kpi.onClick}
            style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18,
              padding: 20, position: 'relative', overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
              cursor: kpi.onClick ? 'pointer' : 'default',
            }}
          >
            <div style={{
              position: 'absolute', right: -30, top: -30, width: 110, height: 110, borderRadius: '50%',
              background: kpi.color === 'orange' ? 'rgba(249,115,22,0.1)' : kpi.color === 'green' ? 'rgba(22,163,74,0.1)' : kpi.color === 'purple' ? 'rgba(124,58,237,0.1)' : 'rgba(37,99,235,0.08)',
            }} />
            <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>{kpi.label}</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>
              {loading ? '...' : kpi.value.toLocaleString()}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px',
                fontSize: 12, fontWeight: 600, color: kpi.badgeColor,
                background: kpi.badgeColor + '18',
              }}>{kpi.badge}</span>
              {kpi.label === '受限检测链接数' ? '被限制的链接数' : kpi.label === '总失效链接数' ? '累计失效链接总数' : kpi.label === '总提交记录数' ? '所有提交记录总数' : '已完成检测记录数'}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.75fr', gap: 18, marginBottom: 18 }}>
        {/* Line Chart */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 20, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>提交记录趋势</h2>
              <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>按时间统计提交记录数量</p>
            </div>
          </div>
          <div
            ref={lineChartRef}
            style={{
              width: '100%', height: 300, borderRadius: 12, overflow: 'visible', position: 'relative',
              background: 'linear-gradient(to bottom, transparent 24%, #eef0f4 25%, transparent 26%), linear-gradient(to bottom, transparent 49%, #eef0f4 50%, transparent 51%), linear-gradient(to bottom, transparent 74%, #eef0f4 75%, transparent 76%)',
            }}
          >
            {timeSeriesLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>加载中...</div>
            ) : linePoints.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>暂无数据</div>
            ) : (
              <svg viewBox="0 0 800 300" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                <polyline points={linePoints.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ef6b4a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {linePoints.map((p, i) => (
                  <g key={i} onMouseEnter={() => setHoveredPoint(i)} onMouseLeave={() => setHoveredPoint(null)} style={{ cursor: 'pointer' }}>
                    <circle cx={p.x} cy={p.y} r={hoveredPoint === i ? 8 : 5} fill="#ef6b4a" stroke="white" strokeWidth="2" style={{ transition: 'r 0.15s' }} />
                    {hoveredPoint === i && (
                      <g>
                        <rect x={p.x - 40} y={p.y - 38} width="80" height="26" rx="6" fill="#111827" />
                        <text x={p.x} y={p.y - 21} textAnchor="middle" fill="white" fontSize="12" fontWeight="600">{p.count.toLocaleString()} 条</text>
                        <text x={p.x} y={p.y - 46} textAnchor="middle" fill="#6b7280" fontSize="11">{p.label}</text>
                      </g>
                    )}
                  </g>
                ))}
                {linePoints.filter((_, i) => {
                  const step = Math.max(1, Math.floor(linePoints.length / 7));
                  return i % step === 0 || i === linePoints.length - 1;
                }).map((p, i) => (
                  <text key={i} x={p.x} y={285} textAnchor="middle" fill="#6b7280" fontSize="12">{p.label}</text>
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Bar Chart */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 20, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>各大网盘失效记录数</h2>
            <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>按平台统计失效链接分布</p>
          </div>
          <div style={{
            height: 300, display: 'flex', alignItems: 'flex-end', gap: 14, paddingTop: 30, borderRadius: 12, position: 'relative',
            background: 'linear-gradient(to bottom, transparent 24%, #eef0f4 25%, transparent 26%), linear-gradient(to bottom, transparent 49%, #eef0f4 50%, transparent 51%), linear-gradient(to bottom, transparent 74%, #eef0f4 75%, transparent 76%)',
          }}>
            {loading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>加载中...</div>
            ) : platformCounts.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>暂无数据</div>
            ) : platformCounts.map((item, i) => {
              const barHeight = Math.max((item.count / maxPlatformCount) * 220, 4);
              return (
                <div
                  key={item.platform}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' }}
                  onMouseEnter={() => setHoveredBar(i)}
                  onMouseLeave={() => setHoveredBar(null)}
                >
                  {/* Tooltip */}
                  {hoveredBar === i && (
                    <div style={{
                      position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                      background: '#111827', color: 'white', padding: '6px 12px', borderRadius: 8,
                      fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 10,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}>
                      {item.count.toLocaleString()} 条
                      <div style={{
                        position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)',
                        width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
                        borderTop: '5px solid #111827',
                      }} />
                    </div>
                  )}
                  {/* Value label on top */}
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', textAlign: 'center' }}>
                    {item.count.toLocaleString()}
                  </div>
                  {/* Bar */}
                  <div style={{
                    width: '100%', maxWidth: 42, borderRadius: '10px 10px 4px 4px',
                    height: `${barHeight}px`,
                    background: BAR_COLORS[i % BAR_COLORS.length],
                    transition: 'height 0.3s, opacity 0.15s',
                    opacity: hoveredBar === i ? 0.85 : 1,
                    cursor: 'pointer',
                  }} />
                  <div style={{ width: '100%', textAlign: 'center', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {PLATFORM_NAMES[item.platform] || item.platform}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        {/* Server */}
        <StatusCard title="服务器状态" subtitle="基础运行信息" badge="正常" badgeColor="#16a34a" loading={loading}>
          {systemInfo && (
            <>
              <InfoRow label="主机名" value={systemInfo.hostname} />
              <InfoRow label="系统" value={`${systemInfo.os}/${systemInfo.arch}`} />
              <InfoRow label="运行时间" value={systemInfo.uptime} />
              <InfoRow label="Go 版本" value={systemInfo.go_version} />
              <InfoRow label="Goroutines" value={String(systemInfo.goroutines)} />
            </>
          )}
        </StatusCard>

        {/* CPU & Memory */}
        <StatusCard title="CPU & 内存" subtitle="资源使用情况">
          {systemInfo && (
            <>
              <InfoRow label="CPU 核心数" value={String(systemInfo.cpu_count)} />
              <div>
                <InfoRow label="内存使用率" value={`${systemInfo.memory_usage.toFixed(1)}%`} />
                <ProgressBar percent={systemInfo.memory_usage} color="#2563eb" />
              </div>
              <InfoRow label="已用内存" value={`${formatBytes(systemInfo.memory_used)} / ${formatBytes(systemInfo.memory_total)}`} />
            </>
          )}
        </StatusCard>

        {/* Disk */}
        <StatusCard title="磁盘使用" subtitle="当前磁盘容量">
          {systemInfo && systemInfo.disk_total > 0 ? (
            <>
              <div>
                <InfoRow label="磁盘使用率" value={`${systemInfo.disk_usage.toFixed(1)}%`} />
                <ProgressBar percent={systemInfo.disk_usage} color="#f97316" />
              </div>
              <InfoRow label="已使用" value={formatBytes(systemInfo.disk_used)} />
              <InfoRow label="总容量" value={formatBytes(systemInfo.disk_total)} />
            </>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>磁盘信息不可用</div>
          )}
        </StatusCard>

        {/* Redis */}
        <StatusCard title="Redis 缓存" subtitle="缓存服务状态" badge={redisStats?.connected ? '已连接' : '未连接'} badgeColor={redisStats?.connected ? '#16a34a' : '#ef4444'}>
          {redisStats?.connected ? (
            <>
              <InfoRow label="版本" value={redisStats.version} />
              <InfoRow label="Key 总数" value={redisStats.total_keys.toLocaleString()} />
              <InfoRow label="内存占用" value={redisStats.used_memory_human} />
              <InfoRow label="命中率" value={redisStats.hit_rate} />
              <InfoRow label="连接数" value={String(redisStats.connected_clients)} />
            </>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{redisStats === null ? '加载中...' : '未连接'}</div>
          )}
        </StatusCard>

        {/* Database */}
        <StatusCard title="数据库" subtitle={`${dbStats?.type?.toUpperCase() || 'MySQL'} 连接状态`} badge={dbStats?.connected ? '已连接' : '未连接'} badgeColor={dbStats?.connected ? '#16a34a' : '#ef4444'}>
          {dbStats?.connected ? (
            <>
              <InfoRow label="类型" value={dbStats.type.toUpperCase()} />
              <InfoRow label="总大小" value={dbStats.total_size || 'N/A'} />
              <InfoRow label="表数量" value={String(dbStats.tables?.length || 0)} />
            </>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 14 }}>{dbStats === null ? '加载中...' : '未连接'}</div>
          )}
        </StatusCard>

        {/* Tasks */}
        <StatusCard title="检测任务" subtitle="任务运行概览" badge="运行中" badgeColor="#f97316">
          <InfoRow label="待检测记录" value={String(overview?.pending_submissions ?? 0)} />
          <InfoRow label="定时任务数" value={String(overview?.total_scheduled_tasks ?? 0)} />
          <InfoRow label="总检测数" value={String(overview?.completed_submissions ?? 0)} />
        </StatusCard>
      </div>

      {/* Footer */}
      <div style={{ color: '#6b7280', fontSize: 13, display: 'flex', justifyContent: 'center', gap: 12, padding: '28px 0 8px' }}>
        <span>PanCheck v1.0</span>
        <span>|</span>
        <a href="https://github.com/Lampon/PanCheck" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', textDecoration: 'none' }}>GitHub</a>
      </div>

      {/* Rate Limited Dialog */}
      <Dialog open={rateLimitedDialogOpen} onOpenChange={setRateLimitedDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>受限检测链接明细</DialogTitle>
            <DialogDescription>显示所有可能被限制导致检测无效的链接</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">平台筛选：</span>
              <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="选择平台" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部平台</SelectItem>
                  {Object.entries(PLATFORM_NAMES).map(([key, name]) => (
                    <SelectItem key={key} value={key}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="destructive" onClick={handleClearRateLimitedLinks} disabled={rateLimitedLoading || rateLimitedTotal === 0}>
              清空所有
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            {rateLimitedLoading ? (
              <div className="flex items-center justify-center h-[300px]">加载中...</div>
            ) : rateLimitedLinks.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">暂无数据</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">平台</TableHead>
                    <TableHead className="min-w-[400px]">链接</TableHead>
                    <TableHead className="min-w-[200px]">失败原因</TableHead>
                    <TableHead className="w-[120px]">检测耗时</TableHead>
                    <TableHead className="w-[180px]">创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rateLimitedLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell>{PLATFORM_NAMES[link.platform] || link.platform}</TableCell>
                      <TableCell className="max-w-[500px] break-all">
                        <a href={link.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{link.link}</a>
                      </TableCell>
                      <TableCell className="max-w-[300px] break-words">{link.failure_reason || '-'}</TableCell>
                      <TableCell>{link.check_duration ? `${link.check_duration}ms` : '-'}</TableCell>
                      <TableCell>{new Date(link.created_at).toLocaleString('zh-CN')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">共 {rateLimitedTotal} 条记录</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRateLimitedPage(p => Math.max(1, p - 1))} disabled={rateLimitedPage === 1 || rateLimitedLoading}>上一页</Button>
              <span className="text-sm">第 {rateLimitedPage} / {Math.ceil(rateLimitedTotal / pageSize)} 页</span>
              <Button variant="outline" size="sm" onClick={() => setRateLimitedPage(p => p + 1)} disabled={rateLimitedPage >= Math.ceil(rateLimitedTotal / pageSize) || rateLimitedLoading}>下一页</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusCard({ title, subtitle, badge, badgeColor, loading, children }: {
  title: string; subtitle: string; badge?: string; badgeColor?: string; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18, padding: 20, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>{subtitle}</p>
        </div>
        {badge && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px',
            fontSize: 12, fontWeight: 600, color: badgeColor || '#16a34a',
            background: (badgeColor || '#16a34a') + '18',
          }}>{badge}</span>
        )}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? <div style={{ color: '#6b7280', fontSize: 14 }}>加载中...</div> : children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <strong style={{ fontWeight: 600, textAlign: 'right' as const }}>{value}</strong>
    </div>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div style={{ height: 9, background: '#eef0f4', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
      <div style={{ height: '100%', width: `${Math.min(percent, 100)}%`, background: color, borderRadius: 'inherit', transition: 'width 0.3s' }} />
    </div>
  );
}
