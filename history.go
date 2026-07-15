package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func (a App) handleCommits(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	limit := 50
	if input := strings.TrimSpace(r.URL.Query().Get("limit")); input != "" {
		parsed, err := strconv.Atoi(input)
		if err != nil || parsed < 1 || parsed > 200 {
			writeJSON(w, nil, errors.New("limit must be between 1 and 200"))
			return
		}
		limit = parsed
	}

	commits, err := app.commits(limit)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	staged, err := app.stagedCommitSummary()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if staged != nil {
		commits = append([]CommitSummary{*staged}, commits...)
	}

	writeJSON(w, CommitHistoryResponse{Commits: commits}, nil)
}

func (a App) handleCommit(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("sha")) == stagedCommitHash {
		detail, err := app.stagedDetail()
		writeJSON(w, detail, err)
		return
	}

	sha, err := app.cleanCommit(r.URL.Query().Get("sha"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	detail, err := app.commitDetail(sha)
	writeJSON(w, detail, err)
}

func (a App) handleCommitDiff(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("sha")) == stagedCommitHash {
		path, err := app.cleanPath(r.URL.Query().Get("path"))
		if err != nil {
			writeJSON(w, nil, err)
			return
		}

		diff, err := app.stagedDiff(path)
		writeJSON(w, DiffResponse{Path: path, Diff: diff}, err)
		return
	}

	sha, err := app.cleanCommit(r.URL.Query().Get("sha"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := app.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	diff, err := app.commitDiff(sha, path)
	writeJSON(w, DiffResponse{Path: path, Diff: diff}, err)
}

func (a App) commits(limit int) ([]CommitSummary, error) {
	out, err := a.run("git", "log", "-n", strconv.Itoa(limit), "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e")
	if err != nil {
		if strings.Contains(err.Error(), "does not have any commits yet") {
			return nil, nil
		}
		return nil, err
	}
	return parseCommits(out), nil
}

func (a App) commitDetail(sha string) (CommitDetail, error) {
	commit, err := a.commitSummary(sha)
	if err != nil {
		return CommitDetail{}, err
	}
	files, err := a.commitFiles(sha)
	if err != nil {
		return CommitDetail{}, err
	}
	return CommitDetail{Commit: commit, Files: files}, nil
}

func (a App) commitSummary(sha string) (CommitSummary, error) {
	out, err := a.run("git", "show", "-s", "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s", sha)
	if err != nil {
		return CommitSummary{}, err
	}
	commits := parseCommits(out)
	if len(commits) == 0 {
		return CommitSummary{}, errors.New("commit not found")
	}
	return commits[0], nil
}

func (a App) commitFiles(sha string) ([]ChangedFile, error) {
	nameStatus, err := a.run("git", "show", "--format=", "--name-status", "--find-renames", sha, "--")
	if err != nil {
		return nil, err
	}
	numstat, err := a.run("git", "show", "--format=", "--numstat", "--find-renames", sha, "--")
	if err != nil {
		return nil, err
	}

	stats := parseNumstat(numstat)
	files := parseNameStatus(nameStatus)
	for i := range files {
		if stat, ok := stats[files[i].Path]; ok {
			files[i].Additions = stat[0]
			files[i].Deletions = stat[1]
		}
	}
	return files, nil
}

func (a App) commitDiff(sha string, path string) (string, error) {
	return a.run("git", "show", "--format=", "--patch", sha, "--", path)
}

func (a App) stagedCommitSummary() (*CommitSummary, error) {
	files, err := a.stagedFiles()
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, nil
	}

	return &CommitSummary{
		Hash:      stagedCommitHash,
		ShortHash: "INDEX",
		Subject:   "temporary added file",
		Author:    "staged changes",
		Temporary: true,
	}, nil
}

func (a App) stagedDetail() (CommitDetail, error) {
	commit, err := a.stagedCommitSummary()
	if err != nil {
		return CommitDetail{}, err
	}
	if commit == nil {
		return CommitDetail{}, errors.New("no staged files")
	}

	files, err := a.stagedFiles()
	if err != nil {
		return CommitDetail{}, err
	}
	return CommitDetail{Commit: *commit, Files: files}, nil
}

func (a App) stagedFiles() ([]ChangedFile, error) {
	nameStatus, err := a.run("git", "diff", "--cached", "--name-status", "--find-renames", "--")
	if err != nil {
		return nil, err
	}
	numstat, err := a.run("git", "diff", "--cached", "--numstat", "--find-renames", "--")
	if err != nil {
		return nil, err
	}

	stats := parseNumstat(numstat)
	files := parseNameStatus(nameStatus)
	for i := range files {
		files[i].IndexStatus = files[i].Status
		files[i].Staged = true
		if stat, ok := stats[files[i].Path]; ok {
			files[i].Additions = stat[0]
			files[i].Deletions = stat[1]
		}
	}
	return files, nil
}

func (a App) stagedDiff(path string) (string, error) {
	out, err := a.run("git", "diff", "--cached", "--", path)
	if err != nil {
		return "", err
	}
	return out, nil
}
