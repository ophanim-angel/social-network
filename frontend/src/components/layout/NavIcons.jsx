"use client";

import React from "react";
import Link from "next/link";
import { useWebSocket } from "@/hooks/useWebSocket";
import NotificationDropdown from "@/components/ui/NotificationDropdown";

export default function NavIcons() {
  const { hasNewMessage, unreadCount } = useWebSocket();

  // unreadCount here represents generic notifications (likes, followers, etc.)
  // hasNewMessage represents chat specifically.

  return (
    <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
      {/* Chat Link 💬 */}
      <Link 
        href="/chat" 
        style={containerStyle} 
        title="Messages"
      >
        <span style={{ fontSize: "24px" }}>💬</span>
        {hasNewMessage && (
          <div style={dotStyle} />
        )}
      </Link>

      {/* Social Notification Dropdown 🔔 */}
      <NotificationDropdown />

      {/* General Notification Link ⚡ (Optional extra for other system notifications) */}
      <Link 
        href="/notifications" 
        style={containerStyle} 
        title="All Activity"
      >
        <span style={{ fontSize: "24px" }}>⚡</span>
        {unreadCount > 0 && (
          <span style={badgeStyle}>{unreadCount}</span>
        )}
      </Link>
    </div>
  );
}

const containerStyle = {
  position: "relative",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  color: "inherit",
};

const dotStyle = {
  position: "absolute",
  top: "0px",
  right: "0px",
  background: "#ff4d4f",
  width: "10px",
  height: "10px",
  borderRadius: "50%",
  border: "2px solid white",
};

const badgeStyle = {
  position: "absolute",
  top: "-5px",
  right: "-5px",
  background: "#007bff",
  color: "white",
  border-radius: "50%",
  width: "18px",
  height: "18px",
  fontSize: "11px",
  fontWeight: "bold",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 0 0 2px white",
};
