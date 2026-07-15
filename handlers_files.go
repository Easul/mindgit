package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (a App) handleStatus(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	status, err := app.status()
	writeJSON(w, status, err)
}

func (a App) handleDiff(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := app.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	diff, err := app.diff(path)
	writeJSON(w, DiffResponse{Path: path, Diff: diff}, err)
}

func (a App) handleReadFile(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := app.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	fullPath := filepath.Join(app.root, path)
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

func (a App) handleDownload(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	path, err := app.cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	fullPath := filepath.Join(app.root, path)
	file, err := os.Open(fullPath)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if info.IsDir() {
		writeJSON(w, nil, fmt.Errorf("cannot download directory: %s", path))
		return
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path)))
	if contentType == "" {
		header := make([]byte, 512)
		n, _ := file.Read(header)
		contentType = http.DetectContentType(header[:n])
		if _, err := file.Seek(0, 0); err != nil {
			writeJSON(w, nil, err)
			return
		}
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": filepath.Base(path),
	}))
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
}

func (a App) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	var req SaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}

	path, err := app.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	fullPath := filepath.Join(app.root, path)
	if err := os.WriteFile(fullPath, []byte(req.Content), 0o644); err != nil {
		writeJSON(w, nil, err)
		return
	}

	status, err := app.status()
	writeJSON(w, status, err)
}

func (a App) handleCreatePath(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	var req CreatePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}

	path, err := app.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if isGitPath(path) {
		writeJSON(w, nil, errors.New("cannot modify .git paths"))
		return
	}

	fullPath := filepath.Join(app.root, path)
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

	status, err := app.status()
	writeJSON(w, status, err)
}

func (a App) handleDeletePath(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	var req DeletePathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}
	if !req.Confirm {
		writeJSON(w, nil, errors.New("delete confirmation is required"))
		return
	}

	path, err := app.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	if isGitPath(path) {
		writeJSON(w, nil, errors.New("cannot modify .git paths"))
		return
	}

	fullPath := filepath.Join(app.root, path)
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

	status, err := app.status()
	writeJSON(w, status, err)
}

func (a App) handleRestoreStaged(w http.ResponseWriter, r *http.Request) {
	app, err := a.appForRequest(r)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}
	var req StageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, nil, err)
		return
	}

	path, err := app.cleanPath(req.Path)
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	status, err := app.unstage(path)
	writeJSON(w, status, err)
}
