package main

import (
	"testing"
	"time"
)

func TestProjectCacheReturnsIndependentSnapshot(t *testing.T) {
	cache := NewProjectCache()
	files := []ChangedFile{{Path: "one.txt", Status: "M"}}
	cache.storeGit("ssh:test", true, files)
	gitAvailable, cached, ok := cache.loadGit("ssh:test")
	if !ok || !gitAvailable || len(cached) != 1 {
		t.Fatalf("unexpected cache result: available=%v files=%#v ok=%v", gitAvailable, cached, ok)
	}
	cached[0].Path = "changed.txt"
	_, cachedAgain, ok := cache.loadGit("ssh:test")
	if !ok || cachedAgain[0].Path != "one.txt" {
		t.Fatalf("cache snapshot was mutated: %#v", cachedAgain)
	}
}

func TestProjectCacheExpiresOldSnapshot(t *testing.T) {
	cache := NewProjectCache()
	cache.gitSnapshots["ssh:test"] = gitSnapshot{created: time.Now().Add(-remoteGitSnapshotTTL - time.Second)}
	if _, _, ok := cache.loadGit("ssh:test"); ok {
		t.Fatal("expected old snapshot to expire")
	}
}
