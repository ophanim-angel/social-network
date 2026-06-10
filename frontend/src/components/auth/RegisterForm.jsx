"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "@/lib/api";
import { validateAuthFields, validateAvatarFile, validateSafeText, MaxEmailLen, MinNameLen, MaxNameLen, MinNicknameLen, MaxNicknameLen, MinAboutMeLen, MaxAboutMeLen } from "@/lib/authValidation";
import Notification from "@/components/ui/Notification";
import styles from "./RegisterForm.module.css";

// Registration form handles new account creation.
export default function RegisterForm() {
  const router = useRouter();
  // Keep a ref to the file input element for avatar uploads.
  const fileInputRef = useRef(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    nickname: "",
    about_me: "",
    avatar: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState({ message: "", type: "" });

  const closeNotification = () => {
    setNotification({ message: "", type: "" });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Validate and preview the selected avatar image.
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const avatarError = await validateAvatarFile(file);
      if (avatarError) {
        setNotification({ message: avatarError, type: "error" });
        if (fileInputRef.current) fileInputRef.current.value = "";
        setFormData((prev) => ({
          ...prev,
          avatar: "",
        }));
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({
          ...prev,
          avatar: reader.result,
        }));
      };
      reader.readAsDataURL(file);
    } else {
      setFormData((prev) => ({
        ...prev,
        avatar: "",
      }));
    }
  };

  // Handle registration form submission.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setNotification({ message: "", type: "" });
    setIsLoading(true);

    try {
      const trimmedData = {
        ...formData,
        email: formData.email.trim(),
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        date_of_birth: formData.date_of_birth.trim(),
        gender: formData.gender.trim(),
        nickname: formData.nickname.trim() || null,
        about_me: formData.about_me.trim() || null,
        avatar: formData.avatar || null,
      };
      const authError = validateAuthFields(trimmedData);
      if (authError) {
        throw new Error(authError);
      }
      if (!validateSafeText(trimmedData.first_name) || !validateSafeText(trimmedData.last_name) || !validateSafeText(trimmedData.nickname || "") || !validateSafeText(trimmedData.about_me || "")) {
        throw new Error("Text fields cannot contain HTML characters.");
      }

      if (trimmedData.date_of_birth) {
        const dob = new Date(trimmedData.date_of_birth);
        const now = new Date();
        let age = now.getFullYear() - dob.getFullYear();
        const monthDiff = now.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
          age--;
        }
        if (age < 18 || age > 70) {
          throw new Error("Age must be between 18 and 70.");
        }
      }

      await register(trimmedData);
      setNotification({ message: "Registration successful! Redirecting...", type: "success" });
      setTimeout(() => {
        router.replace("/login");
      }, 1000);
    } catch (err) {
      setNotification({ message: err.message || "Failed to register. Please try again.", type: "error" });
      setIsLoading(false);
    }
  };

  // Render the registration form UI.
  return (
    <div className={styles.formContainer}>
      <Notification
        message={notification.message}
        type={notification.type}
        onClose={closeNotification}
      />
      <h2 className={styles.title}>Register</h2>

      <form onSubmit={handleSubmit}>
        <div className={styles.formGroup}>
          <label htmlFor="email">Email *</label>
          <input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            required
            maxLength={MaxEmailLen}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="password">Password *</label>
          <input
            id="password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            required
            minLength="8"
            maxLength="24"
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="nickname">Nickname (Optional)</label>
          <input
            id="nickname"
            name="nickname"
            type="text"
            value={formData.nickname}
            onChange={handleChange}
            minLength={MinNicknameLen}
            maxLength={MaxNicknameLen}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="first_name">First Name *</label>
          <input
            id="first_name"
            name="first_name"
            type="text"
            value={formData.first_name}
            onChange={handleChange}
            required
            minLength={MinNameLen}
            maxLength={MaxNameLen}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="last_name">Last Name *</label>
          <input
            id="last_name"
            name="last_name"
            type="text"
            value={formData.last_name}
            onChange={handleChange}
            required
            minLength={MinNameLen}
            maxLength={MaxNameLen}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="date_of_birth">Date of Birth *</label>
          <input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            value={formData.date_of_birth}
            onChange={handleChange}
            required
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="gender">Gender *</label>
          <select
            id="gender"
            name="gender"
            value={formData.gender}
            onChange={handleChange}
            required
            style={{ padding: "0.75rem", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "1rem" }}
          >
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="about_me">About Me (Optional)</label>
          <textarea
            id="about_me"
            name="about_me"
            value={formData.about_me}
            onChange={handleChange}
            rows="3"
            minLength={MinAboutMeLen}
            maxLength={MaxAboutMeLen}
            style={{ padding: "0.75rem", borderRadius: "4px", border: "1px solid var(--border)", fontSize: "1rem", fontFamily: "inherit" }}
          ></textarea>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="avatar">Avatar Image (Optional)</label>
          <input
            id="avatar"
            name="avatar"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            ref={fileInputRef}
            style={{ padding: "0.5rem 0" }}
          />
        </div>

        <button type="submit" className={styles.button} disabled={isLoading}>
          {isLoading ? "Registering..." : "Register"}
        </button>
      </form>

      <p className={styles.authSwitch}>
        Already have an account? <Link href="/login">Login</Link>
      </p>
    </div>
  );
}
