package main

import (
	"net/http"
	"path/filepath"
	"sort"
	"strings"
)

func (a App) handleTree(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := app.cleanOptionalPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	gitAvailable, changes, err := app.loadGitChangesCached()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	files, err := app.treeEntries(path, changes, gitAvailable)
	writeJSON(w, TreeResponse{Path: path, Files: files}, err)
}

func (a App) handleTreeBatch(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	var req TreeBatchRequest
	if r.Method == http.MethodGet {
		req.Paths = r.URL.Query()["path"]
	} else {
		if err := decodeJSONBody(w, r, &req, maxJSONRequestBytes); err != nil {
			writeRequestError(w, err)
			return
		}
	}

	paths := make([]string, 0, len(req.Paths))
	seen := make(map[string]bool, len(req.Paths))
	for _, rawPath := range req.Paths {
		path, err := app.cleanOptionalPath(rawPath)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		if seen[path] {
			continue
		}
		seen[path] = true
		paths = append(paths, path)
	}

	gitAvailable, changes, err := app.loadGitChangesCached()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	trees := make([]TreeResponse, 0, len(paths))
	for _, path := range paths {
		files, err := app.treeEntries(path, changes, gitAvailable)
		if err != nil {
			writeJSON(w, nil, err)
			return
		}
		trees = append(trees, TreeResponse{Path: path, Files: files})
	}

	writeJSON(w, TreeBatchResponse{Trees: trees}, nil)
}

func (a App) status() (StatusResponse, error) {
	gitAvailable, files, err := a.loadGitChanges()
	status, err := a.statusFromGit(gitAvailable, files, err)
	if err == nil {
		a.cache.storeStatus(a.defaultProject, status)
	}
	return status, err
}

func (a App) statusFromGit(gitAvailable bool, files []ChangedFile, err error) (StatusResponse, error) {
	if err != nil {
		return StatusResponse{}, err
	}

	branch := "No Git"
	if gitAvailable {
		branch, err = a.currentBranch()
		if err != nil {
			return StatusResponse{}, err
		}
	}

	rootFiles, err := a.treeEntries("", files, gitAvailable)
	if err != nil {
		return StatusResponse{}, err
	}

	response := StatusResponse{
		Project:      a.currentProject(),
		Root:         a.root,
		Branch:       branch,
		GitAvailable: gitAvailable,
		Files:        rootFiles,
	}
	if !gitAvailable {
		return response, nil
	}

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

func (a App) statusForSave() (StatusResponse, error) {
	if status, ok := a.cache.loadStatus(a.defaultProject); ok {
		return status, nil
	}
	gitAvailable, files, ok := a.cache.loadGitSnapshot(a.defaultProject)
	if !ok {
		return a.status()
	}
	return a.statusFromGit(gitAvailable, files, nil)
}

func (a App) loadGitChanges() (bool, []ChangedFile, error) {
	if !a.isGitRepository() {
		a.cache.storeGit(a.defaultProject, false, nil)
		return false, nil, nil
	}

	files, err := a.changes()
	if err != nil {
		return false, nil, err
	}
	a.cache.storeGit(a.defaultProject, true, files)
	return true, files, nil
}

func (a App) loadGitChangesCached() (bool, []ChangedFile, error) {
	ttl := localGitSnapshotTTL
	if a.sshName != "" {
		ttl = remoteGitSnapshotTTL
	}
	if gitAvailable, files, ok := a.cache.loadGit(a.defaultProject, ttl); ok {
		return gitAvailable, files, nil
	}
	return a.loadGitChanges()
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

func (a App) treeEntries(path string, changes []ChangedFile, gitAvailable bool) ([]ChangedFile, error) {
	entries, err := a.listProjectDirectory(path)
	if err != nil {
		return nil, err
	}

	byPath := a.changeMap(changes)
	files := make([]ChangedFile, 0, len(entries))
	checkPaths := make([]string, 0, len(entries))
	seen := map[string]bool{}

	for _, entry := range entries {
		if path == "" && entry.Name == ".git" {
			continue
		}
		relPath := entry.Name
		if path != "" {
			relPath = path + "/" + entry.Name
		}

		file := byPath[relPath]
		file.Path = relPath
		file.IsDir = entry.IsDir
		if file.IsDir {
			file.Status, file.Staged, file.Unstaged = strongestDescendantState(relPath, changes)
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

	ignored := map[string]bool{}
	if a.sshName == "" {
		ignored = a.ignoredSet(checkPaths, gitAvailable)
	}
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

func (a App) ignoredSet(paths []string, gitAvailable bool) map[string]bool {
	ignored := map[string]bool{}
	if !gitAvailable || len(paths) == 0 {
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

func strongestDescendantState(dir string, changes []ChangedFile) (string, bool, bool) {
	status := ""
	staged := false
	unstaged := false
	for _, change := range changes {
		if change.Ignored || !strings.HasPrefix(change.Path, dir+"/") {
			continue
		}
		status = strongerStatus(status, change.Status)
		staged = staged || change.Staged
		unstaged = unstaged || change.Unstaged
	}
	return status, staged, unstaged
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
