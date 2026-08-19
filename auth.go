package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	passwordIterations      = 210000
	authCookieName          = "mindgit_session"
	authRequiredHeader      = "X-MindGit-Auth-Required"
	authRequiredHeaderValue = "1"
)

type AuthManager struct {
	enabled      bool
	passwordHash string
	sessionTTL   time.Duration

	mu        sync.Mutex
	vaultSalt []byte
	sessions  map[string]authSession
	attempts  map[string]loginAttempt
}

type authSession struct {
	Expires  time.Time
	VaultKey []byte
}

type loginAttempt struct {
	Count       int
	WindowStart time.Time
	BlockedTill time.Time
}

type loginRequest struct {
	Password string `json:"password"`
}

type authStatusResponse struct {
	Enabled               bool  `json:"enabled"`
	Authenticated         bool  `json:"authenticated"`
	ExpiresInMilliseconds int64 `json:"expiresInMilliseconds,omitempty"`
}

func NewAuthManager(config AuthConfig, vaultSalt string) *AuthManager {
	decodedSalt, _ := base64.RawStdEncoding.DecodeString(vaultSalt)
	return &AuthManager{
		enabled:      config.Enabled,
		passwordHash: config.PasswordHash,
		sessionTTL:   time.Duration(config.SessionHours) * time.Hour,
		vaultSalt:    decodedSalt,
		sessions:     make(map[string]authSession),
		attempts:     make(map[string]loginAttempt),
	}
}

func (a *AuthManager) handleStatus(w http.ResponseWriter, r *http.Request) {
	status := authStatusResponse{Enabled: a.enabled, Authenticated: !a.enabled}
	if a.enabled {
		if session, ok := a.session(r); ok {
			status.Authenticated = true
			status.ExpiresInMilliseconds = max(session.Expires.Sub(time.Now()).Milliseconds(), 1)
		}
	}
	writeJSON(w, status, nil)
}

func (a *AuthManager) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		http.Error(w, "cross-origin request rejected", http.StatusForbidden)
		return
	}
	if !a.enabled {
		writeJSON(w, authStatusResponse{Authenticated: true}, nil)
		return
	}
	client := clientAddress(r)
	if wait := a.loginWait(client); wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		http.Error(w, "too many login attempts", http.StatusTooManyRequests)
		return
	}
	var request loginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "invalid login request", http.StatusBadRequest)
		return
	}
	if !verifyPassword(request.Password, a.passwordHash) {
		a.recordLoginFailure(client)
		time.Sleep(250 * time.Millisecond)
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}
	a.clearLoginFailures(client)
	token, err := randomToken(32)
	if err != nil {
		http.Error(w, "cannot create session", http.StatusInternalServerError)
		return
	}
	expires := time.Now().Add(a.sessionTTL)
	a.mu.Lock()
	session := authSession{Expires: expires}
	if len(a.vaultSalt) >= 16 {
		session.VaultKey = pbkdf2SHA256([]byte(request.Password), a.vaultSalt, passwordIterations, 32)
	}
	a.sessions[token] = session
	a.removeExpiredLocked(time.Now())
	a.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(a.sessionTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil,
	})
	writeJSON(w, authStatusResponse{
		Enabled:               true,
		Authenticated:         true,
		ExpiresInMilliseconds: max(expires.Sub(time.Now()).Milliseconds(), 1),
	}, nil)
}

func (a *AuthManager) handleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(authCookieName); err == nil {
		a.mu.Lock()
		delete(a.sessions, cookie.Value)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   r.TLS != nil,
	})
	writeJSON(w, map[string]bool{"authenticated": false}, nil)
}

func (a *AuthManager) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api/auth/status" || r.URL.Path == "/api/auth/login" {
			next.ServeHTTP(w, r)
			return
		}
		if !sameOrigin(r) {
			http.Error(w, "cross-origin request rejected", http.StatusForbidden)
			return
		}
		if a.enabled && !a.authorized(r) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set(authRequiredHeader, authRequiredHeaderValue)
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "authentication required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *AuthManager) authorized(r *http.Request) bool {
	_, ok := a.session(r)
	return ok
}

func (a *AuthManager) session(r *http.Request) (authSession, bool) {
	cookie, err := r.Cookie(authCookieName)
	if err != nil || cookie.Value == "" {
		return authSession{}, false
	}
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[cookie.Value]
	if !ok || !session.Expires.After(now) {
		delete(a.sessions, cookie.Value)
		return authSession{}, false
	}
	return session, true
}

func (a *AuthManager) loginWait(client string) time.Duration {
	a.mu.Lock()
	defer a.mu.Unlock()
	attempt := a.attempts[client]
	if attempt.BlockedTill.After(time.Now()) {
		return time.Until(attempt.BlockedTill)
	}
	return 0
}

func (a *AuthManager) recordLoginFailure(client string) {
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	attempt := a.attempts[client]
	if attempt.WindowStart.IsZero() || now.Sub(attempt.WindowStart) > 10*time.Minute {
		attempt = loginAttempt{WindowStart: now}
	}
	attempt.Count++
	if attempt.Count >= 5 {
		attempt.BlockedTill = now.Add(time.Minute)
	}
	a.attempts[client] = attempt
}

func (a *AuthManager) clearLoginFailures(client string) {
	a.mu.Lock()
	delete(a.attempts, client)
	a.mu.Unlock()
}

func (a *AuthManager) removeExpiredLocked(now time.Time) {
	for token, session := range a.sessions {
		if !session.Expires.After(now) {
			delete(a.sessions, token)
		}
	}
}

func (a *AuthManager) vaultKey(r *http.Request) ([]byte, bool) {
	if !a.enabled {
		return nil, false
	}
	cookie, err := r.Cookie(authCookieName)
	if err != nil {
		return nil, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[cookie.Value]
	if !ok || !session.Expires.After(time.Now()) || len(session.VaultKey) != 32 {
		return nil, false
	}
	return append([]byte(nil), session.VaultKey...), true
}

func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func hashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("password must contain at least 8 characters")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	derived := pbkdf2SHA256([]byte(password), salt, passwordIterations, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", passwordIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(derived)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 100000 || iterations > 2000000 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil || len(salt) < 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(expected) != 32 {
		return false
	}
	actual := pbkdf2SHA256([]byte(password), salt, iterations, len(expected))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func pbkdf2SHA256(password, salt []byte, iterations, length int) []byte {
	hashLength := sha256.Size
	blocks := (length + hashLength - 1) / hashLength
	output := make([]byte, 0, blocks*hashLength)
	for block := 1; block <= blocks; block++ {
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		value := mac.Sum(nil)
		result := append([]byte(nil), value...)
		for index := 1; index < iterations; index++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(value)
			value = mac.Sum(nil)
			for offset := range result {
				result[offset] ^= value[offset]
			}
		}
		output = append(output, result...)
	}
	return output[:length]
}

func randomToken(length int) (string, error) {
	buffer := make([]byte, length)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func updateConfigPassword(path string) error {
	config := defaultFileConfig()
	if _, err := os.Stat(path); err == nil {
		loaded, err := loadFileConfig(path)
		if err != nil {
			return err
		}
		config = loaded
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	resolvedSSH := resolveSSHPaths(path, config.SSH)
	if config.Auth.PasswordHash != "" && encryptedSSHKeysExist(resolvedSSH) {
		return fmt.Errorf("cannot change the access password while encrypted SSH keys exist; remove and re-import the keys first")
	}
	password, err := readNewPassword()
	if err != nil {
		return err
	}
	encoded, err := hashPassword(password)
	if err != nil {
		return err
	}
	config.Auth.Enabled = true
	config.Auth.PasswordHash = encoded
	if config.SSH.VaultSalt == "" {
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return err
		}
		config.SSH.VaultSalt = base64.RawStdEncoding.EncodeToString(salt)
	}
	if config.Auth.SessionHours <= 0 {
		config.Auth.SessionHours = 12
	}
	return writeFileConfig(path, config)
}
