package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type SSHConnectionSummary struct {
	Name       string          `json:"name"`
	Host       string          `json:"host"`
	Port       int             `json:"port"`
	User       string          `json:"user"`
	Paths      []SSHPathConfig `json:"paths"`
	JumpHosts  []string        `json:"jumpHosts,omitempty"`
	Configured bool            `json:"configured"`
}

func sshConnectionByName(config SSHConfig, name string) (SSHConnectionConfig, bool) {
	for _, connection := range config.Connections {
		if connection.Name == name {
			return connection, true
		}
	}
	return SSHConnectionConfig{}, false
}

func (a App) handleSSHConnections(w http.ResponseWriter, r *http.Request) {
	summaries := make([]SSHConnectionSummary, 0, len(a.ssh.Connections))
	for _, connection := range a.ssh.Connections {
		configured := sshConnectionConfigured(a.ssh, connection)
		summaries = append(summaries, SSHConnectionSummary{
			Name:       connection.Name,
			Host:       connection.Host,
			Port:       normalizedSSHPort(connection.Port),
			User:       connection.User,
			Paths:      append([]SSHPathConfig(nil), connection.Paths...),
			JumpHosts:  append([]string(nil), connection.JumpHosts...),
			Configured: configured,
		})
	}
	writeJSON(w, summaries, nil)
}

func sshConnectionConfigured(config SSHConfig, connection SSHConnectionConfig) bool {
	names, err := requiredSSHConnections(config, connection.Name)
	if err != nil {
		return false
	}
	for name := range names {
		candidate, ok := sshConnectionByName(config, name)
		if !ok {
			return false
		}
		if candidate.Key == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(config.DataDir, "keys", candidate.Key+".key.enc")); err != nil {
			return false
		}
	}
	return true
}

func buildSSHTerminalCommand(config SSHConfig, target SSHConnectionConfig, vaultKey []byte) (*exec.Cmd, func(), error) {
	temporaryDir, err := os.MkdirTemp("", "mindgit-ssh-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(temporaryDir) }
	if err := os.Chmod(temporaryDir, 0o700); err != nil {
		cleanup()
		return nil, nil, err
	}
	if err := os.MkdirAll(filepath.Dir(config.KnownHosts), 0o700); err != nil {
		cleanup()
		return nil, nil, err
	}
	knownHosts, err := os.OpenFile(config.KnownHosts, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("open SSH known_hosts: %w", err)
	}
	_ = knownHosts.Chmod(0o600)
	_ = knownHosts.Close()
	controlDir := filepath.Join(config.DataDir, "control")
	if err := os.MkdirAll(controlDir, 0o700); err != nil {
		cleanup()
		return nil, nil, err
	}
	_ = os.Chmod(controlDir, 0o700)

	requiredNames, err := requiredSSHConnections(config, target.Name)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	aliases := make(map[string]string, len(requiredNames))
	selected := make([]SSHConnectionConfig, 0, len(requiredNames))
	for _, connection := range config.Connections {
		if !requiredNames[connection.Name] {
			continue
		}
		selected = append(selected, connection)
		aliases[connection.Name] = "mindgit-" + strconv.Itoa(len(selected))
	}
	var builder strings.Builder
	writtenKeys := make(map[string]string)
	for _, connection := range selected {
		alias := aliases[connection.Name]
		builder.WriteString("Host " + alias + "\n")
		builder.WriteString("  HostName " + sshConfigValue(connection.Host) + "\n")
		builder.WriteString("  User " + sshConfigValue(connection.User) + "\n")
		builder.WriteString("  Port " + strconv.Itoa(normalizedSSHPort(connection.Port)) + "\n")
		builder.WriteString("  IdentitiesOnly yes\n")
		builder.WriteString("  StrictHostKeyChecking accept-new\n")
		builder.WriteString("  UserKnownHostsFile " + sshConfigValue(config.KnownHosts) + "\n")
		builder.WriteString("  ControlMaster auto\n")
		builder.WriteString("  ControlPersist 600\n")
		builder.WriteString("  ControlPath " + sshConfigValue(sshControlPath(config, connection)) + "\n")
		if connection.Key != "" {
			keyPath := writtenKeys[connection.Key]
			if keyPath == "" {
				privateKey, err := readEncryptedSSHKey(config, connection.Key, vaultKey)
				if err != nil {
					cleanup()
					return nil, nil, err
				}
				keyPath = filepath.Join(temporaryDir, connection.Key+".key")
				if err := writePrivateFile(keyPath, privateKey); err != nil {
					cleanup()
					return nil, nil, err
				}
				writtenKeys[connection.Key] = keyPath
			}
			builder.WriteString("  IdentityFile " + sshConfigValue(keyPath) + "\n")
		}
		if len(connection.JumpHosts) > 0 {
			jumpAliases := make([]string, 0, len(connection.JumpHosts))
			for _, jump := range connection.JumpHosts {
				jumpAliases = append(jumpAliases, aliases[jump])
			}
			builder.WriteString("  ProxyJump " + strings.Join(jumpAliases, ",") + "\n")
		}
		builder.WriteByte('\n')
	}
	configPath := filepath.Join(temporaryDir, "ssh_config")
	if err := writePrivateFile(configPath, []byte(builder.String())); err != nil {
		cleanup()
		return nil, nil, err
	}
	alias, ok := aliases[target.Name]
	if !ok {
		cleanup()
		return nil, nil, fmt.Errorf("unknown SSH connection: %s", target.Name)
	}
	remoteCommand := "cd -- " + shellQuote(defaultSSHPath(target)) + " && exec \"${SHELL:-/bin/sh}\" -l"
	command := exec.Command("ssh", "-F", configPath, "-tt", alias, remoteCommand)
	command.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	return command, cleanup, nil
}

func sshControlPath(config SSHConfig, connection SSHConnectionConfig) string {
	identity := connection.Name + "\x00" + connection.User + "\x00" + connection.Host + "\x00" + strconv.Itoa(normalizedSSHPort(connection.Port))
	digest := sha256.Sum256([]byte(identity))
	return filepath.Join(config.DataDir, "control", hex.EncodeToString(digest[:12]))
}

func clearSSHControlSockets(config SSHConfig, target SSHConnectionConfig) {
	required, err := requiredSSHConnections(config, target.Name)
	if err != nil {
		return
	}
	for _, connection := range config.Connections {
		if required[connection.Name] {
			_ = os.Remove(sshControlPath(config, connection))
		}
	}
}

func defaultSSHPath(connection SSHConnectionConfig) string {
	if len(connection.Paths) > 0 {
		return connection.Paths[0].Path
	}
	return connection.RemoteDir
}

func buildSSHExecCommand(config SSHConfig, target SSHConnectionConfig, vaultKey []byte, directory, name string, args ...string) (*exec.Cmd, func(), error) {
	template, cleanup, err := buildSSHTerminalCommand(config, target, vaultKey)
	if err != nil {
		return nil, nil, err
	}
	if len(template.Args) < 5 {
		cleanup()
		return nil, nil, fmt.Errorf("invalid SSH command template")
	}
	remote := "cd -- " + shellQuote(directory) + " && exec " + shellQuote(name)
	for _, argument := range args {
		remote += " " + shellQuote(argument)
	}
	command := exec.Command("ssh", "-F", template.Args[2], template.Args[4], remote)
	command.Env = template.Env
	return command, cleanup, nil
}

func requiredSSHConnections(config SSHConfig, target string) (map[string]bool, error) {
	required := make(map[string]bool)
	var add func(string) error
	add = func(name string) error {
		if required[name] {
			return nil
		}
		connection, ok := sshConnectionByName(config, name)
		if !ok {
			return fmt.Errorf("unknown SSH connection: %s", name)
		}
		required[name] = true
		for _, jump := range connection.JumpHosts {
			if err := add(jump); err != nil {
				return err
			}
		}
		return nil
	}
	return required, add(target)
}

func normalizedSSHPort(port int) int {
	if port == 0 {
		return 22
	}
	return port
}

func sshConfigValue(value string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value) + `"`
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
