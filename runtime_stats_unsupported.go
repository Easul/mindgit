//go:build !linux

package main

import "time"

func processCPUTime() (time.Duration, bool) {
	return 0, false
}

func processMemory(int) (uint64, uint64, bool) {
	return 0, 0, false
}

func processTreeMemory(pid int) (uint64, uint64, bool) {
	return processMemory(pid)
}
