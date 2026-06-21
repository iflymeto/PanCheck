package handler

import "syscall"

func getDiskUsage(path string) (total, used uint64, usage float64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, 0
	}
	total = stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	used = total - free
	if total > 0 {
		usage = float64(used) / float64(total) * 100
	}
	return
}
