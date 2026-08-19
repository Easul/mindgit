package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword("correct horse battery staple", hash) {
		t.Fatal("expected password to verify")
	}
	if verifyPassword("incorrect password", hash) {
		t.Fatal("unexpected password verification")
	}
}

func TestPasswordHashRejectsShortPassword(t *testing.T) {
	if _, err := hashPassword("short"); err == nil {
		t.Fatal("expected short password to be rejected")
	}
}

func TestAuthStatusIncludesSessionExpiry(t *testing.T) {
	auth := NewAuthManager(AuthConfig{Enabled: true, SessionHours: 1}, "")
	auth.sessions["valid"] = authSession{Expires: time.Now().Add(time.Hour)}

	request := httptest.NewRequest(http.MethodGet, "/api/auth/status", nil)
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	auth.handleStatus(response, request)

	var status authStatusResponse
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatal(err)
	}
	if !status.Enabled || !status.Authenticated {
		t.Fatalf("status = %#v", status)
	}
	if status.ExpiresInMilliseconds <= 0 || status.ExpiresInMilliseconds > time.Hour.Milliseconds() {
		t.Fatalf("expiresInMilliseconds = %d", status.ExpiresInMilliseconds)
	}
}

func TestAuthMiddlewareMarksExpiredSession(t *testing.T) {
	auth := NewAuthManager(AuthConfig{Enabled: true, SessionHours: 1}, "")
	handler := auth.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("protected handler should not be called")
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status code = %d", response.Code)
	}
	if got := response.Header().Get(authRequiredHeader); got != authRequiredHeaderValue {
		t.Fatalf("%s = %q", authRequiredHeader, got)
	}
}
