package main

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func (a App) handleSearch(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, SearchResponse{}, nil)
		return
	}

	results, err := app.search(query)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	writeJSON(w, SearchResponse{Query: query, Results: results}, nil)
}

func (a App) search(query string) ([]SearchResult, error) {
	// Try using ripgrep first
	if _, err := exec.LookPath("rg"); err == nil {
		out, err := a.run("rg", "--line-number", "--column", "--no-heading", "--color", "never", "--", query)
		if err != nil && !isExitCode(err, 1) {
			// If rg fails for non-search reasons, fall back to Go implementation
			return a.searchWithGo(query)
		}
		return parseSearch(out), nil
	}

	// Fallback to pure Go implementation
	return a.searchWithGo(query)
}

func (a App) searchWithGo(query string) ([]SearchResult, error) {
	var results []SearchResult
	gitAvailable := a.isGitRepository()
	err := filepath.Walk(a.root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip .git directory
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Check if file is ignored by git
		relPath, err := filepath.Rel(a.root, path)
		if err != nil {
			return nil
		}
		if gitAvailable && a.isFileIgnored(relPath) {
			return nil
		}

		// Read and search file
		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		// Skip binary files
		if isBinary(content) {
			return nil
		}

		// Search line by line
		lines := strings.Split(string(content), "\n")
		for lineNum, line := range lines {
			if idx := strings.Index(line, query); idx != -1 {
				results = append(results, SearchResult{
					Path:    filepath.ToSlash(relPath),
					Line:    lineNum + 1,
					Column:  idx + 1,
					Preview: line,
				})
			}
		}

		return nil
	})

	return results, err
}

func (a App) isFileIgnored(path string) bool {
	out, err := a.run("git", "check-ignore", "--", path)
	if err != nil {
		return false
	}
	return strings.TrimSpace(out) != ""
}

func isBinary(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	// Check first 8KB for null bytes
	checkLen := len(content)
	if checkLen > 8192 {
		checkLen = 8192
	}
	return bytes.IndexByte(content[:checkLen], 0) != -1
}

func parseSearch(out string) []SearchResult {
	var results []SearchResult
	for line := range strings.SplitSeq(strings.TrimRight(out, "\n"), "\n") {
		parts := strings.SplitN(line, ":", 4)
		if len(parts) < 4 {
			continue
		}
		lineNumber, _ := strconv.Atoi(parts[1])
		column, _ := strconv.Atoi(parts[2])
		results = append(results, SearchResult{
			Path:    parts[0],
			Line:    lineNumber,
			Column:  column,
			Preview: parts[3],
		})
	}
	return results
}
