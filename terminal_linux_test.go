//go:build linux

package main

import (
	"net"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

func TestLocalTerminalCommandUsesSystemdScopeInsideService(t *testing.T) {
	systemdRun, err := exec.LookPath("systemd-run")
	if err != nil {
		t.Skip("systemd-run is not installed")
	}
	runtimeDir := t.TempDir()
	listener, err := net.Listen("unix", filepath.Join(runtimeDir, "bus"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	t.Setenv("INVOCATION_ID", "test-invocation")
	t.Setenv("XDG_RUNTIME_DIR", runtimeDir)
	t.Setenv("SHELL", "/bin/sh")

	command := localTerminalCommand()
	if command.Path != systemdRun {
		t.Fatalf("local terminal command = %q, want %q", command.Path, systemdRun)
	}
	for _, argument := range []string{"--user", "--scope", "--collect", "--no-ask-password", "/bin/sh"} {
		if !slices.Contains(command.Args, argument) {
			t.Fatalf("local terminal command does not contain %q: %#v", argument, command.Args)
		}
	}
}

func TestTerminalEnvironmentAddsUTF8LocaleWhenMissing(t *testing.T) {
	environment := terminalEnvironment([]string{"PATH=/usr/bin"})
	want := map[string]bool{
		"LANG=C.UTF-8":        false,
		"TERM=xterm-256color": false,
		"COLORTERM=truecolor": false,
	}
	for _, value := range environment {
		if _, ok := want[value]; ok {
			want[value] = true
		}
	}
	for value, found := range want {
		if !found {
			t.Fatalf("terminal environment does not contain %q: %#v", value, environment)
		}
	}
}

func TestTerminalEnvironmentPreservesConfiguredLocale(t *testing.T) {
	environment := terminalEnvironment([]string{"LANG=zh_CN.UTF-8"})
	for _, value := range environment {
		if value == "LANG=C.UTF-8" {
			t.Fatalf("terminal environment replaced the configured locale: %#v", environment)
		}
	}
}
