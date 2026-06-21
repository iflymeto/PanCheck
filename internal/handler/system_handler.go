package handler

import (
	"PanCheck/internal/config"
	"PanCheck/pkg/cache"
	"PanCheck/pkg/database"
	"context"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type SystemHandler struct {
	cacheRepo cache.CacheRepository
}

func NewSystemHandler(cacheRepo cache.CacheRepository) *SystemHandler {
	return &SystemHandler{cacheRepo: cacheRepo}
}

type SystemInfo struct {
	OS           string  `json:"os"`
	Arch         string  `json:"arch"`
	GoVersion    string  `json:"go_version"`
	CPUCount     int     `json:"cpu_count"`
	MemoryTotal  uint64  `json:"memory_total"`
	MemoryUsed   uint64  `json:"memory_used"`
	MemoryUsage  float64 `json:"memory_usage"`
	DiskTotal    uint64  `json:"disk_total"`
	DiskUsed     uint64  `json:"disk_used"`
	DiskUsage    float64 `json:"disk_usage"`
	Hostname     string  `json:"hostname"`
	StartTime    string  `json:"start_time"`
	Uptime       string  `json:"uptime"`
	Goroutines   int     `json:"goroutines"`
}

type RedisStats struct {
	Connected      bool   `json:"connected"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	UsedMemory     string `json:"used_memory"`
	UsedMemoryHuman string `json:"used_memory_human"`
	TotalKeys      int64  `json:"total_keys"`
	ExpiredKeys    int64  `json:"expired_keys"`
	HitRate        string `json:"hit_rate"`
	ConnectedClients int64 `json:"connected_clients"`
	UptimeSeconds  int64  `json:"uptime_seconds"`
	Version        string `json:"version"`
}

type DBStats struct {
	Connected  bool        `json:"connected"`
	Type       string      `json:"type"`
	Host       string      `json:"host"`
	Port       int         `json:"port"`
	Database   string      `json:"database"`
	Tables     []TableInfo `json:"tables"`
	TotalSize  string      `json:"total_size"`
}

type TableInfo struct {
	Name string `json:"name"`
	Rows int64  `json:"rows"`
	Size string `json:"size"`
}

var startTime = time.Now()

func (h *SystemHandler) GetSystemInfo(c *gin.Context) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	hostname, _ := os.Hostname()

	info := SystemInfo{
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		GoVersion:   runtime.Version(),
		CPUCount:    runtime.NumCPU(),
		MemoryTotal: m.Sys,
		MemoryUsed:  m.Alloc,
		MemoryUsage: float64(m.Alloc) / float64(m.Sys) * 100,
		Hostname:    hostname,
		StartTime:   startTime.Format("2006-01-02 15:04:05"),
		Uptime:      time.Since(startTime).Truncate(time.Second).String(),
		Goroutines:  runtime.NumGoroutine(),
	}

	// 获取磁盘信息
	info.DiskTotal, info.DiskUsed, info.DiskUsage = getDiskUsage("/")

	c.JSON(http.StatusOK, gin.H{"data": info})
}

func (h *SystemHandler) GetRedisStats(c *gin.Context) {
	stats := RedisStats{
		Host: config.AppConfig.Redis.Host,
		Port: config.AppConfig.Redis.Port,
	}

	if h.cacheRepo == nil || !h.cacheRepo.IsEnabled() {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	// 通过内部 client 获取 Redis INFO
	client := h.getRedisClient()
	if client == nil {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	info, err := client.Info(ctx, "stats", "memory", "server", "clients").Result()
	if err != nil {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	stats.Connected = true
	stats.Version = parseRedisInfo(info, "redis_version")
	stats.UsedMemoryHuman = parseRedisInfo(info, "used_memory_human")
	stats.UsedMemory = parseRedisInfo(info, "used_memory")
	stats.ConnectedClients = parseRedisInfoInt(info, "connected_clients")
	stats.UptimeSeconds = parseRedisInfoInt(info, "uptime_in_seconds")

	// 获取 key 数量
	dbSize, err := client.DBSize(ctx).Result()
	if err == nil {
		stats.TotalKeys = dbSize
	}

	// 获取过期 key 数量
	expiredCmd := client.Do(ctx, "INFO", "keyspace")
	if expiredCmd.Err() == nil {
		val, err := expiredCmd.Result()
		if err == nil {
			if str, ok := val.(string); ok {
				expired := parseRedisInfo(str, "expired_keys")
				if expired != "" {
					fmt.Sscanf(expired, "%d", &stats.ExpiredKeys)
				}
			}
		}
	}

	// 计算命中率
	hits := parseRedisInfoInt(info, "keyspace_hits")
	misses := parseRedisInfoInt(info, "keyspace_misses")
	if hits+misses > 0 {
		stats.HitRate = fmt.Sprintf("%.1f%%", float64(hits)/float64(hits+misses)*100)
	} else {
		stats.HitRate = "N/A"
	}

	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (h *SystemHandler) GetDBStats(c *gin.Context) {
	stats := DBStats{
		Type:     config.AppConfig.Database.Type,
		Host:     config.AppConfig.Database.Host,
		Port:     config.AppConfig.Database.Port,
		Database: config.AppConfig.Database.Database,
	}

	if database.DB == nil {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	sqlDB, err := database.DB.DB()
	if err != nil {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	if err := sqlDB.Ping(); err != nil {
		stats.Connected = false
		c.JSON(http.StatusOK, gin.H{"data": stats})
		return
	}

	stats.Connected = true

	// 查询各表信息
	switch config.AppConfig.Database.Type {
	case "mysql":
		h.getMySQLStats(database.DB, &stats)
	case "postgres":
		h.getPostgresStats(database.DB, &stats)
	}

	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (h *SystemHandler) getMySQLStats(db *gorm.DB, stats *DBStats) {
	sqlDB, err := db.DB()
	if err != nil {
		return
	}

	rows, err := sqlDB.Query(`
		SELECT 
			TABLE_NAME,
			COALESCE(TABLE_ROWS, 0),
			CONCAT(ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2), ' MB')
		FROM information_schema.TABLES 
		WHERE TABLE_SCHEMA = ? 
		ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
	`, config.AppConfig.Database.Database)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name, &t.Rows, &t.Size); err == nil {
			stats.Tables = append(stats.Tables, t)
		}
	}

	// 总大小
	var totalSize string
	sqlDB.QueryRow(`
		SELECT CONCAT(ROUND(SUM(DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2), ' MB') 
		FROM information_schema.TABLES 
		WHERE TABLE_SCHEMA = ?
	`, config.AppConfig.Database.Database).Scan(&totalSize)
	stats.TotalSize = totalSize
}

func (h *SystemHandler) getPostgresStats(db *gorm.DB, stats *DBStats) {
	sqlDB, err := db.DB()
	if err != nil {
		return
	}

	rows, err := sqlDB.Query(`
		SELECT 
			relname,
			COALESCE(n_live_tup, 0),
			pg_size_pretty(pg_total_relation_size(relid))
		FROM pg_stat_user_tables 
		ORDER BY pg_total_relation_size(relid) DESC
	`)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var t TableInfo
		if err := rows.Scan(&t.Name, &t.Rows, &t.Size); err == nil {
			stats.Tables = append(stats.Tables, t)
		}
	}

	var totalSize string
	sqlDB.QueryRow(`SELECT pg_size_pretty(sum(pg_total_relation_size(relid))) FROM pg_stat_user_tables`).Scan(&totalSize)
	stats.TotalSize = totalSize
}

func (h *SystemHandler) TestRedisConnection(c *gin.Context) {
	var req struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	opts := &redis.Options{
		Addr:     fmt.Sprintf("%s:%d", req.Host, req.Port),
		Password: req.Password,
		DB:       0,
	}
	if req.Username != "" {
		opts.Username = req.Username
	}

	client := redis.NewClient(opts)
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 获取版本信息
	info, _ := client.Info(ctx, "server").Result()
	version := parseRedisInfo(info, "redis_version")

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "连接成功",
		"version": version,
	})
}

func (h *SystemHandler) getRedisClient() *redis.Client {
	if h.cacheRepo == nil || !h.cacheRepo.IsEnabled() {
		return nil
	}
	return h.cacheRepo.GetClient()
}

func parseRedisInfo(info, key string) string {
	for _, line := range strings.Split(info, "\r\n") {
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 && parts[0] == key {
			return parts[1]
		}
	}
	return ""
}

func parseRedisInfoInt(info, key string) int64 {
	val := parseRedisInfo(info, key)
	var result int64
	fmt.Sscanf(val, "%d", &result)
	return result
}
