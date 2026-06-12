package posts

import (
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"strings"

	"social-network/internal/middleware"
)

const maxRequestBodySize = maxImageSize + 1<<20

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Handle creating a new post from a client request.
func (h *Handler) CreatePost(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	req, fileHeader, err := parseCreatePostRequest(w, r)
	if err != nil {
		if isRequestTooLarge(err) {
			writeJSONError(w, ErrImageTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	post, err := h.service.CreatePost(userID, req, fileHeader)
	if err != nil {
		writePostError(w, err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(post)
}

// Handle fetching the user's personalized feed.
func (h *Handler) Feed(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	feed, err := h.service.GetFeed(userID)
	if err != nil {
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(feed)
}

func (h *Handler) Followers(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	followers, err := h.service.GetFollowers(userID)
	if err != nil {
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(followers)
}

func (h *Handler) GetPost(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	postID := strings.TrimSpace(r.PathValue("id"))
	if postID == "" {
		writeJSONError(w, "Post not found", http.StatusNotFound)
		return
	}

	post, err := h.service.GetPost(userID, postID)
	if err != nil {
		writePostError(w, err)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(post)
}

func (h *Handler) CreateComment(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	postID := strings.TrimSpace(r.PathValue("id"))
	if postID == "" {
		writeJSONError(w, "Post not found", http.StatusNotFound)
		return
	}

	req, fileHeader, err := parseCreateCommentRequest(w, r)
	if err != nil {
		if isRequestTooLarge(err) {
			writeJSONError(w, ErrImageTooLarge.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	comment, err := h.service.CreateComment(userID, postID, req, fileHeader)
	if err != nil {
		writePostError(w, err)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(comment)
}

// Serve uploaded post images if the request is authorized.
func (h *Handler) ServeUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONHeader(w)
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := userIDFromRequest(r)
	if !ok {
		writeJSONHeader(w)
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	fullPath, err := h.service.GetVisibleUploadPath(userID, r.URL.Path)
	if err != nil {
		writeJSONHeader(w)
		writePostError(w, err)
		return
	}

	http.ServeFile(w, r, fullPath)
}

// Parse a post creation request from form or JSON payload.
func parseCreatePostRequest(w http.ResponseWriter, r *http.Request) (CreatePostRequest, *multipart.FileHeader, error) {
	var req CreatePostRequest
	var fileHeader *multipart.FileHeader
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxImageSize + 1<<20); err != nil {
			return req, nil, err
		}
		req.Title = r.FormValue("title")
		req.Content = r.FormValue("content")
		req.Privacy = r.FormValue("privacy")
		req.AllowedUserIDs = r.MultipartForm.Value["allowed_user_ids"]
		if values := r.MultipartForm.Value["allowed_user_ids[]"]; len(values) > 0 {
			req.AllowedUserIDs = append(req.AllowedUserIDs, values...)
		}
		file, header, err := r.FormFile("image")
		if err == nil {
			file.Close()
			fileHeader = header
		}
		return req, fileHeader, nil
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, nil, err
	}
	return req, nil, nil
}

func parseCreateCommentRequest(w http.ResponseWriter, r *http.Request) (CreateCommentRequest, *multipart.FileHeader, error) {
	var req CreateCommentRequest
	var fileHeader *multipart.FileHeader
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodySize)

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(maxImageSize + 1<<20); err != nil {
			return req, nil, err
		}
		req.Content = r.FormValue("content")
		file, header, err := r.FormFile("image")
		if err == nil {
			file.Close()
			fileHeader = header
		}
		return req, fileHeader, nil
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, nil, err
	}
	return req, nil, nil
}

func userIDFromRequest(r *http.Request) (string, bool) {
	userID, ok := r.Context().Value(middleware.UserIDKey).(string)
	return userID, ok && userID != ""
}

func isRequestTooLarge(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func writePostError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrEmptyPost), errors.Is(err, ErrEmptyComment), errors.Is(err, ErrInvalidPrivacy), errors.Is(err, ErrInvalidImage), errors.Is(err, ErrImageTooLarge), errors.Is(err, ErrInvalidSelection), errors.Is(err, ErrTextTooLong):
		writeJSONError(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, ErrPostNotFound):
		writeJSONError(w, err.Error(), http.StatusNotFound)
	case errors.Is(err, ErrUnauthorizedPost):
		writeJSONError(w, err.Error(), http.StatusForbidden)
	default:
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
	}
}

func writeJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
}

func writeJSONError(w http.ResponseWriter, message string, status int) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
