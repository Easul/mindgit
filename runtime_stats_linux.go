//go:build linux

package main

import (
	"bufio"
	"fmt"
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

func processMemory(pid int) (rss uint64, virtual uint64, available bool) {
	status, available := readProcessStatus(pid)
	return status.rss, status.virtual, available
}

type linuxProcessStatus struct {
	parent  int
	rss     uint64
	virtual uint64
}

func readProcessStatus(pid int) (linuxProcessStatus, bool) {
	var status linuxProcessStatus
	file, err := os.Open(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return status, false
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "PPid":
			parent, err := strconv.Atoi(fields[1])
			if err == nil {
				status.parent = parent
			}
		case "VmRSS":
			status.rss = value * 1024
		case "VmSize":
			status.virtual = value * 1024
		}
	}
	return status, scanner.Err() == nil
}

func processTreeMemory(pid int) (rss uint64, virtual uint64, available bool) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return processMemory(pid)
	}
	statuses := make(map[int]linuxProcessStatus)
	children := make(map[int][]int)
	for _, entry := range entries {
		candidate, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		status, ok := readProcessStatus(candidate)
		if !ok {
			continue
		}
		statuses[candidate] = status
		children[status.parent] = append(children[status.parent], candidate)
	}
	if _, ok := statuses[pid]; !ok {
		return 0, 0, false
	}
	visited := make(map[int]bool)
	var add func(int)
	add = func(current int) {
		if visited[current] {
			return
		}
		visited[current] = true
		status, ok := statuses[current]
		if !ok {
			return
		}
		rss += status.rss
		virtual += status.virtual
		for _, child := range children[current] {
			add(child)
		}
	}
	add(pid)
	return rss, virtual, true
}
