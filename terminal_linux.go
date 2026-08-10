//go:build linux

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

type terminalWindowSize struct {
	Rows uint16
	Cols uint16
	X    uint16
	Y    uint16
}

func startPTY(root string) (*os.File, *exec.Cmd, error) {
	command := localTerminalCommand()
	command.Dir = root
	command.Env = terminalEnvironment(os.Environ())
	return startPTYCommand(command)
}

func localTerminalCommand() *exec.Cmd {
	shell := terminalShell()
	runtimeDir := strings.TrimSpace(os.Getenv("XDG_RUNTIME_DIR"))
	if os.Getenv("INVOCATION_ID") == "" || runtimeDir == "" {
		return exec.Command(shell)
	}
	if info, err := os.Stat(filepath.Join(runtimeDir, "bus")); err != nil || info.Mode()&os.ModeSocket == 0 {
		return exec.Command(shell)
	}
	systemdRun, err := exec.LookPath("systemd-run")
	if err != nil {
		return exec.Command(shell)
	}
	return exec.Command(systemdRun,
		"--user", "--scope", "--quiet", "--collect", "--no-ask-password", "--same-dir", "--", shell,
	)
}

func terminalEnvironment(environment []string) []string {
	result := append([]string(nil), environment...)
	hasLocale := false
	for _, value := range result {
		if strings.HasPrefix(value, "LANG=") || strings.HasPrefix(value, "LC_ALL=") || strings.HasPrefix(value, "LC_CTYPE=") {
			hasLocale = true
			break
		}
	}
	if !hasLocale {
		result = append(result, "LANG=C.UTF-8")
	}
	return append(result, "TERM=xterm-256color", "COLORTERM=truecolor")
}

func startPTYCommand(command *exec.Cmd) (*os.File, *exec.Cmd, error) {
	master, err := os.OpenFile("/dev/ptmx", os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("open terminal: %w", err)
	}
	unlock := 0
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock))); errno != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("unlock terminal: %w", errno)
	}
	var number uint32
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCGPTN, uintptr(unsafe.Pointer(&number))); errno != 0 {
		master.Close()
		return nil, nil, fmt.Errorf("locate terminal: %w", errno)
	}
	slave, err := os.OpenFile(fmt.Sprintf("/dev/pts/%d", number), os.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		master.Close()
		return nil, nil, fmt.Errorf("open terminal slave: %w", err)
	}

	command.Stdin = slave
	command.Stdout = slave
	command.Stderr = slave
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
	if err := command.Start(); err != nil {
		slave.Close()
		master.Close()
		return nil, nil, fmt.Errorf("start shell: %w", err)
	}
	_ = slave.Close()
	_ = resizePTY(master, 80, 24)
	return master, command, nil
}

func resizePTY(master *os.File, cols, rows uint16) error {
	size := terminalWindowSize{Rows: rows, Cols: cols}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCSWINSZ, uintptr(unsafe.Pointer(&size)))
	if errno != 0 {
		return errno
	}
	return nil
}

func terminatePTY(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	_ = syscall.Kill(-command.Process.Pid, syscall.SIGTERM)
}
