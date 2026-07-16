//go:build compressedassets

package main

import (
	"bytes"
	"compress/gzip"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// The release build generates this directory before compiling. Only the
// compressed copies are embedded, so release binaries do not contain the raw
// web assets as well.
//
//go:embed temp/release-web
var compressedWebFS embed.FS

type compressedStaticHandler struct {
	files fs.FS
}

func staticHandler() http.Handler {
	sub, err := fs.Sub(compressedWebFS, "temp/release-web")
	if err != nil {
		panic(err)
	}
	return compressedStaticHandler{files: sub}
}

func (h compressedStaticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	} else if strings.HasSuffix(r.URL.Path, "/") {
		name = path.Join(name, "index.html")
	}
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}

	file, err := h.files.Open(name + ".gz")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	w.Header().Set("Vary", "Accept-Encoding")
	if acceptsGzip(r.Header.Get("Accept-Encoding")) {
		seeker, ok := file.(io.ReadSeeker)
		if !ok {
			http.Error(w, "embedded asset is not seekable", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		http.ServeContent(w, r, name, time.Time{}, seeker)
		return
	}

	reader, err := gzip.NewReader(file)
	if err != nil {
		http.Error(w, "invalid embedded asset", http.StatusInternalServerError)
		return
	}
	content, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil {
		http.Error(w, "invalid embedded asset", http.StatusInternalServerError)
		return
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(content))
}

func acceptsGzip(header string) bool {
	wildcardAccepted := false
	for _, value := range strings.Split(header, ",") {
		parts := strings.Split(value, ";")
		encoding := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, raw, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if err != nil {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if encoding == "gzip" {
			return quality > 0
		}
		if encoding == "*" {
			wildcardAccepted = quality > 0
		}
	}
	return wildcardAccepted
}
