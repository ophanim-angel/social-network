"use client";

import React, { useState, useRef, useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { 
  acceptFollowRequest, 
  declineFollowRequest, 
  respondToGroupInvitation, 
  respondToGroupJoinRequest 
} from "@/lib/api";
import styles from "./NotificationDropdown.module.css";

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { socialNotifications, socialUnreadCount, removeSocialNotification } = useWebSocket();

  const handleToggle = () => setIsOpen(!isOpen);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAction = async (notification, action) => {
    const { id, type, source_id, group_id, user_id } = notification;

    try {
      if (type === "follow_request") {
        if (action === "accept") {
          await acceptFollowRequest(source_id);
        } else {
          await declineFollowRequest(source_id);
        }
      } else if (type === "group_invite") {
        const gId = group_id || source_id;
        await respondToGroupInvitation(gId, action === "accept" ? "accepted" : "declined");
      } else if (type === "group_request") {
        const gId = group_id || source_id;
        const uId = user_id; 
        await respondToGroupJoinRequest(gId, uId, action === "accept" ? "accepted" : "declined");
      }

      removeSocialNotification(id);
    } catch (err) {
      console.error(`Failed to ${action} ${type}:`, err);
    }
  };

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button 
        className={styles.bellButton} 
        onClick={handleToggle}
        title="Social Notifications"
      >
        <span className={styles.bellIcon}>🔔</span>
        {socialUnreadCount > 0 && (
          <span className={styles.badge}>{socialUnreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className={styles.dropdown}>
          <div className={styles.header}>Social Notifications</div>
          <ul className={styles.list}>
            {socialNotifications.length === 0 ? (
              <li className={styles.empty}>No new notifications</li>
            ) : (
              socialNotifications.map((notif) => (
                <li key={notif.id} className={styles.item}>
                  <div className={styles.content}>{notif.content}</div>
                  <div className={styles.actions}>
                    <button 
                      className={styles.acceptBtn}
                      onClick={() => handleAction(notif, "accept")}
                    >
                      Accept
                    </button>
                    <button 
                      className={styles.declineBtn}
                      onClick={() => handleAction(notif, "decline")}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
