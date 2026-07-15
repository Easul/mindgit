package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func (a App) run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = a.root
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return stdout.String(), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, message)
	}
	return stdout.String(), nil
}

func (a App) runInput(input string, name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = a.root
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	cmd.Stdin = strings.NewReader(input)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return stdout.String(), fmt.Errorf("%s %s: %w: %s", name, strings.Join(args, " "), err, message)
	}
	return stdout.String(), nil
}

func isExitCode(err error, code int) bool {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return false
	}
	return exitErr.ExitCode() == code
}
