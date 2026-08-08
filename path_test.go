package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanOptionalPath(t *testing.T) {
	app := App{}
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "empty", input: "", want: ""},
		{name: "relative", input: "web/../main.go", want: "main.go"},
		{name: "parent", input: "../outside", wantErr: true},
		{name: "absolute", input: "/tmp/outside", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := app.cleanOptionalPath(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("cleanOptionalPath(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("cleanOptionalPath(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestResolveOpenFilePath(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "docs", "notes.txt")
	if err := os.WriteFile(file, []byte("notes"), 0o644); err != nil {
		t.Fatal(err)
	}
	app := App{root: root}

	for _, input := range []string{"docs/notes.txt", file} {
		got, err := app.resolveOpenFilePath(input)
		if err != nil {
			t.Fatalf("resolveOpenFilePath(%q): %v", input, err)
		}
		if got.Path != "docs/notes.txt" || got.External {
			t.Fatalf("resolveOpenFilePath(%q) = %#v", input, got)
		}
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := app.resolveOpenFilePath(outside)
	if err != nil {
		t.Fatal(err)
	}
	if got.Path != outside || !got.External || !got.Writable {
		t.Fatalf("external resolve = %#v", got)
	}
	readOnly := filepath.Join(t.TempDir(), "readonly.txt")
	if err := os.WriteFile(readOnly, []byte("readonly"), 0o444); err != nil {
		t.Fatal(err)
	}
	readOnlyResult, err := app.resolveOpenFilePath(readOnly)
	if err != nil {
		t.Fatal(err)
	}
	if !readOnlyResult.External || readOnlyResult.Writable {
		t.Fatalf("read-only resolve = %#v", readOnlyResult)
	}

	if _, err := app.resolveOpenFilePath(root); err == nil {
		t.Fatal("resolveOpenFilePath(directory) succeeded, want error")
	}
	if _, err := app.resolveOpenFilePath(filepath.Join(root, "missing.txt")); err == nil {
		t.Fatal("resolveOpenFilePath(missing file) succeeded, want error")
	}
}

func TestRelativeSlashPath(t *testing.T) {
	tests := map[string]string{
		"/srv/app|/srv/app/docs/readme.md": "docs/readme.md",
		"/srv/app|/srv/shared/config.yml":  "../shared/config.yml",
		"/|/etc/hosts":                     "etc/hosts",
		"/srv/app|/srv/app":                ".",
	}
	for input, want := range tests {
		base, target, _ := strings.Cut(input, "|")
		if got := relativeSlashPath(base, target); got != want {
			t.Fatalf("relativeSlashPath(%q, %q) = %q, want %q", base, target, got, want)
		}
	}
}
