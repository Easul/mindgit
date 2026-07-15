package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func (a App) currentBranch() (string, error) {
	out, err := a.run("git", "branch", "--show-current")
	if err == nil && strings.TrimSpace(out) != "" {
		return strings.TrimSpace(out), nil
	}

	out, err = a.run("git", "rev-parse", "--short", "HEAD")
	if err != nil {
		return "no commits", nil
	}
	return strings.TrimSpace(out), nil
}

func (a App) numstat() map[string][2]int {
	out, err := a.run("git", "diff", "--numstat", "HEAD", "--")
	if err != nil {
		out, err = a.run("git", "diff", "--numstat", "--")
		if err != nil {
			return map[string][2]int{}
		}
	}

	stats := map[string][2]int{}
	for line := range strings.SplitSeq(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 3 {
			continue
		}
		additions, _ := strconv.Atoi(fields[0])
		deletions, _ := strconv.Atoi(fields[1])
		stats[fields[2]] = [2]int{additions, deletions}
	}
	return stats
}

func (a App) diff(path string) (string, error) {
	if a.isUntracked(path) || !a.hasHead() {
		return a.noIndexDiff(path)
	}

	out, err := a.run("git", "diff", "HEAD", "--", path)
	if err != nil {
		return "", err
	}
	return out, nil
}

func (a App) noIndexDiff(path string) (string, error) {
	out, err := a.run("git", "diff", "--no-index", "--", "/dev/null", path)
	if err != nil && !isExitCode(err, 1) {
		return "", err
	}
	return out, nil
}

func (a App) isUntracked(path string) bool {
	out, err := a.run("git", "status", "--porcelain=v1", "-uall", "--", path)
	return err == nil && strings.HasPrefix(out, "??")
}

func (a App) addUntrackedStats(files []ChangedFile) {
	for i := range files {
		if files[i].Status != "U" || files[i].Additions != 0 || files[i].Deletions != 0 {
			continue
		}
		content, err := os.ReadFile(filepath.Join(a.root, files[i].Path))
		if err != nil {
			continue
		}
		files[i].Additions = lineCount(content)
	}
}

func lineCount(content []byte) int {
	if len(content) == 0 {
		return 0
	}
	count := bytes.Count(content, []byte("\n"))
	if content[len(content)-1] != '\n' {
		count++
	}
	return count
}

func (a App) hasHead() bool {
	_, err := a.run("git", "rev-parse", "--verify", "HEAD")
	return err == nil
}

func (a App) isGitRepository() bool {
	out, err := a.run("git", "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(out) == "true"
}

func (a App) unstage(path string) (StatusResponse, error) {
	changes, err := a.changes()
	if err != nil {
		return StatusResponse{}, err
	}

	var target *ChangedFile
	for i := range changes {
		if changes[i].Path == path {
			target = &changes[i]
			break
		}
	}
	if target == nil || !target.Staged {
		return StatusResponse{}, fmt.Errorf("file is not staged: %s", path)
	}

	if target.IndexStatus == "A" {
		if _, err := a.run("git", "rm", "--cached", "--quiet", "--", path); err != nil {
			return StatusResponse{}, err
		}
	} else {
		if _, err := a.run("git", "restore", "--staged", "--", path); err != nil {
			return StatusResponse{}, err
		}
	}

	return a.status()
}
