package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	config, err := parseConfig(os.Args[1:])
	if err != nil {
		log.Fatal(err)
	}
	if len(config.roots) == 0 {
		return
	}
	if err := validateSSHConfig(config.ssh); err != nil {
		log.Fatal(err)
	}
	dependencies, err := checkDependencies(config)
	if err != nil {
		log.Fatal(err)
	}
	for _, dependency := range dependencies.Optional {
		log.Printf("Optional command not found: %s", dependency)
	}
	projects := buildProjects(config.roots, config.ssh)
	var monitor *RuntimeMonitor
	if config.monitoring.Enabled {
		monitor = NewRuntimeMonitor()
	}
	app := App{
		root:           config.roots[0],
		projects:       projects,
		projectByKey:   projectMap(projects),
		defaultProject: projects[0].Key,
		terminals:      NewTerminalManager(),
		monitor:        monitor,
		ssh:            config.ssh,
		cache:          NewProjectCache(),
	}
	auth := NewAuthManager(config.auth, config.ssh.VaultSalt)
	app.auth = auth
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth/status", auth.handleStatus)
	mux.HandleFunc("POST /api/auth/login", auth.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", auth.handleLogout)
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
	mux.HandleFunc("GET /api/runtime/stats", app.handleRuntimeStats)
	mux.HandleFunc("GET /api/ssh/connections", app.handleSSHConnections)
	mux.Handle("/", staticHandler())

	addr := net.JoinHostPort(config.host, strconv.Itoa(config.port))
	log.Printf("MindGit serving %d project(s) at http://%s", len(config.roots), addr)
	if config.host != "127.0.0.1" && config.host != "localhost" && config.host != "::1" {
		log.Printf("Security notice: use HTTPS through a trusted reverse proxy when exposing MindGit beyond localhost")
	}
	server := &http.Server{
		Addr:              addr,
		Handler:           securityHeaders(auth.middleware(mux)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
