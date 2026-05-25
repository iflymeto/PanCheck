package checker

import (
	"PanCheck/internal/model"
	apphttp "PanCheck/pkg/http"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// UCChecker UC网盘检测器
type UCChecker struct {
	*BaseChecker
}

// NewUCChecker 创建UC网盘检测器
func NewUCChecker(concurrencyLimit int, timeout time.Duration) *UCChecker {
	return &UCChecker{
		BaseChecker: NewBaseChecker(model.PlatformUC, concurrencyLimit, timeout),
	}
}

// Check 检测链接是否有效
func (c *UCChecker) Check(link string) (*CheckResult, error) {
	// 应用频率限制
	c.ApplyRateLimit()

	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), c.GetTimeout())
	defer cancel()

	// 提取share_id
	shareID, err := extractShareIDFromURL(link, "uc")
	if err != nil {
		return &CheckResult{
			Valid:         false,
			FailureReason: "链接格式无效: " + err.Error(),
			Duration:      time.Since(start).Milliseconds(),
		}, nil
	}

	parsedURL, _ := url.Parse(link)
	host := ""
	if parsedURL != nil {
		host = parsedURL.Host
	}

	var checkURL string
	if strings.Contains(host, "yun.uc.cn") || strings.Contains(host, "uc.cn") {
		checkURL = fmt.Sprintf("https://drive.uc.cn/s/%s", shareID)
	} else {
		checkURL = fmt.Sprintf("https://drive.uc.cn/s/%s", shareID)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", checkURL, nil)
	if err != nil {
		return &CheckResult{
			Valid:         false,
			FailureReason: "创建请求失败: " + err.Error(),
			Duration:      time.Since(start).Milliseconds(),
		}, nil
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Mobile Safari/537.36")

	httpClient := apphttp.GetClient()
	resp, err := httpClient.Do(req.WithContext(ctx))
	if err != nil {
		if apphttp.IsTimeoutError(err) {
			return &CheckResult{
				Valid:         true, // 超时视为有效，避免误判
				FailureReason: "",
				Duration:      time.Since(start).Milliseconds(),
			}, nil
		}
		// 连接错误也视为有效
		if strings.Contains(err.Error(), "ConnectError") {
			return &CheckResult{
				Valid:         true,
				FailureReason: "",
				Duration:      time.Since(start).Milliseconds(),
			}, nil
		}
		return &CheckResult{
			Valid:         false,
			FailureReason: "请求失败: " + err.Error(),
			Duration:      time.Since(start).Milliseconds(),
		}, nil
	}
	defer apphttp.CloseResponse(resp)

	if resp.StatusCode != http.StatusOK {
		return &CheckResult{
			Valid:         false,
			FailureReason: fmt.Sprintf("HTTP状态码: %d", resp.StatusCode),
			Duration:      time.Since(start).Milliseconds(),
		}, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return &CheckResult{
			Valid:         false,
			FailureReason: "读取响应失败: " + err.Error(),
			Duration:      time.Since(start).Milliseconds(),
		}, nil
	}

	pageText := strings.ToLower(string(body))
	errorKeywords := []string{"失效", "不存在", "违规", "删除", "已过期", "被取消"}
	passwordKeywords := []string{"提取码", "访问码", "请输入密码"}

	for _, keyword := range errorKeywords {
		if strings.Contains(pageText, keyword) {
			return &CheckResult{
				Valid:         false,
				FailureReason: "链接已失效",
				Duration:      time.Since(start).Milliseconds(),
			}, nil
		}
	}

	validKeywords := []string{"文件", "分享"}
	for _, keyword := range validKeywords {
		if strings.Contains(pageText, keyword) {
			return &CheckResult{
				Valid:         true,
				FailureReason: "",
				Duration:      time.Since(start).Milliseconds(),
			}, nil
		}
	}

	for _, keyword := range passwordKeywords {
		if strings.Contains(pageText, keyword) {
			return &CheckResult{
				Valid:               true,
				FailureReason:       "链接需要提取码",
				Duration:            time.Since(start).Milliseconds(),
				IsPasswordProtected: true,
			}, nil
		}
	}

	return &CheckResult{
		Valid:         false,
		FailureReason: "无法判断链接有效性",
		Duration:      time.Since(start).Milliseconds(),
	}, nil
}

// extractShareIDFromURL 从URL中提取share_id
func extractShareIDFromURL(urlStr, platform string) (string, error) {
	var patterns []string
	switch platform {
	case "uc":
		patterns = []string{
			`https?://drive\.uc\.cn/s/([a-zA-Z0-9]+)`,
			`https?://yun\.uc\.cn/s/([a-zA-Z0-9]+)`,
			`https?://uc\.cn/s/([a-zA-Z0-9]+)`,
		}
	default:
		return "", fmt.Errorf("不支持的平台: %s", platform)
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		matches := re.FindStringSubmatch(urlStr)
		if len(matches) >= 2 {
			return matches[1], nil
		}
	}

	return "", fmt.Errorf("无法从URL中提取share_id")
}
