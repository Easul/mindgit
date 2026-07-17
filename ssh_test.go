package main

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSSHArgumentsWithJumpHosts(t *testing.T) {
	config := SSHConfig{
		KnownHosts: "/safe/known_hosts",
		Connections: []SSHConnectionConfig{
			{Name: "edge", Host: "edge.example.com", Port: 2222, User: "jump", Paths: []SSHPathConfig{{Name: "root", Path: "/tmp"}}},
			{Name: "inner", Host: "inner.example.com", User: "ops", Paths: []SSHPathConfig{{Name: "root", Path: "/srv/app"}}, JumpHosts: []string{"edge"}},
		},
	}
	arguments, err := sshArguments(config, config.Connections[1])
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"-o", "BatchMode=yes",
		"-o", "UserKnownHostsFile=/safe/known_hosts",
		"-J", "jump@edge.example.com:2222",
		"ops@inner.example.com",
	}
	if !reflect.DeepEqual(arguments, want) {
		t.Fatalf("arguments = %#v, want %#v", arguments, want)
	}
}

func TestSSHControlPathSupportsIPv6Hosts(t *testing.T) {
	config := SSHConfig{DataDir: t.TempDir()}
	connection := SSHConnectionConfig{Name: "ipv6", Host: "git.example.com", User: "deploy", Port: 22}
	path := sshControlPath(config, connection)
	if filepath.Dir(path) != filepath.Join(config.DataDir, "control") {
		t.Fatalf("control path = %q", path)
	}
	if strings.Contains(filepath.Base(path), ":") || len(filepath.Base(path)) != 24 {
		t.Fatalf("unsafe control socket name: %q", filepath.Base(path))
	}
	connection.Host = "2001:db8::10"
	ipv6Path := sshControlPath(config, connection)
	if strings.Contains(filepath.Base(ipv6Path), ":") || ipv6Path == path {
		t.Fatalf("IPv6 control path = %q", ipv6Path)
	}
}

func TestValidateSSHConfigRejectsUnknownJump(t *testing.T) {
	err := validateSSHConfig(SSHConfig{Connections: []SSHConnectionConfig{
		{Name: "inner", Host: "inner.example.com", User: "ops", Paths: []SSHPathConfig{{Name: "root", Path: "/srv/app"}}, JumpHosts: []string{"missing"}},
	}})
	if err == nil {
		t.Fatal("expected unknown jump host error")
	}
}

func TestValidateSSHConfigRejectsJumpCycle(t *testing.T) {
	err := validateSSHConfig(SSHConfig{Connections: []SSHConnectionConfig{
		{Name: "one", Host: "one.example.com", User: "ops", Paths: []SSHPathConfig{{Name: "root", Path: "/tmp"}}, JumpHosts: []string{"two"}},
		{Name: "two", Host: "two.example.com", User: "ops", Paths: []SSHPathConfig{{Name: "root", Path: "/tmp"}}, JumpHosts: []string{"one"}},
	}})
	if err == nil {
		t.Fatal("expected jump cycle error")
	}
}
