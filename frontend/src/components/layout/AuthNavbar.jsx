"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/api";
import { removeSession } from "@/lib/session";
import NavIcons from "./NavIcons";
import styles from "./AuthNavbar.module.css";

export default function AuthNavbar({ user }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const avatarInitial = user?.first_name?.trim()?.charAt(0)?.toUpperCase() || "?";

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isMenuOpen]);

  const handleLogout = async () => {
    setIsLoading(true);
    removeSession();
    router.replace("/login");

    try {
      await logout();
    } catch {
      // The local session is already cleared; logout is best-effort server cleanup.
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <header className={styles.navbar}>
      <Link href="/" className={styles.titleLink}>
        BNI DRAR FORUM
      </Link>

      <nav className={styles.navActions} aria-label="Main navigation">
        <Link href="/groups" className={styles.navLink}>
          Groups
        </Link>

        <NavIcons />

        <div className={styles.avatarMenu} ref={menuRef}>
          <button
            type="button"
            className={styles.avatarButton}
            aria-label="Account menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            {user?.avatar ? (
              <span
                className={styles.avatarImage}
                style={{ backgroundImage: `url(${user.avatar})` }}
              />
            ) : (
              <span className={styles.avatarInitial}>{avatarInitial}</span>
            )}
          </button>

          <div className={`${styles.menuList} ${isMenuOpen ? styles.menuListOpen : ""}`}>
            <Link href="/profile" className={styles.menuItem} onClick={() => setIsMenuOpen(false)}>
              Profile
            </Link>
            <button
              type="button"
              className={styles.menuItem}
              onClick={handleLogout}
              disabled={isLoading}
            >
              {isLoading ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </nav>
    </header>
  );
}
