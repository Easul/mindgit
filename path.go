package main

import (
	"errors"
	"fmt"
	"os"
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

func (a App) existingDirectory(path string) (string, error) {
	root, err := filepath.EvalSymlinks(a.root)
	if err != nil {
		return "", err
	}

	fullPath := filepath.Join(a.root, path)
	resolved, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		return "", err
	}

	relative, err := filepath.Rel(root, resolved)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes repository root through a symbolic link")
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", path)
	}
	return resolved, nil
}

func cleanUploadName(input string) (string, error) {
	name := strings.TrimSpace(input)
	if name == "" {
		return "", errors.New("file name is required")
	}
	if name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, "/\\\x00") {
		return "", errors.New("file name must not contain path separators")
	}
	return name, nil
}
