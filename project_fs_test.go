package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestRemoteProjectCoreOperations(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init"}, {"config", "user.email", "test@example.com"}, {"config", "user.name", "Test"}, {"add", "README.md"}, {"commit", "-m", "initial"}} {
		command := exec.Command("git", args...)
		command.Dir = root
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}

	bin := t.TempDir()
	sshPath := filepath.Join(bin, "ssh")
	fakeSSH := `#!/bin/sh
[ -n "$SSH_LOG" ] && printf 'call\n' >> "$SSH_LOG"
last=
for argument do last=$argument; done
exec sh -c "$last"
`
	if err := os.WriteFile(sshPath, []byte(fakeSSH), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	sshLog := filepath.Join(t.TempDir(), "ssh.log")
	t.Setenv("SSH_LOG", sshLog)
	dataDir := t.TempDir()
	app := App{
		root:     root,
		sshName:  "remote",
		vaultKey: bytes.Repeat([]byte{1}, 32),
		ssh: SSHConfig{
			DataDir:    dataDir,
			KnownHosts: filepath.Join(dataDir, "known_hosts"),
			Connections: []SSHConnectionConfig{{
				Name: "remote", Host: "example.invalid", User: "tester", Paths: []SSHPathConfig{{Name: "root", Path: root}},
			}},
		},
		cache: NewProjectCache(),
	}
	if !app.isGitRepository() {
		t.Fatal("remote project was not detected as a Git repository")
	}
	entries, err := app.listProjectDirectory("")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("remote project tree is empty")
	}
	gitAvailable, changes, err := app.loadGitChanges()
	if err != nil || !gitAvailable {
		t.Fatalf("load remote Git changes: available=%v err=%v", gitAvailable, err)
	}
	before, err := os.ReadFile(sshLog)
	if err != nil {
		t.Fatal(err)
	}
	gitAvailable, changes, err = app.loadGitChangesCached()
	if err != nil || !gitAvailable {
		t.Fatalf("load cached remote Git changes: available=%v err=%v", gitAvailable, err)
	}
	if _, err := app.treeEntries("", changes, gitAvailable); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(sshLog)
	if err != nil {
		t.Fatal(err)
	}
	if delta := bytes.Count(after, []byte("call\n")) - bytes.Count(before, []byte("call\n")); delta != 1 {
		t.Fatalf("cached tree expansion used %d SSH calls, want 1", delta)
	}
	content, err := app.readProjectFile("README.md")
	if err != nil || string(content) != "hello\n" {
		t.Fatalf("read remote file: %q, %v", content, err)
	}
	if err := app.writeProjectFile("README.md", []byte("updated\n"), false); err != nil {
		t.Fatal(err)
	}
	if err := app.createRemotePath("docs/new.txt", "file"); err != nil {
		t.Fatal(err)
	}
	if err := app.renameRemotePath("docs/new.txt", "docs/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	if err := app.createRemotePath("archive", "dir"); err != nil {
		t.Fatal(err)
	}
	if err := app.moveRemotePath("docs/renamed.txt", "archive", "archive/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	if err := app.deleteRemotePath("archive/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "docs", "renamed.txt")); !os.IsNotExist(err) {
		t.Fatalf("remote delete did not remove file: %v", err)
	}
	externalPath := filepath.Join(t.TempDir(), "external.txt")
	if err := os.WriteFile(externalPath, []byte("external\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opened, err := app.resolveOpenFilePath(externalPath)
	if err != nil {
		t.Fatal(err)
	}
	if !opened.External || opened.Path != externalPath || !opened.Writable {
		t.Fatalf("remote external file = %#v", opened)
	}
	externalContent, err := app.readRequestedFile(externalPath, true)
	if err != nil || string(externalContent) != "external\n" {
		t.Fatalf("read remote external file: %q, %v", externalContent, err)
	}
	if err := app.writeRequestedFile(externalPath, []byte("updated external\n"), true); err != nil {
		t.Fatal(err)
	}
}
