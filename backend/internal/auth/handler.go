package auth

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Handle new user registration requests.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.service.Register(req); err != nil {
		switch err {
		case ErrUserAlreadyExists:
			writeJSONError(w, err.Error(), http.StatusConflict)
			return
		case ErrInvalidEmail, ErrInvalidPassword, ErrInvalidAvatar, ErrInvalidText, ErrInvalidAge:
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "User registered successfully"})
}

// Handle user login and session creation.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodPost {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		_ = h.service.Logout(cookie.Value)
	}

	sessionToken, expiresAt, err := h.service.Login(req.Email, req.Password)
	if err != nil {
		switch err {
		case ErrInvalidCredentials:
			ClearSessionCookie(w, r)
			writeJSONError(w, err.Error(), http.StatusUnauthorized)
			return
		case ErrInvalidEmail, ErrInvalidPassword:
			ClearSessionCookie(w, r)
			writeJSONError(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	SetSessionCookie(w, r, sessionToken, expiresAt)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Login successful"})
}

// Return information for the currently authenticated user.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	if r.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		ClearSessionCookie(w, r)
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	user, err := h.service.GetCurrentUser(cookie.Value)
	if err != nil {
		if err == ErrInvalidSession {
			ClearSessionCookie(w, r)
			writeJSONError(w, "Not logged in", http.StatusUnauthorized)
			return
		}
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(user)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	writeJSONHeader(w)

	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		ClearSessionCookie(w, r)
		writeJSONError(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	if err := h.service.Logout(cookie.Value); err != nil {
		writeJSONError(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	ClearSessionCookie(w, r)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logout successful"})
}

func writeJSONHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
}

func writeJSONError(w http.ResponseWriter, message string, status int) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
