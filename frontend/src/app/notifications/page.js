"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import React, { useEffect, useState, useCallback } from "react";
import { 
  getNotifications, 
  isUnauthorized,
  markNotificationRead, 
} from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const { realtimeNotifications, setRealtimeNotifications, setHasUnreadNotifications } = useWebSocket();

  const fetchData = useCallback(async () => {
    try {
      const notifs = await getNotifications();
      setNotifications(notifs || []);
    } catch (err) {
      if (!isUnauthorized(err)) {
        console.error("Failed to load notifications data:", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Clear the unread indicator when the page is opened
    if (setHasUnreadNotifications) setHasUnreadNotifications(false);
  }, [fetchData, setHasUnreadNotifications]);

  const handleMarkRead = async (id) => {
    try {
      // Instantly remove from local state
      setNotifications(prev => prev.filter(n => n.id !== id));
      setRealtimeNotifications(prev => prev.filter(n => n.id !== id));
      
      await markNotificationRead(id);
    } catch (err) {
      if (!isUnauthorized(err)) {
        console.error("Failed to mark notification as read:", err);
      }
    }
  };

  const allNotifications = [...realtimeNotifications, ...notifications].reduce((acc, current) => {
    if (!acc.find(item => item.id === current.id)) {
      return acc.concat([current]);
    }
    return acc;
  }, []);

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1>Notifications</h1>
      </header>

      {loading ? (
        <p style={infoStyle}>Loading notifications...</p>
      ) : allNotifications.length === 0 ? (
        <div style={emptyStyle}>
          <span style={{ fontSize: "3rem" }}>📭</span>
          <p>You&apos;re all caught up!</p>
        </div>
      ) : (
        <ul style={listStyle}>
          {allNotifications.map((notif) => (
            <li key={notif.id} style={{
              ...itemStyle,
              background: notif.is_read ? "transparent" : "rgba(255, 255, 255, 0.05)"
            }}>
              <div style={iconStyle}>{getIcon(notif.type)}</div>
              <div style={{ flex: 1 }}>
                <p style={textStyle}>{notif.content || `New ${notif.type} notification`}</p>
                <small style={timeStyle}>{new Date(notif.created_at).toLocaleString()}</small>
              </div>
              <button onClick={() => handleMarkRead(notif.id)} style={readButtonStyle}>
                Mark Read
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function getIcon(type) {
  switch (type) {
    case "follow":
    case "follow_accept": return "👤";
    case "follow_request": return "📩";
    case "group_invite": return "👥";
    case "group_request":
    case "group_request_response": return "📩";
    case "group_event":
    case "event": return "📅";
    default: return "🔔";
  }
}

const containerStyle = { maxWidth: "800px", margin: "2rem auto", padding: "0 1rem" };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", color: "var(--text-main, #ffffff)" };
const listStyle = { listStyle: "none", padding: 0, margin: 0, background: "var(--bg-sidebar, #1e1e1e)", borderRadius: "8px", border: "1px solid var(--border-color, #333)", boxShadow: "0 4px 6px rgba(0, 0, 0, 0.5)" };
const itemStyle = { padding: "1.25rem", borderBottom: "1px solid var(--border-color, #333)", display: "flex", alignItems: "center", gap: "1rem", color: "var(--text-main, #ffffff)" };
const iconStyle = { fontSize: "1.5rem" };
const textStyle = { margin: 0, fontWeight: "500", color: "var(--text-main, #ffffff)" };
const timeStyle = { color: "var(--text-secondary, #aaaaaa)", fontSize: "0.8rem" };
const readButtonStyle = { background: "#2a2a2a", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer" };
const infoStyle = { textAlign: "center", padding: "2rem", color: "var(--text-secondary, #aaaaaa)" };
const emptyStyle = { textAlign: "center", padding: "4rem 2rem", background: "var(--bg-sidebar, #1e1e1e)", borderRadius: "8px", border: "1px solid var(--border-color, #333)", boxShadow: "0 4px 6px rgba(0, 0, 0, 0.5)", color: "var(--text-main, #ffffff)" };
