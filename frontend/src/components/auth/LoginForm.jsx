"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { MaxEmailLen, validateAuthFields } from "@/lib/authValidation";
import { saveSession } from "@/lib/session";
import Notification from "@/components/ui/Notification";
import styles from "./LoginForm.module.css";

// Login form handles user sign in.
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState({ message: "", type: "" });

  // Close the current notification message.
  const closeNotification = () => {
    setNotification({ message: "", type: "" });
  };

  // Handle login form submission.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setNotification({ message: "", type: "" });
    setIsLoading(true);

    try {
      // Prepare trimmed credentials for API request.
      const credentials = {
        email: email.trim(),
        password,
      };
      const authError = validateAuthFields(credentials);
      if (authError) {
        throw new Error(authError);
      }

      await login(credentials.email, credentials.password);
      saveSession();
      setNotification({ message: "Login successful! Redirecting...", type: "success" });
      setTimeout(() => {
        router.push("/");
      }, 100);
    } catch (err) {
      setNotification({ message: err.message || "Failed to login. Please check your credentials.", type: "error" });
      setIsLoading(false);
    }
  };

  // Render the login form UI.
  return (
    <div className={styles.formContainer}>
      <Notification 
        message={notification.message} 
        type={notification.type} 
        onClose={closeNotification} 
      />
      <h2 className={styles.title}>Login</h2>
      
      <form onSubmit={handleSubmit}>
        <div className={styles.formGroup}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={MaxEmailLen}
            placeholder="you@example.com"
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength="8"
            maxLength="24"
            placeholder="••••••••"
          />
        </div>

        <button type="submit" className={styles.button} disabled={isLoading}>
          {isLoading ? "Logging in..." : "Login"}
        </button>
      </form>

      <p className={styles.authSwitch}>
        Don&apos;t have an account? <Link href="/register">Register</Link>
      </p>
    </div>
  );
}
