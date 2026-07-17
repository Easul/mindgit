package main

import (
	"sync"
	"time"
)

const remoteGitSnapshotTTL = 15 * time.Second

type ProjectCache struct {
	mu           sync.Mutex
	gitSnapshots map[string]gitSnapshot
}

type gitSnapshot struct {
	created      time.Time
	gitAvailable bool
	files        []ChangedFile
}

func NewProjectCache() *ProjectCache {
	return &ProjectCache{gitSnapshots: make(map[string]gitSnapshot)}
}

func (c *ProjectCache) loadGit(projectKey string) (bool, []ChangedFile, bool) {
	if c == nil {
		return false, nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	snapshot, ok := c.gitSnapshots[projectKey]
	if !ok || time.Since(snapshot.created) > remoteGitSnapshotTTL {
		return false, nil, false
	}
	return snapshot.gitAvailable, append([]ChangedFile(nil), snapshot.files...), true
}

func (c *ProjectCache) storeGit(projectKey string, gitAvailable bool, files []ChangedFile) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.gitSnapshots[projectKey] = gitSnapshot{
		created:      time.Now(),
		gitAvailable: gitAvailable,
		files:        append([]ChangedFile(nil), files...),
	}
	c.mu.Unlock()
}
