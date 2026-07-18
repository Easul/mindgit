package main

import (
	"sync"
	"time"
)

const (
	localGitSnapshotTTL  = time.Second
	remoteGitSnapshotTTL = 15 * time.Second
)

type ProjectCache struct {
	mu           sync.RWMutex
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

func (c *ProjectCache) loadGit(projectKey string, ttl time.Duration) (bool, []ChangedFile, bool) {
	if c == nil {
		return false, nil, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	snapshot, ok := c.gitSnapshots[projectKey]
	if !ok || ttl <= 0 || time.Since(snapshot.created) > ttl {
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
