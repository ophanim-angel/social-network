"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCurrentUser, isUnauthorized, logout } from "@/lib/api";
import { hasSession, removeSession, sessionStorageKey } from "@/lib/session";
import AuthNavbar from "./AuthNavbar";

const authRoutes = new Set(["/login", "/register"]);

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const isAuthRoute = authRoutes.has(pathname);
  const hasLocalSession = isMounted && hasSession();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    let isActive = true;

    if (!isMounted) {
      return () => {
        isActive = false;
      };
    }

    if (!hasLocalSession) {
      setIsCheckingSession(false);
      if (!isAuthRoute) {
        router.replace("/login");
      }
      return () => {
        isActive = false;
      };
    }

    if (isAuthRoute) {
      setIsCheckingSession(false);
      router.replace("/");
      return () => {
        isActive = false;
      };
    }

    setIsCheckingSession(true);
    getCurrentUser()
      .then((data) => {
        if (isActive) {
          setUser(data);
          setIsCheckingSession(false);
        }
      })
      .catch((err) => {
        if (isActive) {
          if (isUnauthorized(err)) {
            setUser(null);
            removeSession();
            router.replace("/login");
          } else {
            setIsCheckingSession(false);
          }
        }
      });

    return () => {
      isActive = false;
    };
  }, [isMounted, hasLocalSession, isAuthRoute, router]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key !== sessionStorageKey) {
        return;
      }

      if (event.newValue === "active") {
        if (authRoutes.has(window.location.pathname)) {
          router.replace("/");
        }
        return;
      }

      setUser(null);
      if (!authRoutes.has(window.location.pathname)) {
        logout().catch(() => {});
        router.replace("/login");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [router]);

  useEffect(() => {
    const logoutIfLocalSessionWasRemoved = () => {
      if (authRoutes.has(window.location.pathname)) {
        return;
      }
      if (hasSession()) {
        return;
      }

      setUser(null);
      logout().catch(() => {});
      if (!authRoutes.has(window.location.pathname)) {
        router.replace("/login");
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        logoutIfLocalSessionWasRemoved();
      }
    };

    window.addEventListener("focus", logoutIfLocalSessionWasRemoved);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", logoutIfLocalSessionWasRemoved);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  if (!isMounted) {
    return null;
  }

  if (isAuthRoute) {
    return children;
  }

  if (isCheckingSession || !user) {
    return null;
  }

  // If session exists locally, render content immediately to avoid 'freeze' 
  // until getCurrentUser resolves.
  if (hasLocalSession) {
    return (
      <>
        <AuthNavbar user={user} />
        {children}
      </>
    );
  }

  // If no session, wait for useEffect to redirect
  return null;
}
