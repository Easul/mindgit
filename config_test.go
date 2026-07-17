package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestParseConfigVersion(t *testing.T) {
	originalVersion := version
	version = "v1.2.3"
	t.Cleanup(func() { version = originalVersion })

	for _, args := range [][]string{{"-v"}, {"--version"}, {"version"}} {
		t.Run(args[0], func(t *testing.T) {
			var config Config
			var parseErr error
			output := captureStdout(t, func() {
				config, parseErr = parseConfig(args)
			})
			if parseErr != nil {
				t.Fatalf("parseConfig(%q): %v", args, parseErr)
			}
			if len(config.roots) != 0 {
				t.Fatalf("parseConfig(%q) roots = %q, want none", args, config.roots)
			}
			if output != "mindgit v1.2.3\n" {
				t.Fatalf("parseConfig(%q) output = %q", args, output)
			}
		})
	}
}

func TestParseConfigLoadsFileAndAllowsCLIOverrides(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(t.TempDir(), "config.json")
	passwordHash, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	fileConfig := defaultFileConfig()
	fileConfig.Server = ServerConfig{Bind: "0.0.0.0", Port: 9000}
	fileConfig.Auth.PasswordHash = passwordHash
	fileConfig.Projects = []ProjectConfig{{Path: root}}
	content, err := json.Marshal(fileConfig)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		t.Fatal(err)
	}

	config, err := parseConfig([]string{"--config", configPath, "--bind", "127.0.0.1", "--port", "9898"})
	if err != nil {
		t.Fatal(err)
	}
	if config.host != "127.0.0.1" || config.port != 9898 {
		t.Fatalf("unexpected server config: %s:%d", config.host, config.port)
	}
	if len(config.roots) != 1 || config.roots[0] != root {
		t.Fatalf("roots = %#v, want %q", config.roots, root)
	}
}

func TestDefaultConfigAndDataNames(t *testing.T) {
	if filepath.Base(defaultConfigPath()) != "config.json" {
		t.Fatalf("default config = %q", defaultConfigPath())
	}
	resolved := resolveSSHPaths(filepath.Join(t.TempDir(), "config.json"), SSHConfig{})
	if filepath.Base(resolved.DataDir) != "data" {
		t.Fatalf("default data dir = %q", resolved.DataDir)
	}
}

func TestResolveSSHPathsMigratesRemoteDir(t *testing.T) {
	resolved := resolveSSHPaths(filepath.Join(t.TempDir(), "config.json"), SSHConfig{
		Connections: []SSHConnectionConfig{{Name: "server", RemoteDir: "/srv/app"}},
	})
	paths := resolved.Connections[0].Paths
	if len(paths) != 1 || paths[0].Name != "app" || paths[0].Path != "/srv/app" {
		t.Fatalf("migrated paths = %#v", paths)
	}
}

func captureStdout(t *testing.T, run func()) string {
	t.Helper()

	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	t.Cleanup(func() { os.Stdout = original })

	run()
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	os.Stdout = original
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	return string(output)
}
