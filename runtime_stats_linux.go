//go:build linux

package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func processCPUTime() (time.Duration, bool) {
	content, err := os.ReadFile("/proc/self/schedstat")
	if err != nil {
		return 0, false
	}
	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0, false
	}
	nanoseconds, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, false
	}
	return time.Duration(nanoseconds), true
}
