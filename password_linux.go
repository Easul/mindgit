//go:build linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"
)

func readNewPassword() (string, error) {
	if password := os.Getenv("MINDGIT_PASSWORD"); password != "" {
		return password, nil
	}
	password, err := readSecret("New MindGit password: ")
	if err != nil {
		return "", err
	}
	confirmation, err := readSecret("Confirm password: ")
	if err != nil {
		return "", err
	}
	if password != confirmation {
		return "", fmt.Errorf("passwords do not match")
	}
	return password, nil
}

func readSecret(prompt string) (string, error) {
	terminal, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", fmt.Errorf("open terminal: %w", err)
	}
	defer terminal.Close()
	_, _ = fmt.Fprint(terminal, prompt)
	var original syscall.Termios
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, terminal.Fd(), syscall.TCGETS, uintptr(unsafe.Pointer(&original))); errno != 0 {
		return "", errno
	}
	hidden := original
	hidden.Lflag &^= syscall.ECHO
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, terminal.Fd(), syscall.TCSETS, uintptr(unsafe.Pointer(&hidden))); errno != 0 {
		return "", errno
	}
	line, readErr := bufio.NewReader(terminal).ReadString('\n')
	_, _, _ = syscall.Syscall(syscall.SYS_IOCTL, terminal.Fd(), syscall.TCSETS, uintptr(unsafe.Pointer(&original)))
	_, _ = fmt.Fprintln(terminal)
	return strings.TrimRight(line, "\r\n"), readErr
}
