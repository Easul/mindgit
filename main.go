package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Config struct {
	root string
	host string
	port int
}

type App struct {
	root string
}

//go:embed web/*
var webFS embed.FS

type ChangedFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Ignored   bool   `json:"ignored"`
	IsDir     bool   `json:"isDir"`
}

type StatusResponse struct {
	Root      string        `json:"root"`
	Branch    string        `json:"branch"`
	Files     []ChangedFile `json:"files"`
	Modified  int           `json:"modified"`
	Added     int           `json:"added"`
	Deleted   int           `json:"deleted"`
	Untracked int           `json:"untracked"`
	Additions int           `json:"additions"`
	Deletions int           `json:"deletions"`
}

type DiffResponse struct {
	Path string `json:"path"`
	Diff string `json:"diff"`
}

type FileResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type SaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CreatePathRequest struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type DeletePathRequest struct {
	Path    string `json:"path"`
	Confirm bool   `json:"confirm"`
}

type SearchResponse struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
}

type SearchResult struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

type TreeResponse struct {
	Path  string        `json:"path"`
	Files []ChangedFile `json:"files"`
}

type CommitSummary struct {
	Hash      string `json:"hash"`
	ShortHash string `json:"shortHash"`
	Author    string `json:"author"`
	Email     string `json:"email"`
	Date      string `json:"date"`
	Subject   string `json:"subject"`
}

type CommitHistoryResponse struct {
	Commits []CommitSummary `json:"commits"`
}

type CommitDetail struct {
	Commit CommitSummary `json:"commit"`
	Files  []ChangedFile `json:"files"`
}

func main() {
	config, err := parseConfig(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	if config.root == "" {
		return
	}

	app := App{root: config.root}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/status", app.handleStatus)
	mux.HandleFunc("GET /api/diff", app.handleDiff)
	mux.HandleFunc("GET /api/file", app.handleReadFile)
	mux.HandleFunc("GET /api/xmind", app.handleXMindFile)
	mux.HandleFunc("POST /api/file", app.handleSaveFile)
	mux.HandleFunc("POST /api/fs", app.handleCreatePath)
	mux.HandleFunc("DELETE /api/fs", app.handleDeletePath)
	mux.HandleFunc("GET /api/search", app.handleSearch)
	mux.HandleFunc("GET /api/tree", app.handleTree)
	mux.HandleFunc("GET /api/commits", app.handleCommits)
	mux.HandleFunc("GET /api/commit", app.handleCommit)
	mux.HandleFunc("GET /api/commit-diff", app.handleCommitDiff)
	mux.Handle("/", http.FileServer(http.FS(staticFiles())))

	addr := net.JoinHostPort(config.host, strconv.Itoa(config.port))
	log.Printf("MindGit serving %s at http://%s", config.root, addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func parseConfig(args []string) (Config, error) {
	if len(args) == 1 && args[0] == "help" {
		printUsage()
		return Config{}, nil
	}

	defaultRoot, err := os.Getwd()
	if err != nil {
		return Config{}, err
	}

	config := Config{root: defaultRoot, host: "127.0.0.1", port: 8787}
	flags := flag.NewFlagSet("mindgit", flag.ContinueOnError)
	flags.SetOutput(os.Stdout)
	flags.Usage = printUsage

	var help bool
	flags.BoolVar(&help, "h", false, "show help")
	flags.BoolVar(&help, "help", false, "show help")
	flags.StringVar(&config.root, "d", config.root, "project directory")
	flags.StringVar(&config.root, "dir", config.root, "project directory")
	flags.StringVar(&config.host, "b", config.host, "bind address, for example 127.0.0.1 or 0.0.0.0")
	flags.StringVar(&config.host, "bind", config.host, "bind address, for example 127.0.0.1 or 0.0.0.0")
	flags.IntVar(&config.port, "p", config.port, "server port")
	flags.IntVar(&config.port, "port", config.port, "server port")

	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	if help {
		printUsage()
		return Config{}, nil
	}
	if flags.NArg() > 0 {
		return Config{}, fmt.Errorf("unexpected argument: %s", flags.Arg(0))
	}
	if config.port < 1 || config.port > 65535 {
		return Config{}, fmt.Errorf("port must be between 1 and 65535")
	}

	root, err := filepath.Abs(config.root)
	if err != nil {
		return Config{}, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return Config{}, err
	}
	if !info.IsDir() {
		return Config{}, fmt.Errorf("project directory is not a directory: %s", root)
	}
	config.root = root
	return config, nil
}

func printUsage() {
	fmt.Println(`MindGit - local code review workbench

Usage:
  mindgit [options]
  mindgit help

Options:
  -d, --dir <path>      Project directory to inspect. Default: current directory
  -b, --bind <addr>     Bind address: 127.0.0.1 or 0.0.0.0. Default: 127.0.0.1
  -p, --port <port>     HTTP port. Default: 8787
  -h, --help            Show this help`)
}

func staticFiles() fs.FS {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	return sub
}

func (a App) handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := a.status()
	writeJSON(w, status, err)
}

func (a App) handleDiff(w http.ResponseWriter, r *http.Request) {
	path, err := a.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	diff, err := a.diff(path)
	writeJSON(w, DiffResponse{Path: path, Diff: diff}, err)
}

func (a App) handleReadFile(w http.ResponseWriter, r *http.Request) {
	path, err := a.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	fullPath := filepath.Join(a.root, path)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	// Check if it's an image file - return binary data directly
	ext := strings.ToLower(filepath.Ext(path))
	imageExts := map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".bmp":  "image/bmp",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".ico":  "image/x-icon",
	}

	if mimeType, isImage := imageExts[ext]; isImage {
		w.Header().Set("Content-Type", mimeType)
		w.WriteHeader(http.StatusOK)
		w.Write(content)
		return
	}

	// For text files, return JSON
	writeJSON(w, FileResponse{Path: path, Content: string(content)}, nil)
}

func (a App) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	var req SaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}

	path, err := a.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	fullPath := filepath.Join(a.root, path)
	if err := os.WriteFile(fullPath, []byte(req.Content), 0o644); err != nil {
		writeJSON(w, nil, err)
		return
	}

	status, err := a.status()
	writeJSON(w, status, err)
}

func (a App) handleCreatePath(w http.ResponseWriter, r *http.Request) {
	var req CreatePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}

	path, err := a.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if isGitPath(path) {
		writeJSON(w, nil, errors.New("cannot modify .git paths"))
		return
	}

	fullPath := filepath.Join(a.root, path)
	if _, err := os.Stat(fullPath); err == nil {
		writeJSON(w, nil, fmt.Errorf("path already exists: %s", path))
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, nil, err)
		return
	}

	switch req.Kind {
	case "file":
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			writeJSON(w, nil, err)
			return
		}
		file, err := os.OpenFile(fullPath, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		if err := file.Close(); err != nil {
			writeJSON(w, nil, err)
			return
		}
	case "dir":
		if err := os.MkdirAll(fullPath, 0o755); err != nil {
			writeJSON(w, nil, err)
			return
		}
	default:
		writeJSON(w, nil, errors.New("kind must be file or dir"))
		return
	}

	status, err := a.status()
	writeJSON(w, status, err)
}

func (a App) handleDeletePath(w http.ResponseWriter, r *http.Request) {
	var req DeletePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}
	if !req.Confirm {
		writeJSON(w, nil, errors.New("delete confirmation is required"))
		return
	}

	path, err := a.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if isGitPath(path) {
		writeJSON(w, nil, errors.New("cannot modify .git paths"))
		return
	}

	fullPath := filepath.Join(a.root, path)
	if _, err := os.Stat(fullPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, nil, fmt.Errorf("path does not exist: %s", path))
			return
		}
		writeJSON(w, nil, err)
		return
	}
	if err := os.RemoveAll(fullPath); err != nil {
		writeJSON(w, nil, err)
		return
	}

	status, err := a.status()
	writeJSON(w, status, err)
}

func (a App) handleSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, SearchResponse{}, nil)
		return
	}

	results, err := a.search(query)
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
		if a.isFileIgnored(relPath) {
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

func (a App) handleTree(w http.ResponseWriter, r *http.Request) {
	path, err := a.cleanOptionalPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	changes, err := a.changes()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	files, err := a.treeEntries(path, changes)
	writeJSON(w, TreeResponse{Path: path, Files: files}, err)
}

func (a App) handleCommits(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if input := strings.TrimSpace(r.URL.Query().Get("limit")); input != "" {
		parsed, err := strconv.Atoi(input)
		if err != nil || parsed < 1 || parsed > 200 {
			writeJSON(w, nil, errors.New("limit must be between 1 and 200"))
			return
		}
		limit = parsed
	}

	commits, err := a.commits(limit)
	writeJSON(w, CommitHistoryResponse{Commits: commits}, err)
}

func (a App) handleCommit(w http.ResponseWriter, r *http.Request) {
	sha, err := a.cleanCommit(r.URL.Query().Get("sha"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	detail, err := a.commitDetail(sha)
	writeJSON(w, detail, err)
}

func (a App) handleCommitDiff(w http.ResponseWriter, r *http.Request) {
	sha, err := a.cleanCommit(r.URL.Query().Get("sha"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := a.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	diff, err := a.commitDiff(sha, path)
	writeJSON(w, DiffResponse{Path: path, Diff: diff}, err)
}

func (a App) status() (StatusResponse, error) {
	branch, err := a.currentBranch()
	if err != nil {
		return StatusResponse{}, err
	}

	files, err := a.changes()
	if err != nil {
		return StatusResponse{}, err
	}

	rootFiles, err := a.treeEntries("", files)
	if err != nil {
		return StatusResponse{}, err
	}

	response := StatusResponse{Root: a.root, Branch: branch, Files: rootFiles}
	for _, file := range files {
		if file.Ignored || file.Status == "" {
			continue
		}
		response.Additions += file.Additions
		response.Deletions += file.Deletions
		switch file.Status {
		case "A":
			response.Added++
		case "D":
			response.Deleted++
		case "U":
			response.Untracked++
		default:
			response.Modified++
		}
	}

	return response, nil
}

func (a App) changes() ([]ChangedFile, error) {
	out, err := a.run("git", "status", "--porcelain=v1", "--ignored", "-uall")
	if err != nil {
		return nil, err
	}

	numstat := a.numstat()
	files := parseStatus(out, numstat)
	a.addUntrackedStats(files)
	return files, nil
}

func (a App) changeMap(changes []ChangedFile) map[string]ChangedFile {
	byPath := map[string]ChangedFile{}
	for _, change := range changes {
		byPath[change.Path] = change
	}
	return byPath
}

func (a App) treeEntries(path string, changes []ChangedFile) ([]ChangedFile, error) {
	fullPath := filepath.Join(a.root, path)
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	byPath := a.changeMap(changes)
	files := make([]ChangedFile, 0, len(entries))
	checkPaths := make([]string, 0, len(entries))
	seen := map[string]bool{}

	for _, entry := range entries {
		if path == "" && entry.Name() == ".git" {
			continue
		}
		relPath := entry.Name()
		if path != "" {
			relPath = path + "/" + entry.Name()
		}

		file := byPath[relPath]
		file.Path = relPath
		file.IsDir = entry.IsDir()
		if file.IsDir {
			file.Status = strongestDescendantStatus(relPath, changes)
		}
		files = append(files, file)
		checkPaths = append(checkPaths, relPath)
		seen[relPath] = true
	}

	for _, change := range changes {
		if seen[change.Path] || parentPath(change.Path) != path {
			continue
		}
		files = append(files, change)
	}

	ignored := a.ignoredSet(checkPaths)
	for i := range files {
		if ignored[files[i].Path] {
			files[i].Ignored = true
			if files[i].Status == "" {
				files[i].Status = "I"
			}
		}
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return files[i].Path < files[j].Path
	})
	return files, nil
}

func (a App) ignoredSet(paths []string) map[string]bool {
	ignored := map[string]bool{}
	if len(paths) == 0 {
		return ignored
	}

	out, err := a.runInput(strings.Join(paths, "\n"), "git", "check-ignore", "--stdin")
	if err != nil {
		if !isExitCode(err, 1) {
			return ignored
		}
	}

	for path := range strings.SplitSeq(strings.TrimRight(out, "\n"), "\n") {
		if path != "" {
			ignored[path] = true
		}
	}
	return ignored
}

func strongestDescendantStatus(dir string, changes []ChangedFile) string {
	status := ""
	for _, change := range changes {
		if change.Ignored || !strings.HasPrefix(change.Path, dir+"/") {
			continue
		}
		status = strongerStatus(status, change.Status)
	}
	return status
}

func strongerStatus(current string, candidate string) string {
	priority := map[string]int{"D": 5, "M": 4, "A": 3, "U": 2}
	if priority[candidate] > priority[current] {
		return candidate
	}
	return current
}

func parentPath(path string) string {
	parent := filepath.Dir(path)
	if parent == "." {
		return ""
	}
	return filepath.ToSlash(parent)
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

		status := normalizeStatus(code)
		change := ChangedFile{Path: path, Status: status, Ignored: status == "I"}
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

func normalizeStatus(code string) string {
	if strings.Contains(code, "!") {
		return "I"
	}
	if strings.Contains(code, "?") {
		return "U"
	}
	if strings.Contains(code, "A") {
		return "A"
	}
	if strings.Contains(code, "D") {
		return "D"
	}
	return "M"
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

func writeJSON(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(value)
}
