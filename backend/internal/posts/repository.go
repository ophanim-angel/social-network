package posts

import (
	"database/sql"
	"fmt"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreatePost(p *Post, allowedUserIDs []string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	query := `INSERT INTO posts (id, user_id, title, content, image, privacy) VALUES (?, ?, ?, ?, ?, ?)`
	_, err = tx.Exec(query, p.ID, p.UserID, p.Title, p.Content, p.Image, p.Privacy)
	if err != nil {
		return fmt.Errorf("failed to insert post: %w", err)
	}

	for _, userID := range allowedUserIDs {
		query = `INSERT INTO post_allowed_users (post_id, user_id) VALUES (?, ?)`
		if _, err := tx.Exec(query, p.ID, userID); err != nil {
			return fmt.Errorf("failed to insert allowed user: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}
	return nil
}

func (r *Repository) GetPostByID(id string) (*Post, error) {
	p := &Post{}
	query := `
		SELECT p.id, p.user_id, p.title, p.content, p.image, p.privacy, p.created_at,
		       u.id, u.first_name, u.last_name, u.nickname, u.avatar
		FROM posts p
		JOIN users u ON u.id = p.user_id
		WHERE p.id = ?`
	err := r.db.QueryRow(query, id).Scan(
		&p.ID, &p.UserID, &p.Title, &p.Content, &p.Image, &p.Privacy, &p.CreatedAt,
		&p.Author.ID, &p.Author.FirstName, &p.Author.LastName, &p.Author.Nickname, &p.Author.Avatar,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get post: %w", err)
	}
	return p, nil
}

func (r *Repository) GetVisiblePosts(viewerID string) ([]*Post, error) {
	query := `
        SELECT p.id, p.user_id, p.title, p.content, p.image, p.privacy, p.created_at,
               u.id, u.first_name, u.last_name, u.nickname, u.avatar
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ?
           OR p.privacy = 'public'
           OR (
            p.privacy = 'followers'
            AND EXISTS (
             SELECT 1 FROM followers f
             WHERE f.follower_id = ? AND f.followed_id = p.user_id
            )
           )
           OR (
            p.privacy = 'private_selected'
            AND EXISTS (
             SELECT 1 FROM post_allowed_users pau
             WHERE pau.post_id = p.id AND pau.user_id = ?
            )
            AND EXISTS (
             SELECT 1 FROM followers f
             WHERE f.follower_id = ? AND f.followed_id = p.user_id
            )
           )
        ORDER BY p.created_at DESC`

	rows, err := r.db.Query(query, viewerID, viewerID, viewerID, viewerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get feed: %w", err)
	}
	defer rows.Close()

	feed := []*Post{}
	for rows.Next() {
		p := &Post{}
		err := rows.Scan(
			&p.ID, &p.UserID, &p.Title, &p.Content, &p.Image, &p.Privacy, &p.CreatedAt,
			&p.Author.ID, &p.Author.FirstName, &p.Author.LastName, &p.Author.Nickname, &p.Author.Avatar,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan post: %w", err)
		}
		feed = append(feed, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read posts: %w", err)
	}
	return feed, nil
}

func (r *Repository) CanUserSeePost(viewerID, postID string) (bool, error) {
	query := `
        SELECT EXISTS (
            SELECT 1
            FROM posts p
            WHERE p.id = ?
              AND (
                p.user_id = ?
                OR p.privacy = 'public'
                OR (
                    p.privacy = 'followers'
                    AND EXISTS (
                        SELECT 1 FROM followers f
                        WHERE f.follower_id = ? AND f.followed_id = p.user_id
                    )
                )
                OR (
                    p.privacy = 'private_selected'
                    AND EXISTS (
                        SELECT 1 FROM post_allowed_users pau
                        WHERE pau.post_id = p.id AND pau.user_id = ?
                    )
                    AND EXISTS (
                        SELECT 1 FROM followers f
                        WHERE f.follower_id = ? AND f.followed_id = p.user_id
                    )
                )
              )
        )`
	var canSee bool
	if err := r.db.QueryRow(query, postID, viewerID, viewerID, viewerID, viewerID).Scan(&canSee); err != nil {
		return false, fmt.Errorf("failed to check post visibility: %w", err)
	}
	return canSee, nil
}

func (r *Repository) AreFollowers(authorID string, userIDs []string) (bool, error) {
	for _, userID := range userIDs {
		var exists bool
		query := `SELECT EXISTS (SELECT 1 FROM followers WHERE follower_id = ? AND followed_id = ?)`
		if err := r.db.QueryRow(query, userID, authorID).Scan(&exists); err != nil {
			return false, fmt.Errorf("failed to check follower: %w", err)
		}
		if !exists {
			return false, nil
		}
	}
	return true, nil
}

func (r *Repository) GetFollowers(userID string) ([]*Follower, error) {
	query := `
		SELECT u.id, u.first_name, u.last_name, u.nickname, u.avatar
		FROM followers f
		JOIN users u ON u.id = f.follower_id
		WHERE f.followed_id = ?
		ORDER BY COALESCE(u.nickname, u.first_name || ' ' || u.last_name) COLLATE NOCASE`
	rows, err := r.db.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get followers: %w", err)
	}
	defer rows.Close()

	followers := []*Follower{}
	for rows.Next() {
		follower := &Follower{}
		err := rows.Scan(
			&follower.ID,
			&follower.FirstName,
			&follower.LastName,
			&follower.Nickname,
			&follower.Avatar,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan follower: %w", err)
		}
		followers = append(followers, follower)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read followers: %w", err)
	}
	return followers, nil
}

func (r *Repository) CreateComment(c *Comment) error {
	query := `INSERT INTO comments (id, post_id, user_id, content, image) VALUES (?, ?, ?, ?, ?)`
	_, err := r.db.Exec(query, c.ID, c.PostID, c.UserID, c.Content, c.Image)
	if err != nil {
		return fmt.Errorf("failed to insert comment: %w", err)
	}
	return nil
}

func (r *Repository) GetCommentByID(id string) (*Comment, error) {
	c := &Comment{}
	query := `
		SELECT c.id, c.post_id, c.user_id, c.content, c.image, c.created_at,
		       u.id, u.first_name, u.last_name, u.nickname, u.avatar
		FROM comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.id = ?`
	err := r.db.QueryRow(query, id).Scan(
		&c.ID, &c.PostID, &c.UserID, &c.Content, &c.Image, &c.CreatedAt,
		&c.Author.ID, &c.Author.FirstName, &c.Author.LastName, &c.Author.Nickname, &c.Author.Avatar,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get comment: %w", err)
	}
	return c, nil
}

func (r *Repository) GetCommentsByPostID(postID string) ([]*Comment, error) {
	query := `
		SELECT c.id, c.post_id, c.user_id, c.content, c.image, c.created_at,
		       u.id, u.first_name, u.last_name, u.nickname, u.avatar
		FROM comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.post_id = ?
		ORDER BY c.created_at ASC`
	rows, err := r.db.Query(query, postID)
	if err != nil {
		return nil, fmt.Errorf("failed to get comments: %w", err)
	}
	defer rows.Close()

	comments := []*Comment{}
	for rows.Next() {
		c := &Comment{}
		err := rows.Scan(
			&c.ID, &c.PostID, &c.UserID, &c.Content, &c.Image, &c.CreatedAt,
			&c.Author.ID, &c.Author.FirstName, &c.Author.LastName, &c.Author.Nickname, &c.Author.Avatar,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}
		comments = append(comments, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read comments: %w", err)
	}
	return comments, nil
}

func (r *Repository) GetPostIDByImagePath(imagePath string) (*string, error) {
	var postID string
	query := `SELECT id FROM posts WHERE image = ?`
	err := r.db.QueryRow(query, imagePath).Scan(&postID)
	if err == nil {
		return &postID, nil
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to get post image: %w", err)
	}

	query = `SELECT post_id FROM comments WHERE image = ?`
	err = r.db.QueryRow(query, imagePath).Scan(&postID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get comment image: %w", err)
	}
	return &postID, nil
}
