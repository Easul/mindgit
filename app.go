package main

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type App struct {
	root           string
	projects       []ProjectSummary
	projectByKey   map[string]ProjectSummary
	defaultProject string
	terminals      *TerminalManager
	monitor        *RuntimeMonitor
	auth           *AuthManager
	ssh            SSHConfig
	sshName        string
	vaultKey       []byte
	cache          *ProjectCache
	requestContext context.Context
	commandTimeout time.Duration
	maxUploadBytes int64
}

type ProjectSummary struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Root    string `json:"root"`
	Remote  bool   `json:"remote,omitempty"`
	SSHName string `json:"sshName,omitempty"`
}

type ProjectsResponse struct {
	Projects       []ProjectSummary `json:"projects"`
	DefaultProject string           `json:"defaultProject"`
}

func buildProjects(roots []string, ssh SSHConfig) []ProjectSummary {
	projects := make([]ProjectSummary, 0, len(roots)+len(ssh.Connections))
	for _, root := range roots {
		name := filepath.Base(root)
		if name == "." || name == string(filepath.Separator) || name == "" {
			name = root
		}
		projects = append(projects, ProjectSummary{
			Key:  root,
			Name: "local / " + name,
			Root: root,
		})
	}
	for _, connection := range ssh.Connections {
		if connection.TerminalOnly {
			continue
		}
		for _, remotePath := range connection.Paths {
			projects = append(projects, ProjectSummary{
				Key:     "ssh:" + connection.Name + ":" + remotePath.Name,
				Name:    connection.Name + " / " + remotePath.Name,
				Root:    remotePath.Path,
				Remote:  true,
				SSHName: connection.Name,
			})
		}
	}
	return projects
}

func projectMap(projects []ProjectSummary) map[string]ProjectSummary {
	byKey := make(map[string]ProjectSummary, len(projects))
	for _, project := range projects {
		byKey[project.Key] = project
	}
	return byKey
}

func (a App) handleProjects(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, ProjectsResponse{
		Projects:       a.projects,
		DefaultProject: a.defaultProject,
	}, nil)
}

func (a App) appForRequest(r *http.Request) (App, error) {
	key := strings.TrimSpace(r.URL.Query().Get("project"))
	if key == "" {
		key = a.defaultProject
	}
	project, ok := a.projectByKey[key]
	if !ok {
		return App{}, fmt.Errorf("unknown project: %s", key)
	}

	var vaultKey []byte
	if project.Remote {
		var unlocked bool
		vaultKey, unlocked = a.auth.vaultKey(r)
		if !unlocked {
			return App{}, fmt.Errorf("SSH key vault is locked")
		}
	}
	return App{
		root:           project.Root,
		projects:       a.projects,
		projectByKey:   a.projectByKey,
		defaultProject: project.Key,
		terminals:      a.terminals,
		monitor:        a.monitor,
		auth:           a.auth,
		ssh:            a.ssh,
		sshName:        project.SSHName,
		vaultKey:       vaultKey,
		cache:          a.cache,
		requestContext: r.Context(),
		commandTimeout: a.commandTimeout,
		maxUploadBytes: a.maxUploadBytes,
	}, nil
}

func (a App) currentProject() ProjectSummary {
	if project, ok := a.projectByKey[a.defaultProject]; ok {
		return project
	}
	return ProjectSummary{
		Key:  a.root,
		Name: filepath.Base(a.root),
		Root: a.root,
	}
}

func (a App) uploadLimit() int64 {
	if a.maxUploadBytes > 0 {
		return a.maxUploadBytes
	}
	return defaultMaxUploadMB << 20
}
