//go:build !linux

package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func readNewPassword() (string, error) {
	if password := os.Getenv("MINDGIT_PASSWORD"); password != "" {
		return password, nil
	}
	fmt.Fprint(os.Stderr, "New MindGit password: ")
	password, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(password, "\r\n"), nil
}

func readSecret(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	value, err := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimRight(value, "\r\n"), err
}
