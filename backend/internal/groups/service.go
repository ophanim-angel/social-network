package groups

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"social-network/internal/chat"
	"social-network/internal/notification"

	"github.com/gofrs/uuid/v5"
)

var (
	ErrGroupNotFound = errors.New("group not found")
	ErrUnauthorized  = errors.New("unauthorized")
	ErrEmptyTitle    = errors.New("title is required")
	ErrEmptyContent  = errors.New("content is required")
	ErrEmptyEvent    = errors.New("event title and day/time are required")
	ErrPastEvent     = errors.New("event time must be in the future")
	ErrInvalidStatus = errors.New("invalid status")
	ErrUserRequired  = errors.New("user is required")
	ErrUserNotFound  = errors.New("user not found")
	ErrNotFollower   = errors.New("can only invite your followers")
	ErrTextTooLong   = errors.New("text is too long")
	ErrInvalidImage  = errors.New("invalid image")
	ErrImageTooLarge = errors.New("Images must be 10 MB or smaller")
)

const (
	maxGroupTitleLen       = 80
	maxGroupDescriptionLen = 500
	maxGroupPostLen        = 2000
	maxGroupCommentLen     = 500
	maxEventTitleLen       = 80
	maxEventDescriptionLen = 500
	maxNicknameLen         = 15
	maxInvitees            = 20
	maxImageSize           = 10 << 20
)

type Service struct {
	repo      *Repository
	notifRepo *notification.Repository
	hub       *chat.Hub
	uploadDir string
}

func NewService(repo *Repository, notifRepo *notification.Repository, hub *chat.Hub) *Service {
	return &Service{repo: repo, notifRepo: notifRepo, hub: hub}
}

func (s *Service) WithUploadDir(uploadDir string) *Service {
	s.uploadDir = uploadDir
	return s
}

func (s *Service) StartExpiredEventCleanup(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		_ = s.repo.DeleteExpiredEvents(time.Now())
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for now := range ticker.C {
			_ = s.repo.DeleteExpiredEvents(now)
		}
	}()
}

func (s *Service) CreateGroup(userID string, req CreateGroupRequest) (*Group, error) {
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	if req.Title == "" {
		return nil, ErrEmptyTitle
	}
	if len(req.Title) > maxGroupTitleLen || len(req.Description) > maxGroupDescriptionLen || len(req.InviteeNicknames)+len(req.InviteeUserIDs) > maxInvitees {
		return nil, ErrTextTooLong
	}

	id, _ := uuid.NewV4()
	group := &Group{
		ID:          id.String(),
		CreatorID:   userID,
		Title:       req.Title,
		Description: req.Description,
	}
	inviteeIDs, err := s.inviteeIDs(userID, req.InviteeUserIDs, req.InviteeNicknames)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateGroup(group, inviteeIDs); err != nil {
		return nil, err
	}
	for _, inviteeID := range inviteeIDs {
		if inviteeID == userID {
			continue
		}
		content := "You are invited to join group: " + group.Title
		if err := s.notifyUser(inviteeID, "group_invite", content, &group.ID); err != nil {
			return nil, err
		}
	}
	return s.repo.GetGroupByID(userID, group.ID)
}

func (s *Service) ListGroups(userID string) ([]*Group, error) {
	return s.repo.ListGroups(userID)
}

func (s *Service) GetGroup(userID, groupID string) (*GroupDetail, error) {
	if err := s.repo.DeleteExpiredEvents(time.Now()); err != nil {
		return nil, err
	}
	group, err := s.repo.GetGroupByID(userID, groupID)
	if err != nil {
		return nil, err
	}
	if group == nil {
		return nil, ErrGroupNotFound
	}

	members, err := s.repo.GetMembers(groupID)
	if err != nil {
		return nil, err
	}

	detail := &GroupDetail{Group: group, Members: members}
	if !group.IsMember {
		return detail, nil
	}

	posts, err := s.repo.GetPosts(groupID)
	if err != nil {
		return nil, err
	}
	events, err := s.repo.GetEvents(groupID, userID)
	if err != nil {
		return nil, err
	}
	detail.Posts = posts
	detail.Events = events

	isCreator, err := s.repo.IsCreator(groupID, userID)
	if err != nil {
		return nil, err
	}
	if isCreator {
		requests, err := s.repo.GetPendingRequests(groupID)
		if err != nil {
			return nil, err
		}
		detail.Requests = requests
	}
	return detail, nil
}

func (s *Service) InviteUser(userID, groupID string, req InviteRequest) error {
	inviteeID := strings.TrimSpace(req.UserID)
	if inviteeID == "" {
		nickname := normalizeNickname(req.Nickname)
		if nickname == "" {
			return ErrUserRequired
		}
		if nickname != "" && len(nickname) > maxNicknameLen {
			return ErrTextTooLong
		}
		var err error
		inviteeID, err = s.userIDByNickname(nickname)
		if err != nil {
			return err
		}
	}
	if inviteeID == "" {
		return ErrUserRequired
	}
	if err := s.requireMember(groupID, userID); err != nil {
		return err
	}
	if err := s.requireFollower(userID, inviteeID); err != nil {
		return err
	}
	if err := s.repo.InviteUser(groupID, userID, inviteeID); err != nil {
		return err
	}

	// Trigger Notification
	group, _ := s.repo.GetGroupByID(userID, groupID)
	if group != nil {
		content := "You are invited to join group: " + group.Title
		return s.notifyUser(inviteeID, "group_invite", content, &group.ID)
	}
	return nil
}

func (s *Service) RespondToInvitation(userID, groupID, status string) error {
	switch status {
	case InvitationAccepted, InvitationDeclined:
	default:
		return ErrInvalidStatus
	}
	if err := s.repo.RespondToInvitation(groupID, userID, status); err != nil {
		if err == sql.ErrNoRows {
			return ErrGroupNotFound
		}
		return err
	}
	return nil
}

func (s *Service) RequestToJoin(userID, groupID string) error {
	group, err := s.repo.GetGroupByID(userID, groupID)
	if err != nil {
		return err
	}
	if group == nil {
		return ErrGroupNotFound
	}
	if group.IsMember {
		return nil
	}
	if err := s.repo.RequestToJoin(groupID, userID); err != nil {
		return err
	}

	// Trigger Notification to Creator
	if group != nil {
		content := "A user has requested to join your group: " + group.Title
		return s.notifyUser(group.CreatorID, "group_request", content, &group.ID)
	}
	return nil
}

func (s *Service) RespondToJoinRequest(userID, groupID, requesterID, status string) error {
	switch status {
	case RequestAccepted, RequestDeclined:
	default:
		return ErrInvalidStatus
	}
	isCreator, err := s.repo.IsCreator(groupID, userID)
	if err != nil {
		return err
	}
	if !isCreator {
		return ErrUnauthorized
	}
	if err := s.repo.RespondToJoinRequest(groupID, requesterID, status); err != nil {
		if err == sql.ErrNoRows {
			return ErrGroupNotFound
		}
		return err
	}

	// Trigger Notification to Requester
	group, _ := s.repo.GetGroupByID(userID, groupID)
	if group != nil {
		content := "Your request to join group '" + group.Title + "' was " + status
		return s.notifyUser(requesterID, "group_request_response", content, &group.ID)
	}
	return nil
}

func (s *Service) CreatePost(userID, groupID string, req CreatePostRequest, fileHeader *multipart.FileHeader) (*GroupPost, error) {
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" && fileHeader == nil {
		return nil, ErrEmptyContent
	}
	if len(req.Content) > maxGroupPostLen {
		return nil, ErrTextTooLong
	}
	if err := s.requireMember(groupID, userID); err != nil {
		return nil, err
	}

	image, err := s.saveImage(fileHeader, "groups/posts")
	if err != nil {
		return nil, err
	}

	id, _ := uuid.NewV4()
	post := &GroupPost{ID: id.String(), GroupID: groupID, UserID: userID, Content: req.Content, Image: image}
	if err := s.repo.CreatePost(post); err != nil {
		return nil, err
	}
	return s.repo.GetPostByID(post.ID)
}

func (s *Service) GetPost(userID, groupID, postID string) (*PostDetail, error) {
	if err := s.requireMember(groupID, userID); err != nil {
		return nil, err
	}
	post, err := s.repo.GetPostByID(postID)
	if err != nil {
		return nil, err
	}
	if post == nil || post.GroupID != groupID {
		return nil, ErrGroupNotFound
	}
	comments, err := s.repo.GetComments(postID)
	if err != nil {
		return nil, err
	}
	return &PostDetail{Post: post, Comments: comments}, nil
}

func (s *Service) CreateComment(userID, groupID, postID string, req CreateCommentRequest, fileHeader *multipart.FileHeader) (*GroupComment, error) {
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" && fileHeader == nil {
		return nil, ErrEmptyContent
	}
	if len(req.Content) > maxGroupCommentLen {
		return nil, ErrTextTooLong
	}
	if err := s.requireMember(groupID, userID); err != nil {
		return nil, err
	}
	post, err := s.repo.GetPostByID(postID)
	if err != nil {
		return nil, err
	}
	if post == nil || post.GroupID != groupID {
		return nil, ErrGroupNotFound
	}

	image, err := s.saveImage(fileHeader, "groups/comments")
	if err != nil {
		return nil, err
	}

	id, _ := uuid.NewV4()
	comment := &GroupComment{ID: id.String(), PostID: postID, UserID: userID, Content: req.Content, Image: image}
	if err := s.repo.CreateComment(comment); err != nil {
		return nil, err
	}
	return s.repo.GetCommentByID(comment.ID)
}

func (s *Service) CreateEvent(userID, groupID string, req CreateEventRequest) (*GroupEvent, error) {
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	if req.Title == "" || strings.TrimSpace(req.EventTime) == "" {
		return nil, ErrEmptyEvent
	}
	if len(req.Title) > maxEventTitleLen || len(req.Description) > maxEventDescriptionLen {
		return nil, ErrTextTooLong
	}
	if err := s.requireMember(groupID, userID); err != nil {
		return nil, err
	}
	eventTime, err := time.Parse(time.RFC3339, req.EventTime)
	if err != nil {
		return nil, ErrEmptyEvent
	}
	if !eventTime.After(time.Now()) {
		return nil, ErrPastEvent
	}

	id, _ := uuid.NewV4()
	event := &GroupEvent{ID: id.String(), GroupID: groupID, CreatorID: userID, Title: req.Title, Description: req.Description, EventTime: eventTime}
	if err := s.repo.CreateEvent(event); err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroupByID(userID, groupID)
	if err != nil {
		return nil, err
	}
	if group != nil {
		members, err := s.repo.GetMembers(groupID)
		if err != nil {
			return nil, err
		}
		content := "New event in " + group.Title + ": " + event.Title
		for _, member := range members {
			if member.ID == userID {
				continue
			}
			if err := s.notifyUser(member.ID, "group_event", content, &groupID); err != nil {
				return nil, err
			}
		}
	}

	events, err := s.repo.GetEvents(groupID, userID)
	if err != nil {
		return nil, err
	}
	for _, item := range events {
		if item.ID == event.ID {
			return item, nil
		}
	}
	return event, nil
}

func (s *Service) RespondToEvent(userID, groupID, eventID string, req EventResponseRequest) error {
	if err := s.repo.DeleteExpiredEvents(time.Now()); err != nil {
		return err
	}
	switch req.Response {
	case "going", "not_going":
	default:
		return ErrInvalidStatus
	}
	if err := s.requireMember(groupID, userID); err != nil {
		return err
	}
	return s.repo.RespondToEvent(eventID, userID, req.Response)
}

func (s *Service) GetInvitations(userID string) ([]*Invitation, error) {
	return s.repo.GetInvitations(userID)
}

func (s *Service) FollowUser(followerID, followedID string) error {
	if followerID == followedID {
		return errors.New("cannot follow yourself")
	}
	if err := s.repo.CreateFollowRequest(followerID, followedID); err != nil {
		return err
	}

	content := "A user has requested to follow you"
	if err := s.notifyUser(followedID, "follow_request", content, &followerID); err != nil {
		return err
	}

	return nil
}

func (s *Service) AcceptFollowRequest(followerID, followedID string) error {
	if err := s.repo.CreateFollower(followerID, followedID); err != nil {
		return err
	}
	if err := s.repo.DeleteFollowRequest(followerID, followedID); err != nil {
		return err
	}

	content := "Your follow request was accepted"
	if err := s.notifyUser(followerID, "follow_accept", content, &followedID); err != nil {
		return err
	}

	return nil
}

func (s *Service) notifyUser(userID, notifType, content string, sourceID *string) error {
	if s.notifRepo == nil {
		return nil
	}

	n := &notification.Notification{
		UserID:   userID,
		SourceID: sourceID,
		Type:     notifType,
		Content:  content,
	}
	if err := s.notifRepo.CreateNotification(n); err != nil {
		return err
	}

	if s.hub != nil {
		msg := &chat.Message{
			ID:         n.ID,
			Type:       n.Type,
			SourceID:   n.SourceID,
			ReceiverID: &userID,
			Content:    n.Content,
			IsRead:     n.IsRead,
			CreatedAt:  n.CreatedAt,
		}
		select {
		case s.hub.Broadcast <- msg:
		default:
		}
	}

	return nil
}

func (s *Service) DeclineFollowRequest(followerID, followedID string) error {
	return s.repo.DeleteFollowRequest(followerID, followedID)
}

func (s *Service) GetFollowers(userID string) ([]Author, error) {
	return s.repo.GetFollowers(userID)
}

func (s *Service) GetVisibleUploadPath(viewerID, requestPath string) (string, error) {
	cleanPath := filepath.ToSlash(filepath.Clean(strings.TrimPrefix(requestPath, "/")))
	if !strings.HasPrefix(cleanPath, "uploads/groups/posts/") && !strings.HasPrefix(cleanPath, "uploads/groups/comments/") {
		return "", ErrGroupNotFound
	}

	groupID, err := s.repo.GetGroupIDByImagePath(cleanPath)
	if err != nil {
		return "", err
	}
	if groupID == nil {
		return "", ErrGroupNotFound
	}
	if err := s.requireMember(*groupID, viewerID); err != nil {
		return "", err
	}

	fullPath := filepath.Join(s.uploadDir, strings.TrimPrefix(cleanPath, "uploads/"))
	return fullPath, nil
}

func (s *Service) requireMember(groupID, userID string) error {
	group, err := s.repo.GetGroupByID(userID, groupID)
	if err != nil {
		return err
	}
	if group == nil {
		return ErrGroupNotFound
	}
	if !group.IsMember {
		return ErrUnauthorized
	}
	return nil
}

func (s *Service) inviteeIDs(inviterID string, userIDs []string, nicknames []string) ([]string, error) {
	uniqueIDs := uniqueStrings(userIDs)
	if len(uniqueIDs) > 0 {
		for _, userID := range uniqueIDs {
			exists, err := s.repo.UserExists(userID)
			if err != nil {
				return nil, err
			}
			if !exists {
				return nil, ErrUserNotFound
			}
			if err := s.requireFollower(inviterID, userID); err != nil {
				return nil, err
			}
		}
		return uniqueIDs, nil
	}
	return s.userIDsByNicknames(inviterID, nicknames)
}

func (s *Service) userIDsByNicknames(inviterID string, nicknames []string) ([]string, error) {
	for _, nickname := range nicknames {
		if len(normalizeNickname(nickname)) > maxNicknameLen {
			return nil, ErrTextTooLong
		}
	}
	nicknames = uniqueNicknames(nicknames)
	userIDs := make([]string, 0, len(nicknames))
	for _, nickname := range nicknames {
		userID, err := s.userIDByNickname(nickname)
		if err != nil {
			return nil, err
		}
		if err := s.requireFollower(inviterID, userID); err != nil {
			return nil, err
		}
		userIDs = append(userIDs, userID)
	}
	return userIDs, nil
}

func (s *Service) saveImage(fileHeader *multipart.FileHeader, folder string) (*string, error) {
	if fileHeader == nil {
		return nil, nil
	}
	if fileHeader.Size > maxImageSize {
		return nil, ErrImageTooLarge
	}

	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !allowedImageExtension(ext) {
		return nil, ErrInvalidImage
	}

	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open image: %w", err)
	}
	defer file.Close()

	header := make([]byte, 512)
	n, err := file.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read image: %w", err)
	}
	if !allowedImageContentType(http.DetectContentType(header[:n])) {
		return nil, ErrInvalidImage
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("failed to read image: %w", err)
	}

	id, _ := uuid.NewV4()
	name := id.String() + ext
	relativePath := filepath.ToSlash(filepath.Join("uploads", folder, name))
	fullDir := filepath.Join(s.uploadDir, folder)
	fullPath := filepath.Join(fullDir, name)

	if err := os.MkdirAll(fullDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create upload directory: %w", err)
	}

	dst, err := os.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to create image: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		return nil, fmt.Errorf("failed to save image: %w", err)
	}

	return &relativePath, nil
}

func allowedImageExtension(ext string) bool {
	return ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".gif" || ext == ".webp"
}

func allowedImageContentType(contentType string) bool {
	return contentType == "image/jpeg" || contentType == "image/png" || contentType == "image/gif" || contentType == "image/webp"
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (s *Service) requireFollower(userID, followerID string) error {
	isFollower, err := s.repo.IsFollower(followerID, userID)
	if err != nil {
		return err
	}
	if !isFollower {
		return ErrNotFollower
	}
	return nil
}

func (s *Service) userIDByNickname(nickname string) (string, error) {
	userID, err := s.repo.GetUserIDByNickname(nickname)
	if err != nil {
		return "", err
	}
	if userID == "" {
		return "", ErrUserNotFound
	}
	return userID, nil
}

func uniqueNicknames(values []string) []string {
	seen := make(map[string]bool)
	unique := []string{}
	for _, value := range values {
		value = normalizeNickname(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	return unique
}

func normalizeNickname(value string) string {
	return strings.TrimPrefix(strings.TrimSpace(value), "@")
}
