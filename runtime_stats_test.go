package main

import (
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestRuntimeMonitorTracksAndStopsManagedCommand(t *testing.T) {
	monitor := NewRuntimeMonitor()
	stopped := make(chan struct{}, 1)
	id := monitor.registerCommand(os.Getpid(), "git", "git status", "/tmp/project", func() {
		stopped <- struct{}{}
	})
	if id == "" {
		t.Fatal("managed command id was empty")
	}

	stats := monitor.sample(nil)
	if len(stats.Processes) != 2 {
		t.Fatalf("process count = %d, want 2", len(stats.Processes))
	}
	process := stats.Processes[1]
	if process.ID != id || process.Kind != "git" || process.Command != "git status" || !process.Closable {
		t.Fatalf("unexpected managed process: %#v", process)
	}
	if !monitor.stopCommand(id) {
		t.Fatal("registered command was not stopped")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("registered cancel function was not called")
	}
	monitor.unregisterCommand(id)
	if monitor.stopCommand(id) {
		t.Fatal("unregistered command remained stoppable")
	}
}

func TestRuntimeProcessEndpointRejectsMainProcess(t *testing.T) {
	app := App{monitor: NewRuntimeMonitor(), terminals: NewTerminalManager()}
	request := httptest.NewRequest("DELETE", "/api/runtime/process?id=mindgit", nil)
	recorder := httptest.NewRecorder()
	app.handleDeleteRuntimeProcess(recorder, request)
	if recorder.Code != 400 {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
}

func TestProcessMemoryCanReadCurrentProcess(t *testing.T) {
	rss, _, available := processMemory(os.Getpid())
	if available && rss == 0 {
		t.Fatal("process memory was available but RSS was zero")
	}
}
