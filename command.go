package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

func (a App) run(name string, args ...string) (output string, runErr error) {
	started := time.Now()
	if a.monitor != nil {
		a.monitor.commandStarted()
		defer func() { a.monitor.commandFinished(name, time.Since(started), runErr != nil) }()
	}
	cmd := exec.Command(name, args...)
	cleanup := func() {}
	var sshConnection SSHConnectionConfig
	if a.sshName != "" {
		connection, ok := sshConnectionByName(a.ssh, a.sshName)
		if !ok {
			return "", fmt.Errorf("unknown SSH connection: %s", a.sshName)
		}
		sshConnection = connection
		cmd, cleanup, runErr = buildSSHExecCommand(a.ssh, connection, a.vaultKey, a.root, name, args...)
		if runErr != nil {
			return "", runErr
		}
	} else {
		cmd.Dir = a.root
	}
	defer cleanup()
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr = cmd.Run()
	if runErr != nil && a.sshName != "" && isSSHMultiplexFailure(stderr.String()) {
		cleanup()
		clearSSHControlSockets(a.ssh, sshConnection)
		retry, retryCleanup, retryErr := buildSSHExecCommand(a.ssh, sshConnection, a.vaultKey, a.root, name, args...)
		if retryErr == nil {
			defer retryCleanup()
			retry = disableSSHMultiplexing(retry)
			retry.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
			stdout.Reset()
			stderr.Reset()
			retry.Stdout = &stdout
			retry.Stderr = &stderr
			runErr = retry.Run()
		}
	}
	if runErr != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = runErr.Error()
		}
		return stdout.String(), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), runErr, message)
	}
	return stdout.String(), nil
}

func (a App) runInput(input string, name string, args ...string) (output string, runErr error) {
	started := time.Now()
	if a.monitor != nil {
		a.monitor.commandStarted()
		defer func() { a.monitor.commandFinished(name, time.Since(started), runErr != nil) }()
	}
	cmd := exec.Command(name, args...)
	cleanup := func() {}
	var sshConnection SSHConnectionConfig
	if a.sshName != "" {
		connection, ok := sshConnectionByName(a.ssh, a.sshName)
		if !ok {
			return "", fmt.Errorf("unknown SSH connection: %s", a.sshName)
		}
		sshConnection = connection
		cmd, cleanup, runErr = buildSSHExecCommand(a.ssh, connection, a.vaultKey, a.root, name, args...)
		if runErr != nil {
			return "", runErr
		}
	} else {
		cmd.Dir = a.root
	}
	defer cleanup()
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	cmd.Stdin = strings.NewReader(input)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runErr = cmd.Run()
	if runErr != nil && a.sshName != "" && isSSHMultiplexFailure(stderr.String()) {
		cleanup()
		clearSSHControlSockets(a.ssh, sshConnection)
		retry, retryCleanup, retryErr := buildSSHExecCommand(a.ssh, sshConnection, a.vaultKey, a.root, name, args...)
		if retryErr == nil {
			defer retryCleanup()
			retry = disableSSHMultiplexing(retry)
			retry.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
			retry.Stdin = strings.NewReader(input)
			stdout.Reset()
			stderr.Reset()
			retry.Stdout = &stdout
			retry.Stderr = &stderr
			runErr = retry.Run()
		}
	}
	if runErr != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = runErr.Error()
		}
		return stdout.String(), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), runErr, message)
	}
	return stdout.String(), nil
}

func isSSHMultiplexFailure(message string) bool {
	message = strings.ToLower(message)
	return strings.Contains(message, "mux_client") || strings.Contains(message, "control master")
}

func disableSSHMultiplexing(command *exec.Cmd) *exec.Cmd {
	if command == nil || len(command.Args) < 5 || command.Args[1] != "-F" {
		return command
	}
	args := []string{"-F", command.Args[2], "-o", "ControlMaster=no", "-o", "ControlPath=none"}
	args = append(args, command.Args[3:]...)
	retry := exec.Command(command.Path, args...)
	retry.Env = command.Env
	return retry
}

func isExitCode(err error, code int) bool {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	return exitErr.ExitCode() == code
}
