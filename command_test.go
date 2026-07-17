package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSSHMultiplexFailureDetection(t *testing.T) {
	for _, message := range []string{
		"mux_client_request_session: read from master failed: Broken pipe",
		"Failed to connect to new control master",
	} {
		if !isSSHMultiplexFailure(message) {
			t.Fatalf("message was not detected: %s", message)
		}
	}
	if isSSHMultiplexFailure("remote command returned broken pipe") {
		t.Fatal("ordinary remote error was treated as a mux failure")
	}
}

func TestRemoteCommandRetriesWithoutMultiplexing(t *testing.T) {
	bin := t.TempDir()
	sshPath := filepath.Join(bin, "ssh")
	logPath := filepath.Join(t.TempDir(), "calls.log")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$SSH_RETRY_LOG"
case " $* " in
  *" ControlMaster=no "*) ;;
  *) echo 'mux_client_request_session: read from master failed: Broken pipe' >&2; exit 255 ;;
esac
last=
for argument do last=$argument; done
exec sh -c "$last"
`
	if err := os.WriteFile(sshPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("SSH_RETRY_LOG", logPath)
	dataDir := t.TempDir()
	app := App{
		root:     t.TempDir(),
		sshName:  "ipv6-server",
		vaultKey: bytes.Repeat([]byte{1}, 32),
		ssh: SSHConfig{
			DataDir:    dataDir,
			KnownHosts: filepath.Join(dataDir, "known_hosts"),
			Connections: []SSHConnectionConfig{{
				Name: "ipv6-server", Host: "git.example.com", User: "deploy", Paths: []SSHPathConfig{{Name: "root", Path: "."}},
			}},
		},
	}
	output, err := app.run("printf", "recovered")
	if err != nil || output != "recovered" {
		t.Fatalf("retry output = %q, err = %v", output, err)
	}
	calls, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Count(calls, []byte("\n")) != 2 || !bytes.Contains(calls, []byte("ControlMaster=no")) {
		t.Fatalf("retry calls = %s", calls)
	}
}

func TestDisableSSHMultiplexing(t *testing.T) {
	command := exec.Command("ssh", "-F", "/tmp/config", "mindgit-1", "pwd")
	retry := disableSSHMultiplexing(command)
	want := []string{"-F", "/tmp/config", "-o", "ControlMaster=no", "-o", "ControlPath=none", "mindgit-1", "pwd"}
	if !reflect.DeepEqual(retry.Args[1:], want) {
		t.Fatalf("retry args = %#v, want %#v", retry.Args, want)
	}
}
