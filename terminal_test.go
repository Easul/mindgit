package main

import (
	"os"
	"testing"
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
