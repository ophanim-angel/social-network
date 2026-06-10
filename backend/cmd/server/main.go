package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"social-network/internal/auth"
	"social-network/internal/chat"
	"social-network/internal/followers"
	"social-network/internal/groups"
	"social-network/internal/middleware"
	"social-network/internal/notification"
	"social-network/internal/posts"
	"social-network/pkg/db/sqlite"
)

func main() {
	// Find project root relative to this source file.
	// runtime.Caller works correctly with `go run`.
	_, srcFile, _, _ := runtime.Caller(0)
	projectRoot := filepath.Join(filepath.Dir(srcFile), "..", "..")

	// Use env vars when available, otherwise use default local paths.
	dbPath := getEnv("DB_PATH", filepath.Join(projectRoot, "data", "social_network.db"))
	migrationsPath := getEnv("MIGRATIONS_PATH", filepath.Join(projectRoot, "migrations", "sqlite"))
	port := strings.TrimPrefix(getEnv("PORT", "8080"), ":")
	/* git */

	// 1. Initialize Database
	db, err := sqlite.Connect(dbPath)
	if err != nil {
		log.Fatalf("Could not connect to database: %v", err)
	}
	defer db.Close()

	// 2. Run Migrations
	if err := sqlite.RunMigrations(db, migrationsPath); err != nil {
		log.Fatalf("Could not run migrations: %v", err)
	}
	log.Println("Migrations completed successfully.")

	// Initialize notification and chat subsystems.
	notifRepo := notification.NewRepository(db)
	notifHandler := notification.NewHandler(notifRepo)

	// Chat initialization
	chatRepo := chat.NewRepository(db)
	chatHub := chat.NewHub(chatRepo)
	go chatHub.Run()
	chatWSHandler := chat.NewHandler(chatHub, chatRepo)

	// Manual Dependency Injection
	authRepo := auth.NewRepository(db)
	authService := auth.NewService(authRepo)
	authHandler := auth.NewHandler(authService)
	postsRepo := posts.NewRepository(db)
	postsService := posts.NewService(postsRepo, filepath.Join(projectRoot, "uploads"))
	postsHandler := posts.NewHandler(postsService)
	groupsRepo := groups.NewRepository(db)
	groupsService := groups.NewService(groupsRepo, notifRepo, chatHub).WithUploadDir(filepath.Join(projectRoot, "uploads"))
	groupsService.StartExpiredEventCleanup(time.Minute)
	groupsHandler := groups.NewHandler(groupsService)
	followersRepo := followers.NewRepository(db)
	followersService := followers.NewService(followersRepo, notifRepo).WithHub(chatHub)
	followersHandler := followers.NewHandler(followersService)

	// Middlewares

	rateLimitRequests := getEnvInt("RATE_LIMIT_REQUESTS", 120)
	rateLimitWindow := getEnvDuration("RATE_LIMIT_WINDOW", 10*time.Second)
	rateLimiter := middleware.NewRateLimiter(rateLimitRequests, rateLimitWindow)
	sessionAuth := middleware.SessionMiddleware(authService)

	// 4. Set up Routing (http.ServeMux)
	// Register all API endpoints with the HTTP multiplexer.
	mux := http.NewServeMux()

	// Public routes
	mux.HandleFunc("/register", authHandler.Register)
	mux.HandleFunc("/login", authHandler.Login)

	// Protected routes
	mux.Handle("/me", sessionAuth(http.HandlerFunc(authHandler.Me)))
	mux.Handle("/me/profile-visibility", sessionAuth(http.HandlerFunc(followersHandler.UpdateVisibility)))
	mux.Handle("/logout", sessionAuth(http.HandlerFunc(authHandler.Logout)))
	mux.Handle("/users", sessionAuth(http.HandlerFunc(followersHandler.Users)))
	mux.Handle("/users/{id}", sessionAuth(http.HandlerFunc(followersHandler.Profile)))
	mux.Handle("/users/{id}/follow", sessionAuth(http.HandlerFunc(followersHandler.Follow)))
	mux.Handle("/followers", sessionAuth(http.HandlerFunc(followersHandler.Followers)))
	mux.Handle("/following", sessionAuth(http.HandlerFunc(followersHandler.Following)))
	mux.Handle("/follow-requests", sessionAuth(http.HandlerFunc(followersHandler.Requests)))
	mux.Handle("/follow-requests/{id}/{status}", sessionAuth(http.HandlerFunc(followersHandler.RespondToRequest)))
	mux.Handle("/posts", sessionAuth(http.HandlerFunc(postsHandler.CreatePost)))
	mux.Handle("/posts/feed", sessionAuth(http.HandlerFunc(postsHandler.Feed)))
	mux.Handle("/posts/{id}", sessionAuth(http.HandlerFunc(postsHandler.GetPost)))
	mux.Handle("/posts/{id}/comments", sessionAuth(http.HandlerFunc(postsHandler.CreateComment)))
	mux.Handle("/groups", sessionAuth(http.HandlerFunc(groupsHandler.Groups)))
	mux.Handle("/groups/invitations", sessionAuth(http.HandlerFunc(groupsHandler.Invitations)))
	mux.Handle("/groups/{id}", sessionAuth(http.HandlerFunc(groupsHandler.GetGroup)))
	mux.Handle("/groups/{id}/invite", sessionAuth(http.HandlerFunc(groupsHandler.InviteUser)))
	mux.Handle("/groups/{id}/invitations/{status}", sessionAuth(http.HandlerFunc(groupsHandler.RespondToInvitation)))
	mux.Handle("/groups/{id}/requests", sessionAuth(http.HandlerFunc(groupsHandler.RequestToJoin)))
	mux.Handle("/groups/{id}/requests/{userID}/{status}", sessionAuth(http.HandlerFunc(groupsHandler.RespondToJoinRequest)))
	mux.Handle("/groups/{id}/posts", sessionAuth(http.HandlerFunc(groupsHandler.CreatePost)))
	mux.Handle("/groups/{id}/posts/{postID}", sessionAuth(http.HandlerFunc(groupsHandler.GetPost)))
	mux.Handle("/groups/{id}/posts/{postID}/comments", sessionAuth(http.HandlerFunc(groupsHandler.CreateComment)))
	mux.Handle("/groups/{id}/events", sessionAuth(http.HandlerFunc(groupsHandler.CreateEvent)))
	mux.Handle("/groups/{id}/events/{eventID}/responses", sessionAuth(http.HandlerFunc(groupsHandler.RespondToEvent)))

	// Chat routes
	mux.Handle("GET /ws", sessionAuth(http.HandlerFunc(chatWSHandler.ServeWS)))
	mux.Handle("GET /chat/contacts", sessionAuth(http.HandlerFunc(chatWSHandler.GetContacts)))
	mux.Handle("GET /chat/history", sessionAuth(http.HandlerFunc(chatWSHandler.GetHistory)))
	mux.Handle("GET /chat/group/history", sessionAuth(http.HandlerFunc(chatWSHandler.GetGroupHistory)))

	// Notification routes
	// Teammates: Pass notifRepo to your Follower/Group handlers to trigger notifications using notifRepo.CreateNotification().
	mux.Handle("GET /notifications", sessionAuth(http.HandlerFunc(notifHandler.GetNotifications)))
	mux.Handle("POST /notifications/read", sessionAuth(http.HandlerFunc(notifHandler.MarkRead)))

	// Uploaded media
	mux.Handle("/uploads/groups/", sessionAuth(http.HandlerFunc(groupsHandler.ServeUpload)))
	mux.Handle("/uploads/", sessionAuth(http.HandlerFunc(postsHandler.ServeUpload)))

	// Wrap the router with global middleware before starting the server.
	handler := middleware.RequestHeaderSizeMiddleware(16 << 10)(rateLimiter.Middleware()(mux))
	handler = CORSMiddleware(handler)

	// 5. Start Server
	addr := ":" + port
	log.Printf("Server starting on http://localhost%s", addr)
	server := &http.Server{
		Addr:           addr,
		Handler:        handler,
		ErrorLog:       log.New(os.Stderr, "http: ", log.LstdFlags),
		MaxHeaderBytes: 16 << 10,
	}
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cookie, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func getEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		log.Printf("Invalid %s=%q; using %d", key, value, fallback)
		return fallback
	}

	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		log.Printf("Invalid %s=%q; using %s", key, value, fallback)
		return fallback
	}

	return parsed
}
