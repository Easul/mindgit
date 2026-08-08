package main

type ChangedFile struct {
	Path           string `json:"path"`
	Status         string `json:"status"`
	IndexStatus    string `json:"indexStatus,omitempty"`
	WorktreeStatus string `json:"worktreeStatus,omitempty"`
	Staged         bool   `json:"staged,omitempty"`
	Unstaged       bool   `json:"unstaged,omitempty"`
	Additions      int    `json:"additions"`
	Deletions      int    `json:"deletions"`
	Ignored        bool   `json:"ignored"`
	IsDir          bool   `json:"isDir"`
}

type StatusResponse struct {
	Project      ProjectSummary `json:"project"`
	Root         string         `json:"root"`
	Branch       string         `json:"branch"`
	GitAvailable bool           `json:"gitAvailable"`
	Files        []ChangedFile  `json:"files"`
	Modified     int            `json:"modified"`
	Added        int            `json:"added"`
	Deleted      int            `json:"deleted"`
	Untracked    int            `json:"untracked"`
	Additions    int            `json:"additions"`
	Deletions    int            `json:"deletions"`
}

type DiffResponse struct {
	Path string `json:"path"`
	Diff string `json:"diff"`
}

type FileResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type OpenFileResponse struct {
	Path     string `json:"path"`
	External bool   `json:"external"`
	Writable bool   `json:"writable"`
}

type SaveRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Create  bool   `json:"create,omitempty"`
}

type UploadResponse struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type CreatePathRequest struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type RenamePathRequest struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type DeletePathRequest struct {
	Path    string `json:"path"`
	Confirm bool   `json:"confirm"`
}

type StageRequest struct {
	Path string `json:"path"`
}

type SearchResponse struct {
	Query   string         `json:"query"`
	Results []SearchResult `json:"results"`
}

type SearchResult struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Preview string `json:"preview"`
}

type TreeResponse struct {
	Path  string        `json:"path"`
	Files []ChangedFile `json:"files"`
}

type TreeBatchRequest struct {
	Paths []string `json:"paths"`
}

type TreeBatchResponse struct {
	Trees []TreeResponse `json:"trees"`
}

type CommitSummary struct {
	Hash      string `json:"hash"`
	ShortHash string `json:"shortHash"`
	Author    string `json:"author"`
	Email     string `json:"email"`
	Date      string `json:"date"`
	Subject   string `json:"subject"`
	Temporary bool   `json:"temporary,omitempty"`
}

type CommitHistoryResponse struct {
	Commits []CommitSummary `json:"commits"`
}

type CommitDetail struct {
	Commit CommitSummary `json:"commit"`
	Files  []ChangedFile `json:"files"`
}

const stagedCommitHash = "__staged__"
