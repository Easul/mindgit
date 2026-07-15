package main

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
)

type App struct {
	root           string
	projects       []ProjectSummary
	projectByKey   map[string]ProjectSummary
	defaultProject string
	terminals      *TerminalManager
}

type ProjectSummary struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Root string `json:"root"`
}

type ProjectsResponse struct {
	Projects       []ProjectSummary `json:"projects"`
	DefaultProject string           `json:"defaultProject"`
}

func buildProjects(roots []string) []ProjectSummary {
	projects := make([]ProjectSummary, 0, len(roots))
	for _, root := range roots {
		name := filepath.Base(root)
		if name == "." || name == string(filepath.Separator) || name == "" {
			name = root
		}
		projects = append(projects, ProjectSummary{
			Key:  root,
			Name: name,
			Root: root,
		})
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

	return App{
		root:           project.Root,
		projects:       a.projects,
		projectByKey:   a.projectByKey,
		defaultProject: project.Key,
		terminals:      a.terminals,
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
