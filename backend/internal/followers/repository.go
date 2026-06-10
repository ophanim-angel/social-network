package followers

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) ListUsers(viewerID string) ([]UserSummary, error) {
	rows, err := r.db.Query(`
		SELECT u.id, u.first_name, u.last_name, u.nickname, u.avatar, u.is_public,
		       CASE
		         WHEN u.id = ? THEN 'self'
		         WHEN EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = ? AND f.followed_id = u.id) THEN 'following'
		         WHEN EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = ? AND fr.target_id = u.id AND fr.status = 'pending') THEN 'pending'
		         ELSE 'none'
		       END AS follow_status
		FROM users u
		ORDER BY LOWER(u.first_name), LOWER(u.last_name)`, viewerID, viewerID, viewerID)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	defer rows.Close()

	users := []UserSummary{}
	for rows.Next() {
		user, err := scanUserSummary(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *Repository) GetUserProfile(viewerID, profileID string) (*Profile, error) {
	row := r.db.QueryRow(`
		SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth, u.gender,
		       u.avatar, u.nickname, u.about_me, u.is_public, u.created_at,
		       CASE
		         WHEN u.id = ? THEN 'self'
		         WHEN EXISTS (SELECT 1 FROM followers f WHERE f.follower_id = ? AND f.followed_id = u.id) THEN 'following'
		         WHEN EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = ? AND fr.target_id = u.id AND fr.status = 'pending') THEN 'pending'
		         ELSE 'none'
		       END AS follow_status
		FROM users u
		WHERE u.id = ?`, viewerID, viewerID, viewerID, profileID)

	profile, err := scanProfile(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	profile.CanViewDetails = profile.ID == viewerID || profile.IsPublic || profile.FollowStatus == StatusFollowing
	if !profile.CanViewDetails {
		profile.Email = nil
		profile.DateOfBirth = nil
		profile.Gender = nil
		profile.AboutMe = nil
		return profile, nil
	}

	followers, err := r.ListFollowers(viewerID, profile.ID)
	if err != nil {
		return nil, err
	}
	following, err := r.ListFollowing(viewerID, profile.ID)
	if err != nil {
		return nil, err
	}
	profile.Followers = followers
	profile.Following = following
	return profile, nil
}

func (r *Repository) UserIsPublic(userID string) (bool, error) {
	var isPublic bool
	err := r.db.QueryRow(`SELECT is_public FROM users WHERE id = ?`, userID).Scan(&isPublic)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to check profile visibility: %w", err)
	}
	return isPublic, nil
}

func (r *Repository) UserExists(userID string) (bool, error) {
	var exists bool
	if err := r.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE id = ?)`, userID).Scan(&exists); err != nil {
		return false, fmt.Errorf("failed to check user: %w", err)
	}
	return exists, nil
}

func (r *Repository) DisplayName(userID string) (string, error) {
	var firstName, lastName, email string
	var nickname sql.NullString
	err := r.db.QueryRow(`SELECT first_name, last_name, email, nickname FROM users WHERE id = ?`, userID).Scan(&firstName, &lastName, &email, &nickname)
	if err != nil {
		if err == sql.ErrNoRows {
			return "A user", nil
		}
		return "", fmt.Errorf("failed to get display name: %w", err)
	}
	if nickname.Valid && nickname.String != "" {
		return "@" + nickname.String, nil
	}
	name := strings.TrimSpace(firstName + " " + lastName)
	if name != "" {
		return name, nil
	}
	if email != "" {
		return strings.Split(email, "@")[0], nil
	}
	return "A user", nil
}

func (r *Repository) IsFollowing(followerID, followedID string) (bool, error) {
	var exists bool
	if err := r.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM followers WHERE follower_id = ? AND followed_id = ?)`, followerID, followedID).Scan(&exists); err != nil {
		return false, fmt.Errorf("failed to check following: %w", err)
	}
	return exists, nil
}

func (r *Repository) CanViewProfileDetails(viewerID, profileID string) (bool, bool, error) {
	var isSelf bool
	var isPublic bool
	var isFollowing bool
	err := r.db.QueryRow(`
		SELECT u.id = ?, u.is_public,
		       EXISTS (
		       	SELECT 1 FROM followers f
		       	WHERE f.follower_id = ? AND f.followed_id = u.id
		       )
		FROM users u
		WHERE u.id = ?`, viewerID, viewerID, profileID).Scan(&isSelf, &isPublic, &isFollowing)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, false, nil
		}
		return false, false, fmt.Errorf("failed to check profile visibility: %w", err)
	}
	return true, isSelf || isPublic || isFollowing, nil
}

func (r *Repository) Follow(followerID, followedID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`INSERT OR IGNORE INTO followers (follower_id, followed_id) VALUES (?, ?)`, followerID, followedID); err != nil {
		return fmt.Errorf("failed to follow user: %w", err)
	}
	if _, err := tx.Exec(`UPDATE follow_requests SET status = 'accepted', updated_at = ? WHERE requester_id = ? AND target_id = ? AND status = 'pending'`, time.Now(), followerID, followedID); err != nil {
		return fmt.Errorf("failed to update follow request: %w", err)
	}
	return tx.Commit()
}

func (r *Repository) CreateFollowRequest(id, requesterID, targetID string) error {
	_, err := r.db.Exec(`INSERT OR IGNORE INTO follow_requests (id, requester_id, target_id, status) VALUES (?, ?, ?, 'pending')`, id, requesterID, targetID)
	if err != nil {
		return fmt.Errorf("failed to create follow request: %w", err)
	}
	return nil
}

func (r *Repository) Unfollow(followerID, followedID string) error {
	_, err := r.db.Exec(`DELETE FROM followers WHERE follower_id = ? AND followed_id = ?`, followerID, followedID)
	if err != nil {
		return fmt.Errorf("failed to unfollow user: %w", err)
	}
	return nil
}

func (r *Repository) RespondToRequest(targetID, requestID, status string) (string, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return "", fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	var requesterID string
	err = tx.QueryRow(`SELECT requester_id FROM follow_requests WHERE id = ? AND target_id = ? AND status = 'pending'`, requestID, targetID).Scan(&requesterID)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(`UPDATE follow_requests SET status = ?, updated_at = ? WHERE id = ?`, status, time.Now(), requestID); err != nil {
		return "", fmt.Errorf("failed to update follow request: %w", err)
	}
	if status == RequestAccepted {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO followers (follower_id, followed_id) VALUES (?, ?)`, requesterID, targetID); err != nil {
			return "", fmt.Errorf("failed to add follower: %w", err)
		}
	}
	return requesterID, tx.Commit()
}

func (r *Repository) ListPendingRequests(targetID string) ([]FollowRequest, error) {
	rows, err := r.db.Query(`
		SELECT fr.id, fr.status, fr.created_at,
		       u.id, u.first_name, u.last_name, u.nickname, u.avatar, u.is_public,
		       'none' AS follow_status
		FROM follow_requests fr
		JOIN users u ON u.id = fr.requester_id
		WHERE fr.target_id = ? AND fr.status = 'pending'
		ORDER BY fr.created_at DESC`, targetID)
	if err != nil {
		return nil, fmt.Errorf("failed to list follow requests: %w", err)
	}
	defer rows.Close()

	requests := []FollowRequest{}
	for rows.Next() {
		var request FollowRequest
		if err := rows.Scan(&request.ID, &request.Status, &request.CreatedAt, &request.Requester.ID, &request.Requester.FirstName, &request.Requester.LastName, &request.Requester.Nickname, &request.Requester.Avatar, &request.Requester.IsPublic, &request.Requester.FollowStatus); err != nil {
			return nil, fmt.Errorf("failed to scan follow request: %w", err)
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

func (r *Repository) ListFollowers(viewerID, userID string) ([]UserSummary, error) {
	return r.listFollowUsers(`
		SELECT u.id, u.first_name, u.last_name, u.nickname, u.avatar, u.is_public,
		       CASE
		         WHEN u.id = ? THEN 'self'
		         WHEN EXISTS (SELECT 1 FROM followers mine WHERE mine.follower_id = ? AND mine.followed_id = u.id) THEN 'following'
		         WHEN EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = ? AND fr.target_id = u.id AND fr.status = 'pending') THEN 'pending'
		         ELSE 'none'
		       END AS follow_status
		FROM followers f
		JOIN users u ON u.id = f.follower_id
		WHERE f.followed_id = ?
		ORDER BY LOWER(u.first_name), LOWER(u.last_name)`, viewerID, userID)
}

func (r *Repository) ListFollowing(viewerID, userID string) ([]UserSummary, error) {
	return r.listFollowUsers(`
		SELECT u.id, u.first_name, u.last_name, u.nickname, u.avatar, u.is_public,
		       CASE
		         WHEN u.id = ? THEN 'self'
		         WHEN EXISTS (SELECT 1 FROM followers mine WHERE mine.follower_id = ? AND mine.followed_id = u.id) THEN 'following'
		         WHEN EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = ? AND fr.target_id = u.id AND fr.status = 'pending') THEN 'pending'
		         ELSE 'none'
		       END AS follow_status
		FROM followers f
		JOIN users u ON u.id = f.followed_id
		WHERE f.follower_id = ?
		ORDER BY LOWER(u.first_name), LOWER(u.last_name)`, viewerID, userID)
}

func (r *Repository) listFollowUsers(query, viewerID, userID string) ([]UserSummary, error) {
	rows, err := r.db.Query(query, viewerID, viewerID, viewerID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list follow users: %w", err)
	}
	defer rows.Close()

	users := []UserSummary{}
	for rows.Next() {
		user, err := scanUserSummary(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *Repository) UpdateVisibility(userID string, isPublic bool) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE users SET is_public = ? WHERE id = ?`, isPublic, userID); err != nil {
		return fmt.Errorf("failed to update profile visibility: %w", err)
	}

	if isPublic {
		if _, err := tx.Exec(`
			INSERT OR IGNORE INTO followers (follower_id, followed_id)
			SELECT requester_id, target_id FROM follow_requests 
			WHERE target_id = ? AND status = 'pending'
		`, userID); err != nil {
			return fmt.Errorf("failed to convert pending requests to followers: %w", err)
		}

		if _, err := tx.Exec(`
			UPDATE follow_requests 
			SET status = 'accepted', updated_at = ? 
			WHERE target_id = ? AND status = 'pending'
		`, time.Now(), userID); err != nil {
			return fmt.Errorf("failed to update pending requests status: %w", err)
		}
	}

	return tx.Commit()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUserSummary(row rowScanner) (UserSummary, error) {
	var user UserSummary
	if err := row.Scan(&user.ID, &user.FirstName, &user.LastName, &user.Nickname, &user.Avatar, &user.IsPublic, &user.FollowStatus); err != nil {
		return user, fmt.Errorf("failed to scan user: %w", err)
	}
	return user, nil
}

func scanProfile(row rowScanner) (*Profile, error) {
	var profile Profile
	if err := row.Scan(&profile.ID, &profile.Email, &profile.FirstName, &profile.LastName, &profile.DateOfBirth, &profile.Gender, &profile.Avatar, &profile.Nickname, &profile.AboutMe, &profile.IsPublic, &profile.CreatedAt, &profile.FollowStatus); err != nil {
		return nil, err
	}
	return &profile, nil
}
