package main

import (
	"net/http"
	"runtime"
	"sync"
	"time"
)

type RuntimeMonitor struct {
	started time.Time

	mu               sync.Mutex
	lastSampleTime   time.Time
	lastCPUTime      time.Duration
	activeCommands   int64
	commands         int64
	failedCommands   int64
	totalCommandTime time.Duration
	gitCommands      int64
	sshCommands      int64
}

type RuntimeStats struct {
	UptimeSeconds    int64   `json:"uptimeSeconds"`
	CPUPercent       float64 `json:"cpuPercent"`
	CPUAvailable     bool    `json:"cpuAvailable"`
	MemoryBytes      uint64  `json:"memoryBytes"`
	HeapBytes        uint64  `json:"heapBytes"`
	HeapObjects      uint64  `json:"heapObjects"`
	Goroutines       int     `json:"goroutines"`
	GCCount          uint32  `json:"gcCount"`
	LastGCAgoSeconds int64   `json:"lastGCAgoSeconds,omitempty"`
	ActiveCommands   int64   `json:"activeCommands"`
	Commands         int64   `json:"commands"`
	FailedCommands   int64   `json:"failedCommands"`
	AverageCommandMS float64 `json:"averageCommandMs"`
	GitCommands      int64   `json:"gitCommands"`
	SSHCommands      int64   `json:"sshCommands"`
	TerminalSessions int     `json:"terminalSessions"`
}

func NewRuntimeMonitor() *RuntimeMonitor {
	return &RuntimeMonitor{started: time.Now()}
}

func (m *RuntimeMonitor) commandStarted() {
	m.mu.Lock()
	m.activeCommands++
	m.mu.Unlock()
}

func (m *RuntimeMonitor) commandFinished(name string, elapsed time.Duration, failed bool) {
	m.mu.Lock()
	m.activeCommands--
	m.commands++
	m.totalCommandTime += elapsed
	if failed {
		m.failedCommands++
	}
	switch name {
	case "git":
		m.gitCommands++
	case "ssh", "ssh-add", "ssh-agent":
		m.sshCommands++
	}
	m.mu.Unlock()
}

func (m *RuntimeMonitor) sample(terminals int) RuntimeStats {
	now := time.Now()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	cpuTime, cpuAvailable := processCPUTime()

	m.mu.Lock()
	cpuPercent := 0.0
	if cpuAvailable && !m.lastSampleTime.IsZero() {
		wallElapsed := now.Sub(m.lastSampleTime)
		cpuElapsed := cpuTime - m.lastCPUTime
		if wallElapsed > 0 && cpuElapsed >= 0 {
			cpuPercent = float64(cpuElapsed) / float64(wallElapsed) * 100
		}
	}
	if cpuAvailable {
		m.lastSampleTime = now
		m.lastCPUTime = cpuTime
	}
	averageMS := 0.0
	if m.commands > 0 {
		averageMS = float64(m.totalCommandTime.Microseconds()) / 1000 / float64(m.commands)
	}
	stats := RuntimeStats{
		UptimeSeconds:    int64(now.Sub(m.started).Seconds()),
		CPUPercent:       cpuPercent,
		CPUAvailable:     cpuAvailable,
		MemoryBytes:      memory.Sys,
		HeapBytes:        memory.HeapAlloc,
		HeapObjects:      memory.HeapObjects,
		Goroutines:       runtime.NumGoroutine(),
		GCCount:          memory.NumGC,
		ActiveCommands:   m.activeCommands,
		Commands:         m.commands,
		FailedCommands:   m.failedCommands,
		AverageCommandMS: averageMS,
		GitCommands:      m.gitCommands,
		SSHCommands:      m.sshCommands,
		TerminalSessions: terminals,
	}
	m.mu.Unlock()
	if memory.LastGC > 0 {
		stats.LastGCAgoSeconds = int64(now.Sub(time.Unix(0, int64(memory.LastGC))).Seconds())
	}
	return stats
}

func (a App) handleRuntimeStats(w http.ResponseWriter, r *http.Request) {
	if a.monitor == nil {
		http.Error(w, "monitoring is disabled", http.StatusNotFound)
		return
	}
	writeJSON(w, a.monitor.sample(len(a.terminals.summaries())), nil)
}
