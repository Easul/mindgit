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
	statuses     map[string]StatusResponse
}

type gitSnapshot struct {
	created      time.Time
	gitAvailable bool
	files        []ChangedFile
}

func NewProjectCache() *ProjectCache {
	return &ProjectCache{
		gitSnapshots: make(map[string]gitSnapshot),
		statuses:     make(map[string]StatusResponse),
	}
}

func (c *ProjectCache) loadStatus(projectKey string) (StatusResponse, bool) {
	if c == nil {
		return StatusResponse{}, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	status, ok := c.statuses[projectKey]
	if !ok {
		return StatusResponse{}, false
	}
	status.Files = append([]ChangedFile(nil), status.Files...)
	return status, true
}

func (c *ProjectCache) storeStatus(projectKey string, status StatusResponse) {
	if c == nil {
		return
	}
	status.Files = append([]ChangedFile(nil), status.Files...)
	c.mu.Lock()
	c.statuses[projectKey] = status
	c.mu.Unlock()
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

func (c *ProjectCache) loadGitSnapshot(projectKey string) (bool, []ChangedFile, bool) {
	if c == nil {
		return false, nil, false
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	snapshot, ok := c.gitSnapshots[projectKey]
	if !ok {
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
