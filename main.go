package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
)

func main() {
	config, err := parseConfig(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	if len(config.roots) == 0 {
		return
	}
	projects := buildProjects(config.roots)
	app := App{
		root:           config.roots[0],
		projects:       projects,
		projectByKey:   projectMap(projects),
		defaultProject: projects[0].Key,
		terminals:      NewTerminalManager(),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/projects", app.handleProjects)
	mux.HandleFunc("GET /api/status", app.handleStatus)
	mux.HandleFunc("GET /api/diff", app.handleDiff)
	mux.HandleFunc("GET /api/file", app.handleReadFile)
	mux.HandleFunc("GET /api/pdf", app.handlePDFFile)
	mux.HandleFunc("GET /api/download", app.handleDownload)
	mux.HandleFunc("GET /api/xmind", app.handleXMindFile)
	mux.HandleFunc("POST /api/file", app.handleSaveFile)
	mux.HandleFunc("POST /api/upload", app.handleUploadFile)
	mux.HandleFunc("POST /api/fs", app.handleCreatePath)
	mux.HandleFunc("PATCH /api/fs", app.handleRenamePath)
	mux.HandleFunc("DELETE /api/fs", app.handleDeletePath)
	mux.HandleFunc("DELETE /api/stage", app.handleRestoreStaged)
	mux.HandleFunc("GET /api/search", app.handleSearch)
	mux.HandleFunc("GET /api/tree", app.handleTree)
	mux.HandleFunc("GET /api/tree-batch", app.handleTreeBatch)
	mux.HandleFunc("POST /api/tree-batch", app.handleTreeBatch)
	mux.HandleFunc("GET /api/commits", app.handleCommits)
	mux.HandleFunc("GET /api/commit", app.handleCommit)
	mux.HandleFunc("GET /api/commit-diff", app.handleCommitDiff)
	mux.HandleFunc("GET /api/terminal", app.handleTerminal)
	mux.HandleFunc("GET /api/terminals", app.handleTerminals)
	mux.HandleFunc("DELETE /api/terminal", app.handleDeleteTerminal)
	mux.Handle("/", staticHandler())

	addr := net.JoinHostPort(config.host, strconv.Itoa(config.port))
	log.Printf("MindGit serving %d project(s) at http://%s", len(config.roots), addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
