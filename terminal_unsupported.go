//go:build !linux

package main

import (
	"errors"
	"os"
	"os/exec"
)

func startPTY(string) (*os.File, *exec.Cmd, error) {
	return nil, nil, errors.New("integrated terminal is currently supported on Linux")
}

func startPTYCommand(*exec.Cmd) (*os.File, *exec.Cmd, error) {
	return nil, nil, errors.New("integrated terminal is currently supported on Linux")
}

func resizePTY(*os.File, uint16, uint16) error {
	return nil
}

func terminatePTY(command *exec.Cmd) {
	if command != nil && command.Process != nil {
		_ = command.Process.Kill()
	}
}
