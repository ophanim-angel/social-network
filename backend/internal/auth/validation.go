package auth

import (
	"encoding/base64"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofrs/uuid/v5"
)

const maxAvatarBytes = 2 * 1024 * 1024

var (
	ErrInvalidEmail     = errors.New("email must be valid and start with a letter or digit")
	ErrInvalidPassword  = errors.New("password must be 8 to 24 characters, including at least 1 letter, 1 number, and 1 symbol (no spaces)")
	ErrInvalidAvatar    = errors.New("avatar must be a PNG, JPG, JPEG, WEBP, or GIF image under 2MB")
	ErrInvalidText      = errors.New("text fields cannot contain HTML characters")
	ErrInvalidAge       = errors.New("age must be between 18 and 70")
	ErrInvalidFirstName = errors.New("first name must be 2 to 10 letters (no spaces)")
	ErrInvalidLastName  = errors.New("last name must be 2 to 10 letters (no spaces)")
	ErrInvalidNickname  = errors.New("nickname must be 2 to 15 letters (no spaces)")
	ErrInvalidAboutMe   = errors.New("about me must be 2 to 50 characters")

	emailPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$`)
	alphaPattern    = regexp.MustCompile(`^[A-Za-z]+$`)
	avatarDataURLRe = regexp.MustCompile(`^data:image/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$`)
	htmlUnsafeChars = regexp.MustCompile(`[<>]`)
	allowedGenders  = map[string]bool{"male": true, "female": true}
)

const (
	MaxEmailLen    = 254
	MinNameLen     = 2
	MaxNameLen     = 10
	MinNicknameLen = 2
	MaxNicknameLen = 15
	MinAboutMeLen  = 2
	MaxAboutMeLen  = 50
)

func NormalizeRegisterRequest(req *RegisterRequest) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	req.DateOfBirth = strings.TrimSpace(req.DateOfBirth)
	req.Gender = strings.TrimSpace(req.Gender)
	trimOptional(&req.Nickname)
	trimOptional(&req.AboutMe)
	trimOptional(&req.Avatar)
}

func NormalizeLoginRequest(req *LoginRequest) {
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
}

func ValidateRegisterRequest(req RegisterRequest) error {
	if !IsValidEmail(req.Email) {
		return ErrInvalidEmail
	}
	if !IsValidPassword(req.Password) {
		return ErrInvalidPassword
	}
	if req.FirstName == "" || req.LastName == "" || req.DateOfBirth == "" || !allowedGenders[req.Gender] {
		return ErrInvalidText
	}
	if !isSafeText(req.FirstName) || !isSafeText(req.LastName) || !isSafeOptionalText(req.Nickname) || !isSafeOptionalText(req.AboutMe) {
		return ErrInvalidText
	}
	if !alphaPattern.MatchString(req.FirstName) || len(req.FirstName) < MinNameLen || len(req.FirstName) > MaxNameLen {
		return ErrInvalidFirstName
	}
	if !alphaPattern.MatchString(req.LastName) || len(req.LastName) < MinNameLen || len(req.LastName) > MaxNameLen {
		return ErrInvalidLastName
	}
	if req.Nickname != nil && (!alphaPattern.MatchString(*req.Nickname) || len(*req.Nickname) < MinNicknameLen || len(*req.Nickname) > MaxNicknameLen) {
		return ErrInvalidNickname
	}
	if req.AboutMe != nil && (len(*req.AboutMe) < MinAboutMeLen || len(*req.AboutMe) > MaxAboutMeLen) {
		return ErrInvalidAboutMe
	}
	if err := ValidateAge(req.DateOfBirth); err != nil {
		return err
	}
	if !IsValidAvatar(req.Avatar) {
		return ErrInvalidAvatar
	}
	return nil
}

func ValidateLoginRequest(req LoginRequest) error {
	if !IsValidEmail(req.Email) {
		return ErrInvalidEmail
	}
	if !IsValidPassword(req.Password) {
		return ErrInvalidPassword
	}
	return nil
}

func IsValidEmail(email string) bool {
	return len(email) <= MaxEmailLen && emailPattern.MatchString(email)
}

func IsValidPassword(password string) bool {
	if len(password) < 8 || len(password) > 24 {
		return false
	}
	var hasLetter, hasNumber, hasSymbol bool
	for _, r := range password {
		if r == ' ' {
			return false
		}
		if r < 33 || r > 126 {
			return false
		}
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			hasLetter = true
		} else if r >= '0' && r <= '9' {
			hasNumber = true
		} else {
			hasSymbol = true
		}
	}
	return hasLetter && hasNumber && hasSymbol && utf8.ValidString(password)
}

func IsValidSessionToken(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false
	}
	if _, err := uuid.FromString(parts[0]); err != nil {
		return false
	}
	if _, err := uuid.FromString(parts[1]); err != nil {
		return false
	}
	return true
}

func IsValidAvatar(avatar *string) bool {
	if avatar == nil {
		return true
	}

	matches := avatarDataURLRe.FindStringSubmatch(*avatar)
	if len(matches) != 3 {
		return false
	}

	data, err := base64.StdEncoding.DecodeString(matches[2])
	if err != nil {
		return false
	}
	if len(data) == 0 || len(data) > maxAvatarBytes {
		return false
	}
	return avatarContentType(matches[1]) == http.DetectContentType(firstBytes(data, 512))
}

func avatarContentType(format string) string {
	if format == "jpg" {
		return "image/jpeg"
	}
	return "image/" + format
}

func firstBytes(data []byte, limit int) []byte {
	if len(data) < limit {
		return data
	}
	return data[:limit]
}

func trimOptional(value **string) {
	if *value == nil {
		return
	}

	trimmed := strings.TrimSpace(**value)
	if trimmed == "" {
		*value = nil
		return
	}
	*value = &trimmed
}

func ValidateAge(dateOfBirth string) error {
	dob, err := time.Parse("2006-01-02", dateOfBirth)
	if err != nil {
		return ErrInvalidAge
	}
	now := time.Now()
	age := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		age--
	}
	if age < 18 || age > 70 {
		return ErrInvalidAge
	}
	return nil
}

func isSafeText(value string) bool {
	return value != "" && !htmlUnsafeChars.MatchString(value)
}

func isSafeOptionalText(value *string) bool {
	return value == nil || !htmlUnsafeChars.MatchString(*value)
}
