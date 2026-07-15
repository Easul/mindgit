package main

import (
	"errors"
	"path/filepath"
	"strings"
)

func (a App) cleanPath(input string) (string, error) {
	if strings.TrimSpace(input) == "" {
		return "", errors.New("path is required")
	}
	return a.cleanOptionalPath(input)
}

func isGitPath(path string) bool {
	return path == ".git" || strings.HasPrefix(path, ".git"+string(filepath.Separator)) || strings.HasPrefix(path, ".git/")
}

func (a App) cleanCommit(input string) (string, error) {
	sha := strings.TrimSpace(input)
	if sha == "" {
		return "", errors.New("sha is required")
	}
	out, err := a.run("git", "rev-parse", "--verify", sha+"^{commit}")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func (a App) cleanOptionalPath(input string) (string, error) {
	if strings.TrimSpace(input) == "" {
		return "", nil
	}
	if filepath.IsAbs(input) {
		return "", errors.New("absolute paths are not allowed")
	}

	clean := filepath.Clean(input)
	if clean == "." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return "", errors.New("path escapes repository root")
	}
	return clean, nil
}
