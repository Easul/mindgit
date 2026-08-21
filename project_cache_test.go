package main

import (
	"testing"
	"time"
)

func TestProjectCacheReturnsIndependentSnapshot(t *testing.T) {
	cache := NewProjectCache()
	files := []ChangedFile{{Path: "one.txt", Status: "M"}}
	cache.storeGit("ssh:test", true, files)
	gitAvailable, cached, ok := cache.loadGit("ssh:test", remoteGitSnapshotTTL)
	if !ok || !gitAvailable || len(cached) != 1 {
		t.Fatalf("unexpected cache result: available=%v files=%#v ok=%v", gitAvailable, cached, ok)
	}
	cached[0].Path = "changed.txt"
	_, cachedAgain, ok := cache.loadGit("ssh:test", remoteGitSnapshotTTL)
	if !ok || cachedAgain[0].Path != "one.txt" {
		t.Fatalf("cache snapshot was mutated: %#v", cachedAgain)
	}
}

func TestProjectCacheExpiresOldSnapshot(t *testing.T) {
	cache := NewProjectCache()
	cache.gitSnapshots["ssh:test"] = gitSnapshot{created: time.Now().Add(-remoteGitSnapshotTTL - time.Second)}
	if _, _, ok := cache.loadGit("ssh:test", remoteGitSnapshotTTL); ok {
		t.Fatal("expected old snapshot to expire")
	}
}

func TestProjectCacheReturnsStatusSnapshot(t *testing.T) {
	cache := NewProjectCache()
	status := StatusResponse{
		Root:  "/tmp/project",
		Files: []ChangedFile{{Path: "one.txt", Status: "M"}},
	}
	cache.storeStatus("local", status)
	cached, ok := cache.loadStatus("local")
	if !ok || len(cached.Files) != 1 {
		t.Fatalf("unexpected status cache result: %#v, ok=%v", cached, ok)
	}
	cached.Files[0].Path = "changed.txt"
	cachedAgain, ok := cache.loadStatus("local")
	if !ok || cachedAgain.Files[0].Path != "one.txt" {
		t.Fatalf("status cache snapshot was mutated: %#v", cachedAgain)
	}
}
