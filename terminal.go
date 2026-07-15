package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

const terminalBufferLimit = 1024 * 1024

type TerminalManager struct {
	mu       sync.Mutex
	sessions map[string]*TerminalSession
	next     int
}

type TerminalSession struct {
	id         string
	title      string
	projectKey string
	project    string
	root       string
	master     *os.File
	command    *exec.Cmd

	mu          sync.Mutex
	buffer      []byte
	connections map[*webSocketConn]struct{}
	closed      bool
	exitMessage string
}

type TerminalSummary struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	ProjectKey string `json:"projectKey"`
	Project    string `json:"project"`
	Closed     bool   `json:"closed"`
}

type terminalClientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

type terminalServerMessage struct {
	Type       string `json:"type"`
	ID         string `json:"id,omitempty"`
	Title      string `json:"title,omitempty"`
	ProjectKey string `json:"projectKey,omitempty"`
	Project    string `json:"project,omitempty"`
	Message    string `json:"message,omitempty"`
}

func NewTerminalManager() *TerminalManager {
	return &TerminalManager{sessions: make(map[string]*TerminalSession)}
}

func (a App) handleTerminals(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, a.terminals.summaries(), nil)
}

func (a App) handleDeleteTerminal(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeJSON(w, nil, errors.New("terminal id is required"))
		return
	}
	if !a.terminals.remove(id) {
		writeJSON(w, nil, errors.New("terminal not found"))
		return
	}
	writeJSON(w, map[string]bool{"deleted": true}, nil)
}

func (a App) handleTerminal(w http.ResponseWriter, r *http.Request) {
	if !isWebSocketUpgrade(r) {
		http.Error(w, "websocket upgrade required", http.StatusUpgradeRequired)
		return
	}
	if !sameOrigin(r) {
		http.Error(w, "websocket origin rejected", http.StatusForbidden)
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	var session *TerminalSession
	var err error
	if id != "" {
		session = a.terminals.get(id)
		if session == nil {
			http.Error(w, "terminal not found", http.StatusNotFound)
			return
		}
	} else {
		app, appErr := a.appForRequest(r)
		if appErr != nil {
			http.Error(w, appErr.Error(), http.StatusBadRequest)
			return
		}
		session, err = a.terminals.create(app.currentProject())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	connection, err := upgradeWebSocket(w, r)
	if err != nil {
		if id == "" {
			a.terminals.remove(session.id)
		}
		return
	}
	session.serve(connection)
}

func (m *TerminalManager) create(project ProjectSummary) (*TerminalSession, error) {
	master, command, err := startPTY(project.Root)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.next++
	session := &TerminalSession{
		id:          randomTerminalID(),
		title:       fmt.Sprintf("Terminal %d", m.next),
		projectKey:  project.Key,
		project:     project.Name,
		root:        project.Root,
		master:      master,
		command:     command,
		connections: make(map[*webSocketConn]struct{}),
	}
	m.sessions[session.id] = session
	m.mu.Unlock()

	go session.readOutput()
	go session.wait()
	return session, nil
}

func (m *TerminalManager) get(id string) *TerminalSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *TerminalManager) summaries() []TerminalSummary {
	m.mu.Lock()
	sessions := make([]*TerminalSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.mu.Unlock()

	summaries := make([]TerminalSummary, 0, len(sessions))
	for _, session := range sessions {
		session.mu.Lock()
		summaries = append(summaries, TerminalSummary{
			ID:         session.id,
			Title:      session.title,
			ProjectKey: session.projectKey,
			Project:    session.project,
			Closed:     session.closed,
		})
		session.mu.Unlock()
	}
	return summaries
}

func (m *TerminalManager) remove(id string) bool {
	m.mu.Lock()
	session, ok := m.sessions[id]
	if ok {
		delete(m.sessions, id)
	}
	m.mu.Unlock()
	if ok {
		session.close()
	}
	return ok
}

func (s *TerminalSession) serve(connection *webSocketConn) {
	s.attach(connection)
	defer s.detach(connection)
	defer connection.close()

	for {
		opcode, payload, err := connection.readFrame()
		if err != nil {
			return
		}
		switch opcode {
		case 0x1:
			var message terminalClientMessage
			if json.Unmarshal(payload, &message) != nil {
				continue
			}
			switch message.Type {
			case "input":
				s.mu.Lock()
				closed := s.closed
				s.mu.Unlock()
				if !closed {
					_, _ = io.WriteString(s.master, message.Data)
				}
			case "resize":
				if message.Cols > 0 && message.Rows > 0 {
					_ = resizePTY(s.master, message.Cols, message.Rows)
				}
			}
		case 0x8:
			return
		case 0x9:
			_ = connection.writeFrame(0xA, payload)
		}
	}
}

func (s *TerminalSession) attach(connection *webSocketConn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = connection.writeJSON(terminalServerMessage{
		Type:       "ready",
		ID:         s.id,
		Title:      s.title,
		ProjectKey: s.projectKey,
		Project:    s.project,
	})
	if len(s.buffer) > 0 {
		_ = connection.writeFrame(0x2, s.buffer)
	}
	if s.closed {
		_ = connection.writeJSON(terminalServerMessage{Type: "exit", Message: s.exitMessage})
	}
	s.connections[connection] = struct{}{}
}

func (s *TerminalSession) detach(connection *webSocketConn) {
	s.mu.Lock()
	delete(s.connections, connection)
	s.mu.Unlock()
}

func (s *TerminalSession) readOutput() {
	buffer := make([]byte, 32*1024)
	for {
		count, err := s.master.Read(buffer)
		if count > 0 {
			s.broadcast(buffer[:count])
		}
		if err != nil {
			return
		}
	}
}

func (s *TerminalSession) broadcast(output []byte) {
	chunk := append([]byte(nil), output...)
	s.mu.Lock()
	s.buffer = append(s.buffer, chunk...)
	if len(s.buffer) > terminalBufferLimit {
		s.buffer = append([]byte(nil), s.buffer[len(s.buffer)-terminalBufferLimit:]...)
	}
	connections := make([]*webSocketConn, 0, len(s.connections))
	for connection := range s.connections {
		connections = append(connections, connection)
	}
	s.mu.Unlock()
	for _, connection := range connections {
		_ = connection.writeFrame(0x2, chunk)
	}
}

func (s *TerminalSession) wait() {
	err := s.command.Wait()
	message := "Process exited"
	if err != nil {
		message = err.Error()
	}
	s.mu.Lock()
	s.closed = true
	s.exitMessage = message
	connections := make([]*webSocketConn, 0, len(s.connections))
	for connection := range s.connections {
		connections = append(connections, connection)
	}
	s.mu.Unlock()
	for _, connection := range connections {
		_ = connection.writeJSON(terminalServerMessage{Type: "exit", Message: message})
	}
}

func (s *TerminalSession) close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = s.master.Close()
		return
	}
	s.closed = true
	connections := make([]*webSocketConn, 0, len(s.connections))
	for connection := range s.connections {
		connections = append(connections, connection)
	}
	s.mu.Unlock()
	terminatePTY(s.command)
	_ = s.master.Close()
	for _, connection := range connections {
		connection.close()
	}
}

func randomTerminalID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return strconv.FormatInt(int64(os.Getpid()), 16) + strconv.FormatInt(int64(os.Getuid()), 16)
	}
	return hex.EncodeToString(value)
}

func terminalShell() string {
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell != "" && filepath.IsAbs(shell) {
		if info, err := os.Stat(shell); err == nil && !info.IsDir() {
			return shell
		}
	}
	return "/bin/sh"
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && strings.EqualFold(parsed.Host, r.Host)
}

type webSocketConn struct {
	connection net.Conn
	reader     *bufio.Reader
	writeMu    sync.Mutex
	closeOnce  sync.Once
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (*webSocketConn, error) {
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" || r.Header.Get("Sec-WebSocket-Version") != "13" {
		http.Error(w, "invalid websocket handshake", http.StatusBadRequest)
		return nil, errors.New("invalid websocket handshake")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket unsupported", http.StatusInternalServerError)
		return nil, errors.New("http hijacking unsupported")
	}
	connection, buffered, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accept := base64.StdEncoding.EncodeToString(digest[:])
	_, err = fmt.Fprintf(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
	if err == nil {
		err = buffered.Flush()
	}
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	return &webSocketConn{connection: connection, reader: buffered.Reader}, nil
}

func (c *webSocketConn) readFrame() (byte, []byte, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(c.reader, header); err != nil {
		return 0, nil, err
	}
	if header[0]&0x80 == 0 {
		return 0, nil, errors.New("fragmented websocket frames are unsupported")
	}
	opcode := header[0] & 0x0f
	masked := header[1]&0x80 != 0
	length := uint64(header[1] & 0x7f)
	if length == 126 {
		value := make([]byte, 2)
		if _, err := io.ReadFull(c.reader, value); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(value))
	} else if length == 127 {
		value := make([]byte, 8)
		if _, err := io.ReadFull(c.reader, value); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(value)
	}
	if length > 1024*1024 {
		return 0, nil, errors.New("websocket frame too large")
	}
	mask := make([]byte, 4)
	if masked {
		if _, err := io.ReadFull(c.reader, mask); err != nil {
			return 0, nil, err
		}
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for index := range payload {
			payload[index] ^= mask[index%4]
		}
	}
	return opcode, payload, nil
}

func (c *webSocketConn) writeJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.writeFrame(0x1, payload)
}

func (c *webSocketConn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	header := []byte{0x80 | opcode}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 65535:
		header = append(header, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		header = append(header, 127, 0, 0, 0, 0, byte(len(payload)>>24), byte(len(payload)>>16), byte(len(payload)>>8), byte(len(payload)))
	}
	if _, err := c.connection.Write(header); err != nil {
		return err
	}
	_, err := c.connection.Write(payload)
	return err
}

func (c *webSocketConn) close() {
	c.closeOnce.Do(func() {
		_ = c.connection.Close()
	})
}
