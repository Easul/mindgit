package main

import "testing"

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
