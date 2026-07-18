package main

import (
	"errors"
	"net/http"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
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
	nextProcessID    uint64
	processes        map[string]managedCommand
}

type managedCommand struct {
	id        string
	pid       int
	kind      string
	command   string
	project   string
	startedAt time.Time
	cancel    func()
}

type RuntimeProcess struct {
	ID              string `json:"id"`
	PID             int    `json:"pid"`
	Kind            string `json:"kind"`
	Command         string `json:"command"`
	Project         string `json:"project,omitempty"`
	UptimeSeconds   int64  `json:"uptimeSeconds"`
	MemoryBytes     uint64 `json:"memoryBytes"`
	VirtualBytes    uint64 `json:"virtualBytes,omitempty"`
	MemoryAvailable bool   `json:"memoryAvailable"`
	Closable        bool   `json:"closable"`
}

type RuntimeStats struct {
	UptimeSeconds    int64            `json:"uptimeSeconds"`
	CPUPercent       float64          `json:"cpuPercent"`
	CPUAvailable     bool             `json:"cpuAvailable"`
	MemoryBytes      uint64           `json:"memoryBytes"`
	MemoryAvailable  bool             `json:"memoryAvailable"`
	GoSystemBytes    uint64           `json:"goSystemBytes"`
	HeapBytes        uint64           `json:"heapBytes"`
	HeapSystemBytes  uint64           `json:"heapSystemBytes"`
	StackBytes       uint64           `json:"stackBytes"`
	MetadataBytes    uint64           `json:"metadataBytes"`
	HeapObjects      uint64           `json:"heapObjects"`
	Goroutines       int              `json:"goroutines"`
	GCCount          uint32           `json:"gcCount"`
	LastGCAgoSeconds int64            `json:"lastGCAgoSeconds,omitempty"`
	ActiveCommands   int64            `json:"activeCommands"`
	Commands         int64            `json:"commands"`
	FailedCommands   int64            `json:"failedCommands"`
	AverageCommandMS float64          `json:"averageCommandMs"`
	GitCommands      int64            `json:"gitCommands"`
	SSHCommands      int64            `json:"sshCommands"`
	TerminalSessions int              `json:"terminalSessions"`
	ChildMemoryBytes uint64           `json:"childMemoryBytes"`
	Processes        []RuntimeProcess `json:"processes"`
}

func NewRuntimeMonitor() *RuntimeMonitor {
	return &RuntimeMonitor{started: time.Now(), processes: make(map[string]managedCommand)}
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

func (m *RuntimeMonitor) registerCommand(pid int, kind, command, project string, cancel func()) string {
	if m == nil || pid <= 0 {
		return ""
	}
	m.mu.Lock()
	m.nextProcessID++
	id := "command:" + strconv.FormatUint(m.nextProcessID, 10)
	m.processes[id] = managedCommand{
		id: id, pid: pid, kind: kind, command: command, project: project,
		startedAt: time.Now(), cancel: cancel,
	}
	m.mu.Unlock()
	return id
}

func (m *RuntimeMonitor) unregisterCommand(id string) {
	if m == nil || id == "" {
		return
	}
	m.mu.Lock()
	delete(m.processes, id)
	m.mu.Unlock()
}

func (m *RuntimeMonitor) stopCommand(id string) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	process, ok := m.processes[id]
	m.mu.Unlock()
	if !ok || process.cancel == nil {
		return false
	}
	process.cancel()
	return true
}

func (m *RuntimeMonitor) sample(terminals []TerminalProcess) RuntimeStats {
	now := time.Now()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	cpuTime, cpuAvailable := processCPUTime()
	rss, _, memoryAvailable := processMemory(os.Getpid())

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
	commands := make([]managedCommand, 0, len(m.processes))
	for _, process := range m.processes {
		commands = append(commands, process)
	}
	stats := RuntimeStats{
		UptimeSeconds:    int64(now.Sub(m.started).Seconds()),
		CPUPercent:       cpuPercent,
		CPUAvailable:     cpuAvailable,
		MemoryBytes:      rss,
		MemoryAvailable:  memoryAvailable,
		GoSystemBytes:    memory.Sys,
		HeapBytes:        memory.HeapAlloc,
		HeapSystemBytes:  memory.HeapSys,
		StackBytes:       memory.StackInuse,
		MetadataBytes:    memory.MSpanInuse + memory.MCacheInuse + memory.GCSys + memory.OtherSys,
		HeapObjects:      memory.HeapObjects,
		Goroutines:       runtime.NumGoroutine(),
		GCCount:          memory.NumGC,
		ActiveCommands:   m.activeCommands,
		Commands:         m.commands,
		FailedCommands:   m.failedCommands,
		AverageCommandMS: averageMS,
		GitCommands:      m.gitCommands,
		SSHCommands:      m.sshCommands,
		TerminalSessions: len(terminals),
	}
	m.mu.Unlock()

	stats.Processes = make([]RuntimeProcess, 0, 1+len(commands)+len(terminals))
	stats.Processes = append(stats.Processes, RuntimeProcess{
		ID: "mindgit", PID: os.Getpid(), Kind: "mindgit", Command: "MindGit",
		UptimeSeconds: stats.UptimeSeconds, MemoryBytes: rss, MemoryAvailable: memoryAvailable,
	})
	for _, process := range commands {
		processRSS, virtual, available := processTreeMemory(process.pid)
		stats.ChildMemoryBytes += processRSS
		stats.Processes = append(stats.Processes, RuntimeProcess{
			ID: process.id, PID: process.pid, Kind: process.kind, Command: process.command,
			Project: process.project, UptimeSeconds: int64(now.Sub(process.startedAt).Seconds()),
			MemoryBytes: processRSS, VirtualBytes: virtual, MemoryAvailable: available, Closable: true,
		})
	}
	for _, terminal := range terminals {
		processRSS, virtual, available := processTreeMemory(terminal.PID)
		stats.ChildMemoryBytes += processRSS
		stats.Processes = append(stats.Processes, RuntimeProcess{
			ID: "terminal:" + terminal.ID, PID: terminal.PID, Kind: terminal.Kind,
			Command: terminal.Title, Project: terminal.Project,
			UptimeSeconds: int64(now.Sub(terminal.StartedAt).Seconds()),
			MemoryBytes:   processRSS, VirtualBytes: virtual, MemoryAvailable: available, Closable: true,
		})
	}
	if len(stats.Processes) > 2 {
		sort.Slice(stats.Processes[1:], func(i, j int) bool {
			return stats.Processes[i+1].MemoryBytes > stats.Processes[j+1].MemoryBytes
		})
	}
	if memory.LastGC > 0 {
		stats.LastGCAgoSeconds = int64(now.Sub(time.Unix(0, int64(memory.LastGC))).Seconds())
	}
	return stats
}

func (a App) handleRuntimeStats(w http.ResponseWriter, _ *http.Request) {
	if a.monitor == nil {
		http.Error(w, "monitoring is disabled", http.StatusNotFound)
		return
	}
	writeJSON(w, a.monitor.sample(a.terminals.processes()), nil)
}

func (a App) handleDeleteRuntimeProcess(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" || id == "mindgit" {
		writeJSON(w, nil, errors.New("managed process id is required"))
		return
	}
	closed := false
	if strings.HasPrefix(id, "terminal:") {
		closed = a.terminals.remove(strings.TrimPrefix(id, "terminal:"))
	} else if strings.HasPrefix(id, "command:") && a.monitor != nil {
		closed = a.monitor.stopCommand(id)
	}
	if !closed {
		writeJSON(w, nil, errors.New("managed process not found"))
		return
	}
	writeJSON(w, map[string]bool{"closed": true}, nil)
}
