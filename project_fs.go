package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type projectDirEntry struct {
	Name  string
	IsDir bool
}

func (a App) readProjectFile(path string) ([]byte, error) {
	if a.sshName == "" {
		return os.ReadFile(filepath.Join(a.root, path))
	}
	output, err := a.run("cat", "--", path)
	return []byte(output), err
}

func (a App) projectFileSize(path string) (int64, error) {
	if a.sshName == "" {
		info, err := os.Stat(filepath.Join(a.root, path))
		if err != nil {
			return 0, err
		}
		if info.IsDir() {
			return 0, fmt.Errorf("cannot preview directory: %s", path)
		}
		return info.Size(), nil
	}
	output, err := a.run("wc", "-c", "--", path)
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(output)
	if len(fields) == 0 {
		return 0, fmt.Errorf("cannot determine size of %s", path)
	}
	size, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("cannot determine size of %s: %w", path, err)
	}
	return size, nil
}

func (a App) listProjectDirectory(path string) ([]projectDirEntry, error) {
	if a.sshName == "" {
		entries, err := os.ReadDir(filepath.Join(a.root, path))
		if err != nil {
			return nil, err
		}
		result := make([]projectDirEntry, 0, len(entries))
		for _, entry := range entries {
			result = append(result, projectDirEntry{Name: entry.Name(), IsDir: entry.IsDir()})
		}
		return result, nil
	}
	target := path
	if target == "" {
		target = "."
	}
	script := `target=$1
for item in "$target"/* "$target"/.[!.]* "$target"/..?*; do
  [ -e "$item" ] || continue
  name=${item##*/}
  if [ -d "$item" ]; then kind=d; else kind=f; fi
  printf '%s\t%s\n' "$kind" "$name"
done`
	output, err := a.run("sh", "-c", script, "mindgit-list", target)
	if err != nil {
		return nil, err
	}
	var entries []projectDirEntry
	for line := range strings.SplitSeq(strings.TrimRight(output, "\n"), "\n") {
		kind, name, ok := strings.Cut(line, "\t")
		if !ok || name == "" {
			continue
		}
		entries = append(entries, projectDirEntry{Name: name, IsDir: kind == "d"})
	}
	return entries, nil
}

func (a App) writeProjectFile(path string, content []byte, create bool) error {
	if a.sshName == "" {
		fullPath := filepath.Join(a.root, path)
		if create {
			if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
			if err != nil {
				return err
			}
			if _, err := file.Write(content); err != nil {
				file.Close()
				_ = os.Remove(fullPath)
				return err
			}
			return file.Close()
		}
		return os.WriteFile(fullPath, content, 0o644)
	}
	script := `path=$1
parent=${path%/*}
[ "$parent" = "$path" ] && parent=.
mkdir -p -- "$parent" || exit 1
if [ "$2" = create ] && [ -e "$path" ]; then echo 'path already exists' >&2; exit 1; fi
tmp="$path.mindgit-$$"
trap 'rm -f -- "$tmp"' EXIT HUP INT TERM
if [ -e "$path" ]; then cp -p "$path" "$tmp" || exit 1; else : > "$tmp" && chmod 644 "$tmp"; fi
cat > "$tmp" && mv -- "$tmp" "$path"`
	mode := "replace"
	if create {
		mode = "create"
	}
	_, err := a.runInput(string(content), "sh", "-c", script, "mindgit-write", path, mode)
	if err != nil {
		return fmt.Errorf("write remote file %s: %w", path, err)
	}
	return nil
}

func (a App) createRemotePath(path, kind string) error {
	script := `path=$1
if [ -e "$path" ]; then echo 'path already exists' >&2; exit 1; fi
case "$2" in
  file) parent=${path%/*}; [ "$parent" = "$path" ] && parent=.; mkdir -p -- "$parent" && : > "$path" ;;
  dir) mkdir -p -- "$path" ;;
  *) exit 2 ;;
esac`
	_, err := a.run("sh", "-c", script, "mindgit-create", path, kind)
	return err
}

func (a App) renameRemotePath(path, destination string) error {
	script := `source=$1
destination=$2
[ -e "$source" ] || { echo 'source does not exist' >&2; exit 1; }
[ ! -e "$destination" ] || { echo 'destination already exists' >&2; exit 1; }
mv -- "$source" "$destination"`
	_, err := a.run("sh", "-c", script, "mindgit-rename", path, destination)
	return err
}

func (a App) deleteRemotePath(path string) error {
	script := `path=$1
[ -e "$path" ] || { echo 'path does not exist' >&2; exit 1; }
rm -rf -- "$path"`
	_, err := a.run("sh", "-c", script, "mindgit-delete", path)
	return err
}
