package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type DependencyReport struct {
	Required []string
	Optional []string
}

func checkDependencies(config Config) (DependencyReport, error) {
	report := DependencyReport{}
	if _, err := exec.LookPath("git"); err != nil {
		report.Required = append(report.Required, "git")
	}
	if len(config.ssh.Connections) > 0 {
		for _, command := range []string{"ssh"} {
			if _, err := exec.LookPath(command); err != nil {
				report.Required = append(report.Required, command)
			}
		}
	}
	if _, err := exec.LookPath("rg"); err != nil {
		report.Optional = append(report.Optional, "rg (faster project search)")
	}
	if len(report.Required) > 0 {
		return report, fmt.Errorf("missing required command(s): %s; install them and start MindGit again", strings.Join(report.Required, ", "))
	}
	return report, nil
}

func validateSSHConfig(config SSHConfig) error {
	connections := make(map[string]SSHConnectionConfig, len(config.Connections))
	for _, connection := range config.Connections {
		name := strings.TrimSpace(connection.Name)
		if name == "" {
			return fmt.Errorf("SSH connection name cannot be empty")
		}
		if _, exists := connections[name]; exists {
			return fmt.Errorf("duplicate SSH connection name: %s", name)
		}
		if strings.TrimSpace(connection.Host) == "" || strings.TrimSpace(connection.User) == "" || strings.TrimSpace(connection.RemoteDir) == "" {
			return fmt.Errorf("SSH connection %q requires host, user, and remoteDir", name)
		}
		for field, value := range map[string]string{"name": connection.Name, "host": connection.Host, "user": connection.User, "remoteDir": connection.RemoteDir} {
			if strings.ContainsAny(value, "\r\n\x00") {
				return fmt.Errorf("SSH connection %q has an invalid %s", name, field)
			}
		}
		if connection.Key != "" && !validSSHKeyName(connection.Key) {
			return fmt.Errorf("SSH connection %q has an invalid key name", name)
		}
		if connection.Port < 0 || connection.Port > 65535 {
			return fmt.Errorf("SSH connection %q has an invalid port", name)
		}
		connections[name] = connection
	}
	for _, connection := range config.Connections {
		for _, jump := range connection.JumpHosts {
			if jump == connection.Name {
				return fmt.Errorf("SSH connection %q cannot jump through itself", connection.Name)
			}
			if _, exists := connections[jump]; !exists {
				return fmt.Errorf("SSH connection %q references unknown jump host %q", connection.Name, jump)
			}
		}
	}
	visiting := make(map[string]bool)
	visited := make(map[string]bool)
	var visit func(string) error
	visit = func(name string) error {
		if visiting[name] {
			return fmt.Errorf("SSH jump host cycle detected at %q", name)
		}
		if visited[name] {
			return nil
		}
		visiting[name] = true
		for _, jump := range connections[name].JumpHosts {
			if err := visit(jump); err != nil {
				return err
			}
		}
		delete(visiting, name)
		visited[name] = true
		return nil
	}
	for name := range connections {
		if err := visit(name); err != nil {
			return err
		}
	}
	return nil
}

func encryptedSSHKeysExist(config SSHConfig) bool {
	matches, _ := filepath.Glob(filepath.Join(config.DataDir, "keys", "*.key.enc"))
	for _, match := range matches {
		if info, err := os.Stat(match); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}
