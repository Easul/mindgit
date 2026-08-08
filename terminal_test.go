package main

import (
	"os"
	"testing"
	"time"
)

func TestTerminalManagerCloseAllCleansSessions(t *testing.T) {
	master, peer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()

	cleaned := false
	session := &TerminalSession{
		id:          "test",
		master:      master,
		closed:      true,
		cleanup:     func() { cleaned = true },
		connections: make(map[*webSocketConn]struct{}),
	}
	manager := NewTerminalManager()
	manager.sessions[session.id] = session
	manager.next = 3

	manager.closeAll()
	if !cleaned {
		t.Fatal("terminal cleanup was not called")
	}
	if len(manager.sessions) != 0 || manager.next != 0 {
		t.Fatalf("terminal manager was not reset: sessions=%d next=%d", len(manager.sessions), manager.next)
	}
}

func TestTerminalManagerReusableSelectsLatestMatchingOpenSession(t *testing.T) {
	manager := NewTerminalManager()
	older := &TerminalSession{
		id: "older", projectKey: "project", startedAt: time.Now().Add(-time.Minute),
		connections: make(map[*webSocketConn]struct{}),
	}
	newer := &TerminalSession{
		id: "newer", projectKey: "project", startedAt: time.Now(),
		connections: make(map[*webSocketConn]struct{}),
	}
	closed := &TerminalSession{
		id: "closed", projectKey: "project", startedAt: time.Now().Add(time.Minute), closed: true,
		connections: make(map[*webSocketConn]struct{}),
	}
	other := &TerminalSession{
		id: "other", projectKey: "other", startedAt: time.Now().Add(2 * time.Minute),
		connections: make(map[*webSocketConn]struct{}),
	}
	manager.sessions = map[string]*TerminalSession{
		older.id: older, newer.id: newer, closed.id: closed, other.id: other,
	}

	if got := manager.reusable("project", ""); got != newer {
		t.Fatalf("reusable session = %v, want %v", got, newer)
	}
	if got := manager.reusable("missing", ""); got != nil {
		t.Fatalf("reusable missing session = %v, want nil", got)
	}
}
