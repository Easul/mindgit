package main

import (
	"errors"
	"fmt"
	"os"
	pathpkg "path"
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

func (a App) resolveOpenFilePath(input string) (OpenFileResponse, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return OpenFileResponse{}, errors.New("path is required")
	}
	if a.sshName != "" {
		return a.resolveRemoteOpenFilePath(raw)
	}

	target := raw
	if !filepath.IsAbs(target) {
		target = filepath.Join(a.root, target)
	}
	target, err := filepath.Abs(target)
	if err != nil {
		return OpenFileResponse{}, err
	}
	target, writable, err := inspectLocalFile(target)
	if err != nil {
		return OpenFileResponse{}, err
	}

	root, err := filepath.EvalSymlinks(a.root)
	if err != nil {
		return OpenFileResponse{}, err
	}
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return OpenFileResponse{}, err
	}
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		if isGitPath(relative) {
			return OpenFileResponse{}, errors.New("cannot open .git paths")
		}
		return OpenFileResponse{Path: filepath.ToSlash(relative), Writable: writable}, nil
	}
	return OpenFileResponse{Path: target, External: true, Writable: writable}, nil
}

func (a App) resolveRemoteOpenFilePath(raw string) (OpenFileResponse, error) {
	target := raw
	if !pathpkg.IsAbs(target) {
		target = pathpkg.Join(a.root, target)
	}
	target = pathpkg.Clean(target)
	writable, err := a.inspectRemoteFile(target)
	if err != nil {
		return OpenFileResponse{}, err
	}
	relative := relativeSlashPath(pathpkg.Clean(a.root), target)
	if relative != ".." && !strings.HasPrefix(relative, "../") {
		if isGitPath(relative) {
			return OpenFileResponse{}, errors.New("cannot open .git paths")
		}
		return OpenFileResponse{Path: relative, Writable: writable}, nil
	}
	return OpenFileResponse{Path: target, External: true, Writable: writable}, nil
}

func relativeSlashPath(base, target string) string {
	partsFor := func(value string) []string {
		trimmed := strings.Trim(pathpkg.Clean(value), "/")
		if trimmed == "" {
			return nil
		}
		return strings.Split(trimmed, "/")
	}
	baseParts := partsFor(base)
	targetParts := partsFor(target)
	common := 0
	for common < len(baseParts) && common < len(targetParts) && baseParts[common] == targetParts[common] {
		common++
	}
	parts := make([]string, 0, len(baseParts)-common+len(targetParts)-common)
	for range len(baseParts) - common {
		parts = append(parts, "..")
	}
	parts = append(parts, targetParts[common:]...)
	if len(parts) == 0 {
		return "."
	}
	return strings.Join(parts, "/")
}

func (a App) inspectRemoteFile(path string) (bool, error) {
	script := `path=$1
[ -f "$path" ] || { echo "not a regular file: $path" >&2; exit 1; }
[ -r "$path" ] || { echo "file is not readable: $path" >&2; exit 1; }
if [ -w "$path" ]; then printf writable; else printf readonly; fi`
	output, err := a.run("sh", "-c", script, "mindgit-inspect", path)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(output) == "writable", nil
}

func inspectLocalFile(input string) (string, bool, error) {
	target, err := filepath.EvalSymlinks(input)
	if err != nil {
		return "", false, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return "", false, err
	}
	if !info.Mode().IsRegular() {
		return "", false, fmt.Errorf("not a regular file: %s", input)
	}
	file, err := os.Open(target)
	if err != nil {
		return "", false, err
	}
	if err := file.Close(); err != nil {
		return "", false, err
	}
	writableFile, err := os.OpenFile(target, os.O_WRONLY, 0)
	if err == nil {
		err = writableFile.Close()
	}
	return target, err == nil, nil
}

func (a App) resolveRequestedFilePath(input string, external bool) (string, error) {
	if !external {
		return a.cleanPath(input)
	}
	if a.sshName != "" {
		raw := strings.TrimSpace(input)
		if !pathpkg.IsAbs(raw) {
			return "", errors.New("external file path must be absolute")
		}
		target := pathpkg.Clean(raw)
		_, err := a.inspectRemoteFile(target)
		return target, err
	}
	raw := strings.TrimSpace(input)
	if !filepath.IsAbs(raw) {
		return "", errors.New("external file path must be absolute")
	}
	target, _, err := inspectLocalFile(raw)
	return target, err
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
