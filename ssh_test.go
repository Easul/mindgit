package main

import (
	"reflect"
	"testing"
)

func TestSSHArgumentsWithJumpHosts(t *testing.T) {
	config := SSHConfig{
		KnownHosts: "/safe/known_hosts",
		Connections: []SSHConnectionConfig{
			{Name: "edge", Host: "edge.example.com", Port: 2222, User: "jump", RemoteDir: "/tmp"},
			{Name: "inner", Host: "inner.example.com", User: "ops", RemoteDir: "/srv/app", JumpHosts: []string{"edge"}},
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

func TestValidateSSHConfigRejectsUnknownJump(t *testing.T) {
	err := validateSSHConfig(SSHConfig{Connections: []SSHConnectionConfig{
		{Name: "inner", Host: "inner.example.com", User: "ops", RemoteDir: "/srv/app", JumpHosts: []string{"missing"}},
	}})
	if err == nil {
		t.Fatal("expected unknown jump host error")
	}
}

func TestValidateSSHConfigRejectsJumpCycle(t *testing.T) {
	err := validateSSHConfig(SSHConfig{Connections: []SSHConnectionConfig{
		{Name: "one", Host: "one.example.com", User: "ops", RemoteDir: "/tmp", JumpHosts: []string{"two"}},
		{Name: "two", Host: "two.example.com", User: "ops", RemoteDir: "/tmp", JumpHosts: []string{"one"}},
	}})
	if err == nil {
		t.Fatal("expected jump cycle error")
	}
}
