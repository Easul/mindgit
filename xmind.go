package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type XMindResponse struct {
	Path    string `json:"path"`
	Content any    `json:"content"`
}

func (a App) handleXMindFile(w http.ResponseWriter, r *http.Request) {
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
	if strings.ToLower(filepath.Ext(path)) != ".xmind" {
		writeJSON(w, nil, errors.New("file is not an xmind file"))
		return
	}

	content, err := os.ReadFile(filepath.Join(app.root, path))
	if err != nil {
		writeJSON(w, nil, err)
		return
	}

	parsed, err := parseXMindContent(content)
	writeJSON(w, XMindResponse{Path: path, Content: parsed}, err)
}

func parseXMindContent(content []byte) (any, error) {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return nil, err
	}

	for _, file := range reader.File {
		if file.Name != "content.json" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()

		var parsed any
		if err := json.NewDecoder(rc).Decode(&parsed); err != nil {
			return nil, err
		}
		return parsed, nil
	}

	return nil, errors.New("xmind content.json not found")
}
