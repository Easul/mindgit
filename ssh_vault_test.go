package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncryptedSSHKeyRoundTrip(t *testing.T) {
	config := SSHConfig{DataDir: t.TempDir()}
	vaultKey := bytes.Repeat([]byte{7}, 32)
	privateKey := []byte("-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n")
	if err := writeEncryptedSSHKey(config, "production", privateKey, vaultKey); err != nil {
		t.Fatal(err)
	}
	storedPath := filepath.Join(config.DataDir, "keys", "production.key.enc")
	stored, err := os.ReadFile(storedPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, privateKey) || bytes.Contains(stored, []byte("OPENSSH PRIVATE KEY")) {
		t.Fatal("encrypted key file contains plaintext private key")
	}
	decrypted, err := readEncryptedSSHKey(config, "production", vaultKey)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decrypted, privateKey) {
		t.Fatalf("decrypted key = %q, want %q", decrypted, privateKey)
	}
	if _, err := readEncryptedSSHKey(config, "production", bytes.Repeat([]byte{8}, 32)); err == nil {
		t.Fatal("expected decryption with wrong key to fail")
	}
}

func TestBuildSSHTerminalCommandUsesOnlyRequiredKeys(t *testing.T) {
	dataDir := t.TempDir()
	config := SSHConfig{
		DataDir:    dataDir,
		KnownHosts: filepath.Join(dataDir, "known_hosts"),
		Connections: []SSHConnectionConfig{
			{Name: "bastion", Host: "jump.example.com", User: "jump", RemoteDir: "/tmp", Key: "jump"},
			{Name: "production", Host: "10.0.0.20", User: "deploy", RemoteDir: "/srv/app with space", Key: "production", JumpHosts: []string{"bastion"}},
			{Name: "unused", Host: "unused.example.com", User: "nobody", RemoteDir: "/tmp", Key: "missing"},
		},
	}
	vaultKey := bytes.Repeat([]byte{9}, 32)
	key := []byte("-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n")
	for _, name := range []string{"jump", "production"} {
		if err := writeEncryptedSSHKey(config, name, key, vaultKey); err != nil {
			t.Fatal(err)
		}
	}
	command, cleanup, err := buildSSHTerminalCommand(config, config.Connections[1], vaultKey)
	if err != nil {
		t.Fatal(err)
	}
	configPath := command.Args[2]
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if !strings.Contains(text, "ProxyJump mindgit-1") {
		t.Fatalf("SSH config missing jump host: %s", text)
	}
	if !strings.Contains(text, "ControlMaster auto") || !strings.Contains(text, "ControlPersist 600") || !strings.Contains(text, "ControlPath") {
		t.Fatalf("SSH config missing connection reuse settings: %s", text)
	}
	if strings.Contains(text, "unused.example.com") || strings.Contains(text, "missing.key") {
		t.Fatalf("SSH config included unrelated connection: %s", text)
	}
	if got := command.Args[len(command.Args)-1]; got != `cd -- '/srv/app with space' && exec "${SHELL:-/bin/sh}" -l` {
		t.Fatalf("remote command = %q", got)
	}
	temporaryDir := filepath.Dir(configPath)
	cleanup()
	if _, err := os.Stat(temporaryDir); !os.IsNotExist(err) {
		t.Fatalf("temporary SSH directory still exists: %v", err)
	}
}
