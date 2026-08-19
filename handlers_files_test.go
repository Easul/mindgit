package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testRequestApp(root string) App {
	projects := buildProjects([]string{root}, SSHConfig{})
	return App{
		root:           root,
		projects:       projects,
		projectByKey:   projectMap(projects),
		defaultProject: projects[0].Key,
	}
}

func TestHandlePDFFileSupportsRanges(t *testing.T) {
	root := t.TempDir()
	content := []byte("%PDF-1.7\n0123456789\n%%EOF")
	if err := os.WriteFile(filepath.Join(root, "sample.pdf"), content, 0o644); err != nil {
		t.Fatal(err)
	}

	request := newTestRequest(t, http.MethodGet, "/api/pdf?path=sample.pdf", nil)
	request.Header.Set("Range", "bytes=9-13")
	response := newTestResponse()
	testRequestApp(root).handlePDFFile(response, request)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusPartialContent, response.Body.String())
	}
	if got := response.Body.String(); got != "01234" {
		t.Fatalf("range body = %q, want %q", got, "01234")
	}
	if got := response.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("Content-Type = %q, want application/pdf", got)
	}
}

func TestHandlePDFFileRejectsFilesOverLimit(t *testing.T) {
	root := t.TempDir()
	file, err := os.Create(filepath.Join(root, "large.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxPDFPreviewSize + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	testRequestApp(root).handlePDFFile(response, newTestRequest(t, http.MethodGet, "/api/pdf?path=large.pdf", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if !strings.Contains(response.Body.String(), "limited to 40 MB") {
		t.Fatalf("unexpected body: %s", response.Body.String())
	}
}

func TestHandleReadFileRejectsBinaryContentWithUnknownExtension(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "unknown.data"), []byte{'M', 'G', 0, 1, 2}, 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	testRequestApp(root).handleReadFile(response, newTestRequest(t, http.MethodGet, "/api/file?path=unknown.data", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "binary files cannot be previewed") {
		t.Fatalf("unexpected body: %s", response.Body.String())
	}
}

func TestHandleReadFileRejectsOversizedTextBeforeReading(t *testing.T) {
	root := t.TempDir()
	file, err := os.Create(filepath.Join(root, "large.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxTextPreviewSize + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	testRequestApp(root).handleReadFile(response, newTestRequest(t, http.MethodGet, "/api/file?path=large.txt", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "text preview is limited to 8 MB") {
		t.Fatalf("unexpected body: %s", response.Body.String())
	}
}

func TestExternalFileOpenReadAndSave(t *testing.T) {
	root := t.TempDir()
	externalPath := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(externalPath, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := testRequestApp(root)
	encodedPath := url.QueryEscape(externalPath)

	openResponse := newTestResponse()
	app.handleOpenFile(openResponse, newTestRequest(t, http.MethodGet, "/api/fs?path="+encodedPath, nil))
	if openResponse.Code != http.StatusOK {
		t.Fatalf("open status = %d; body=%s", openResponse.Code, openResponse.Body.String())
	}
	var opened OpenFileResponse
	if err := json.NewDecoder(&openResponse.Body).Decode(&opened); err != nil {
		t.Fatal(err)
	}
	if !opened.External || opened.Path != externalPath || !opened.Writable {
		t.Fatalf("opened = %#v", opened)
	}

	readResponse := newTestResponse()
	app.handleReadFile(readResponse, newTestRequest(t, http.MethodGet, "/api/file?external=1&path="+encodedPath, nil))
	if readResponse.Code != http.StatusOK || !strings.Contains(readResponse.Body.String(), "outside") {
		t.Fatalf("read status = %d; body=%s", readResponse.Code, readResponse.Body.String())
	}

	saveResponse := newTestResponse()
	body := strings.NewReader(fmt.Sprintf(`{"path":%q,"content":"updated"}`, externalPath))
	app.handleSaveFile(saveResponse, newTestRequest(t, http.MethodPost, "/api/file?external=1", body))
	if saveResponse.Code != http.StatusOK {
		t.Fatalf("save status = %d; body=%s", saveResponse.Code, saveResponse.Body.String())
	}
	content, err := os.ReadFile(externalPath)
	if err != nil || string(content) != "updated" {
		t.Fatalf("saved content = %q, %v", content, err)
	}
}

func TestExternalReadOnlyFileCannotBeSaved(t *testing.T) {
	root := t.TempDir()
	externalPath := filepath.Join(t.TempDir(), "readonly.txt")
	if err := os.WriteFile(externalPath, []byte("readonly"), 0o444); err != nil {
		t.Fatal(err)
	}
	app := testRequestApp(root)
	body := strings.NewReader(fmt.Sprintf(`{"path":%q,"content":"changed"}`, externalPath))
	response := newTestResponse()
	app.handleSaveFile(response, newTestRequest(t, http.MethodPost, "/api/file?external=1", body))
	if response.Code == http.StatusOK || !strings.Contains(response.Body.String(), "read-only") {
		t.Fatalf("save status = %d; body=%s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(externalPath)
	if err != nil || string(content) != "readonly" {
		t.Fatalf("read-only content = %q, %v", content, err)
	}
}

func TestHandleUploadFileWritesAtomically(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	testRequestApp(root).handleUploadFile(response, newTestRequest(t, http.MethodPost, "/api/upload?dir=docs&name=notes.txt", strings.NewReader("hello")))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(filepath.Join(root, "docs", "notes.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "hello" {
		t.Fatalf("content = %q, want hello", content)
	}
	var result UploadResponse
	if err := json.NewDecoder(&response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Path != "docs/notes.txt" || result.Size != 5 {
		t.Fatalf("unexpected response: %#v", result)
	}
	assertNoUploadParts(t, filepath.Join(root, "docs"))
}

func TestHandleUploadFileRemovesPartialFileOnFailure(t *testing.T) {
	root := t.TempDir()
	response := newTestResponse()
	body := &failingReader{data: []byte("partial"), err: errors.New("upload interrupted")}
	testRequestApp(root).handleUploadFile(response, newTestRequest(t, http.MethodPost, "/api/upload?name=broken.txt", body))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	if _, err := os.Stat(filepath.Join(root, "broken.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("partial target exists or stat failed: %v", err)
	}
	assertNoUploadParts(t, root)
}

func TestHandleUploadFileRejectsExistingPath(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "existing.txt")
	if err := os.WriteFile(target, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	testRequestApp(root).handleUploadFile(response, newTestRequest(t, http.MethodPost, "/api/upload?name=existing.txt", strings.NewReader("new")))
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	content, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old" {
		t.Fatalf("existing content changed to %q", content)
	}
}

func TestHandleUploadFileRejectsBodyOverLimit(t *testing.T) {
	root := t.TempDir()
	app := testRequestApp(root)
	app.maxUploadBytes = 4

	response := newTestResponse()
	app.handleUploadFile(response, newTestRequest(t, http.MethodPost, "/api/upload?name=large.txt", strings.NewReader("12345")))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusRequestEntityTooLarge, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "large.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oversized upload created a file: %v", err)
	}
	assertNoUploadParts(t, root)
}

func TestHandleCreatePathRejectsUnknownJSONFields(t *testing.T) {
	root := t.TempDir()
	response := newTestResponse()
	testRequestApp(root).handleCreatePath(response, newTestRequest(t, http.MethodPost, "/api/fs", strings.NewReader(
		`{"path":"new.txt","kind":"file","unexpected":true}`,
	)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "new.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid request created a file: %v", err)
	}
}

func TestHandleSaveFileRejectsContentOverLimit(t *testing.T) {
	root := t.TempDir()
	app := testRequestApp(root)
	app.maxUploadBytes = 4
	response := newTestResponse()
	app.handleSaveFile(response, newTestRequest(t, http.MethodPost, "/api/file", strings.NewReader(
		`{"path":"large.txt","content":"12345","create":true}`,
	)))
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d; body=%s", response.Code, http.StatusRequestEntityTooLarge, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "large.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oversized save created a file: %v", err)
	}
}

func TestHandleSaveFileCreatesNewFileExclusively(t *testing.T) {
	root := t.TempDir()
	app := testRequestApp(root)

	response := newTestResponse()
	body := strings.NewReader(`{"path":"notes/临时.txt","content":"临时内容","create":true}`)
	app.handleSaveFile(response, newTestRequest(t, http.MethodPost, "/api/file", body))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(filepath.Join(root, "notes", "临时.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "临时内容" {
		t.Fatalf("content = %q, want 临时内容", content)
	}

	response = newTestResponse()
	body = strings.NewReader(`{"path":"notes/临时.txt","content":"覆盖","create":true}`)
	app.handleSaveFile(response, newTestRequest(t, http.MethodPost, "/api/file", body))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	content, err = os.ReadFile(filepath.Join(root, "notes", "临时.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "临时内容" {
		t.Fatalf("existing content changed to %q", content)
	}
}

func TestHandleRenamePathRenamesFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "old.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	body := strings.NewReader(`{"path":"old.txt","name":"新名字.txt"}`)
	testRequestApp(root).handleRenamePath(response, newTestRequest(t, http.MethodPatch, "/api/fs", body))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	content, err := os.ReadFile(filepath.Join(root, "新名字.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "hello" {
		t.Fatalf("content = %q, want hello", content)
	}
	if _, err := os.Stat(filepath.Join(root, "old.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old path still exists or stat failed: %v", err)
	}
}

func TestHandleRenamePathRenamesDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "old", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "old", "nested", "file.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	body := strings.NewReader(`{"path":"old","name":"new"}`)
	testRequestApp(root).handleRenamePath(response, newTestRequest(t, http.MethodPatch, "/api/fs", body))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "new", "nested", "file.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestHandleRenamePathRejectsInvalidOrExistingName(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"old.txt", "existing.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	tests := []string{
		`{"path":"old.txt","name":"existing.txt"}`,
		`{"path":"old.txt","name":"nested/new.txt"}`,
		`{"path":"old.txt","name":".git"}`,
	}
	for _, body := range tests {
		response := newTestResponse()
		testRequestApp(root).handleRenamePath(response, newTestRequest(t, http.MethodPatch, "/api/fs", strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want %d; response=%s", body, response.Code, http.StatusBadRequest, response.Body.String())
		}
	}
}

func TestHandleMovePathMovesFileToRelativeDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "archive"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	body := strings.NewReader(`{"path":"notes.txt","destination":"archive"}`)
	testRequestApp(root).handleMovePath(response, newTestRequest(t, http.MethodPut, "/api/fs", body))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	var result MovePathResponse
	if err := json.NewDecoder(&response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Path != "archive/notes.txt" {
		t.Fatalf("path = %q", result.Path)
	}
	content, err := os.ReadFile(filepath.Join(root, "archive", "notes.txt"))
	if err != nil || string(content) != "hello" {
		t.Fatalf("moved content = %q, %v", content, err)
	}
}

func TestHandleMovePathMovesDirectoryToAbsoluteProjectPath(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "source", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "target"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "source", "nested", "file.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	response := newTestResponse()
	body := strings.NewReader(fmt.Sprintf(`{"path":"source","destination":%q}`, filepath.Join(root, "target")))
	testRequestApp(root).handleMovePath(response, newTestRequest(t, http.MethodPut, "/api/fs", body))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, "target", "source", "nested", "file.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestHandleMovePathRejectsUnsafeDestinations(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder", "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "file.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "outside-link")); err != nil {
		t.Fatal(err)
	}

	tests := []string{
		fmt.Sprintf(`{"path":"file.txt","destination":%q}`, outside),
		`{"path":"file.txt","destination":"outside-link"}`,
		`{"path":"folder","destination":"folder/child"}`,
		`{"path":"file.txt","destination":".git"}`,
		`{"path":"file.txt","destination":"."}`,
	}
	for _, body := range tests {
		response := newTestResponse()
		testRequestApp(root).handleMovePath(response, newTestRequest(t, http.MethodPut, "/api/fs", strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want %d; response=%s", body, response.Code, http.StatusBadRequest, response.Body.String())
		}
	}
	if _, err := os.Stat(filepath.Join(root, "file.txt")); err != nil {
		t.Fatalf("source changed after rejected move: %v", err)
	}
}

func assertNoUploadParts(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".mindgit-upload-") {
			t.Fatalf("temporary upload remains: %s", entry.Name())
		}
	}
}

type failingReader struct {
	data []byte
	err  error
}

func (r *failingReader) Read(buffer []byte) (int, error) {
	if len(r.data) > 0 {
		n := copy(buffer, r.data)
		r.data = r.data[n:]
		return n, nil
	}
	return 0, r.err
}

type testResponse struct {
	header http.Header
	Body   bytes.Buffer
	Code   int
}

func newTestResponse() *testResponse {
	return &testResponse{header: make(http.Header), Code: http.StatusOK}
}

func (r *testResponse) Header() http.Header { return r.header }

func (r *testResponse) WriteHeader(status int) { r.Code = status }

func (r *testResponse) Write(data []byte) (int, error) { return r.Body.Write(data) }

func newTestRequest(t *testing.T, method, target string, body interface{ Read([]byte) (int, error) }) *http.Request {
	t.Helper()
	request, err := http.NewRequest(method, target, body)
	if err != nil {
		t.Fatal(err)
	}
	return request
}
