package main

import "testing"

func TestBuildProjectsLabelsLocalAndSSHPaths(t *testing.T) {
	projects := buildProjects([]string{"/work/local-project"}, SSHConfig{Connections: []SSHConnectionConfig{{
		Name: "production",
		Paths: []SSHPathConfig{
			{Name: "app", Path: "/srv/app"},
			{Name: "logs", Path: "/var/log/app"},
		},
	}}})
	if len(projects) != 3 {
		t.Fatalf("projects = %#v", projects)
	}
	if projects[0].Name != "local / local-project" || projects[1].Name != "production / app" || projects[2].Name != "production / logs" {
		t.Fatalf("project names = %#v", []string{projects[0].Name, projects[1].Name, projects[2].Name})
	}
}
