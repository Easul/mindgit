//go:build !linux

package main

import "time"

func processCPUTime() (time.Duration, bool) {
	return 0, false
}
