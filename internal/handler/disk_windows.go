//go:build windows

package handler

func getDiskUsage(path string) (total, used uint64, usage float64) {
	return 0, 0, 0
}
