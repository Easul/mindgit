package main

import (
	"strconv"
	"strings"
)

func parseStatus(out string, stats map[string][2]int) []ChangedFile {
	var files []ChangedFile
	for line := range strings.SplitSeq(strings.TrimRight(out, "\n"), "\n") {
		if len(line) < 4 {
			continue
		}
		code := line[:2]
		path := line[3:]
		if strings.Contains(path, " -> ") {
			parts := strings.Split(path, " -> ")
			path = parts[len(parts)-1]
		}

		indexStatus, worktreeStatus, status := normalizeStatus(code)
		change := ChangedFile{
			Path:           path,
			Status:         status,
			IndexStatus:    indexStatus,
			WorktreeStatus: worktreeStatus,
			Staged:         indexStatus != "",
			Unstaged:       worktreeStatus != "",
			Ignored:        status == "I",
		}
		if stat, ok := stats[path]; ok {
			change.Additions = stat[0]
			change.Deletions = stat[1]
		}
		files = append(files, change)
	}
	return files
}

func parseCommits(out string) []CommitSummary {
	var commits []CommitSummary
	for record := range strings.SplitSeq(strings.TrimRight(out, "\x1e\n"), "\x1e") {
		if strings.TrimSpace(record) == "" {
			continue
		}
		fields := strings.SplitN(strings.Trim(record, "\n"), "\x1f", 6)
		if len(fields) < 6 {
			continue
		}
		commits = append(commits, CommitSummary{
			Hash:      fields[0],
			ShortHash: fields[1],
			Author:    fields[2],
			Email:     fields[3],
			Date:      fields[4],
			Subject:   fields[5],
		})
	}
	return commits
}

func parseNameStatus(out string) []ChangedFile {
	var files []ChangedFile
	for line := range strings.SplitSeq(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		status := normalizeCommitStatus(fields[0])
		path := fields[len(fields)-1]
		files = append(files, ChangedFile{Path: path, Status: status})
	}
	return files
}

func parseNumstat(out string) map[string][2]int {
	stats := map[string][2]int{}
	for line := range strings.SplitSeq(strings.TrimSpace(out), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 3 {
			continue
		}
		additions, _ := strconv.Atoi(fields[0])
		deletions, _ := strconv.Atoi(fields[1])
		stats[fields[len(fields)-1]] = [2]int{additions, deletions}
	}
	return stats
}

func normalizeCommitStatus(code string) string {
	switch code[0] {
	case 'A':
		return "A"
	case 'D':
		return "D"
	case 'U':
		return "U"
	default:
		return "M"
	}
}

func normalizeStatus(code string) (string, string, string) {
	if len(code) < 2 {
		return "", "", ""
	}

	indexStatus := normalizeStatusChar(code[0])
	worktreeStatus := normalizeStatusChar(code[1])
	return indexStatus, worktreeStatus, mergeStatuses(indexStatus, worktreeStatus)
}

func normalizeStatusChar(code byte) string {
	switch code {
	case ' ', 0:
		return ""
	case '!':
		return "I"
	case '?':
		return "U"
	case 'A':
		return "A"
	case 'D':
		return "D"
	case 'U':
		return "U"
	default:
		return "M"
	}
}

func mergeStatuses(indexStatus string, worktreeStatus string) string {
	if indexStatus == "I" || worktreeStatus == "I" {
		return "I"
	}
	if indexStatus == "A" {
		return "A"
	}
	if indexStatus == "D" && worktreeStatus == "" {
		return "D"
	}
	return strongerStatus(indexStatus, worktreeStatus)
}
