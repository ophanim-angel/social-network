package posts

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestGetFollowersOrdersByFirstAndLastNameWithoutNickname(t *testing.T) {
	db := newPostsRepositoryTestDB(t)
	repo := NewRepository(db)

	insertPostsRepositoryTestUser(t, db, "author", "Author", "User", nil)
	insertPostsRepositoryTestUser(t, db, "zoe", "Zoe", "Alpha", nil)
	insertPostsRepositoryTestUser(t, db, "anna", "Anna", "Zulu", nil)
	insertPostsRepositoryTestUser(t, db, "anna-a", "Anna", "Alpha", stringPtr("zz-top"))

	insertPostsRepositoryTestFollower(t, db, "zoe", "author")
	insertPostsRepositoryTestFollower(t, db, "anna", "author")
	insertPostsRepositoryTestFollower(t, db, "anna-a", "author")

	followers, err := repo.GetFollowers("author")
	if err != nil {
		t.Fatalf("GetFollowers() error = %v", err)
	}

	got := make([]string, 0, len(followers))
	for _, follower := range followers {
		got = append(got, follower.ID)
	}
	want := []string{"anna-a", "anna", "zoe"}
	if len(got) != len(want) {
		t.Fatalf("follower count = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("followers[%d] = %q, want %q (all: %v)", i, got[i], want[i], got)
		}
	}
}

func newPostsRepositoryTestDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			first_name TEXT NOT NULL,
			last_name TEXT NOT NULL,
			nickname TEXT,
			avatar TEXT
		);
		CREATE TABLE followers (
			follower_id TEXT NOT NULL,
			followed_id TEXT NOT NULL,
			PRIMARY KEY (follower_id, followed_id)
		);
	`)
	if err != nil {
		t.Fatalf("failed to create test schema: %v", err)
	}

	return db
}

func insertPostsRepositoryTestUser(t *testing.T, db *sql.DB, id, firstName, lastName string, nickname *string) {
	t.Helper()

	_, err := db.Exec(
		`INSERT INTO users (id, first_name, last_name, nickname) VALUES (?, ?, ?, ?)`,
		id, firstName, lastName, nickname,
	)
	if err != nil {
		t.Fatalf("failed to insert test user: %v", err)
	}
}

func insertPostsRepositoryTestFollower(t *testing.T, db *sql.DB, followerID, followedID string) {
	t.Helper()

	_, err := db.Exec(
		`INSERT INTO followers (follower_id, followed_id) VALUES (?, ?)`,
		followerID, followedID,
	)
	if err != nil {
		t.Fatalf("failed to insert test follower: %v", err)
	}
}

func stringPtr(value string) *string {
	return &value
}
