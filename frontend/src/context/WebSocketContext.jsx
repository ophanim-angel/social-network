"use client";

/* eslint-disable react-hooks/immutability */

import React, { createContext, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { hasSession } from "@/lib/session";
import { getCurrentUser } from "@/lib/api";

export const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const [realtimeMessages, setRealtimeMessages] = useState([]);
  const [realtimeNotifications, setRealtimeNotifications] = useState([]);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [unreadChatIds, setUnreadChatIds] = useState([]);
  const [lastActivityMap, setLastActivityMap] = useState({});
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [me, setMe] = useState(null);
  const [activeChat, setActiveChat] = useState(null);

  const meRef = useRef(null);
  const activeChatRef = useRef(null);

  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => {
    if (hasSession()) {
      getCurrentUser()
        .then(setMe)
        .catch((err) => {
          if (err?.status !== 401) {
            console.error(err);
          }
        });
    }
  }, [pathname]);

  // Social notifications filtering (only for convenience, count is state-based)
  const socialNotifications = useMemo(() => {
    return realtimeNotifications.filter(isSocialNotificationType);
  }, [realtimeNotifications]);

  const removeSocialNotification = useCallback((id) => {
    setRealtimeNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const markAsRead = useCallback((targetId, type = null) => {
    // If type is provided (e.g. 'private' or 'group'), we can target specific prefixed ID
    // If not, we try to clear both prefixed versions and the raw ID for safety
    if (type) {
      const uniqueId = `${type}_${targetId}`;
      setUnreadChatIds(prev => prev.filter(id => id !== uniqueId));
    } else {
      setUnreadChatIds(prev => prev.filter(id => id !== targetId && id !== `private_${targetId}` && id !== `group_${targetId}`));
    }

    setRealtimeNotifications((prev) => {
      const updated = prev.filter(n => 
        n.sender_id !== targetId && n.group_id !== targetId && n.source_id !== targetId
      );
      
      const remainingChatNotifs = updated.filter(n => !n.type);
      if (remainingChatNotifs.length === 0) {
        setHasNewMessage(false);
      }
      
      return updated;
    });
  }, []);

  const connect = useCallback(() => {
    const isAuthPage = pathname === "/login" || pathname === "/register";
    if (!hasSession() || isAuthPage || !me) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;

    const wsUrl = buildWebSocketURL(process.env.NEXT_PUBLIC_WS_URL);
    console.log("Connecting to WebSocket:", wsUrl);
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("🟢 WS Connected");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data);
        const currentMe = meRef.current;
        const currentActiveChat = activeChatRef.current;

        if (incoming.type === "notification") {
          setHasUnreadNotifications(true);
          window.dispatchEvent(new Event('new_social_notification'));
          return;
        }

        const isNotification = isSocialNotificationType(incoming) ||
                               incoming.notification_id || 
                               !incoming.content || 
                               (!incoming.sender_id && !incoming.receiver_id && !incoming.group_id);

        if (isNotification) {
          // Filter out our own messages if the backend echoes them (safety)
          if (currentMe && incoming.sender_id === currentMe.id) return;

          // Strictly for Social/System Notifications
          setHasUnreadNotifications(true);
          
          // Force real-time event for UI sync
          window.dispatchEvent(new Event('new_social_notification'));

          setRealtimeNotifications((prev) => {
            if (prev.some((n) => n.id === incoming.id)) return prev;
            return [incoming, ...prev];
          });
        } else {
          // It's a Chat Message
          setRealtimeMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });

          const isMe = currentMe && incoming.sender_id === currentMe.id;

          // Real-time 'Jump to Top'
          const chatType = incoming.group_id ? 'group' : 'private';
          const targetIdForMap = incoming.group_id || (isMe ? incoming.receiver_id : incoming.sender_id);
          const uniqueIdForMap = `${chatType}_${targetIdForMap}`;
          if (targetIdForMap) {
            setLastActivityMap(prev => ({ ...prev, [uniqueIdForMap]: Date.now() }));
          }

          if (isMe) return;

          const isChatRoute = typeof window !== 'undefined' ? window.location.pathname.includes('/chat') : false;
          const isLookingAtChat = isChatRoute && currentActiveChat && (
              (incoming.group_id && currentActiveChat.id === incoming.group_id) || 
              (!incoming.group_id && currentActiveChat.id === incoming.sender_id)
          );

          if (!isLookingAtChat) {
            setHasNewMessage(true);
            const type = incoming.group_id ? 'group' : 'private';
            const targetId = incoming.group_id || incoming.sender_id;
            const uniqueId = `${type}_${targetId}`;
            setUnreadChatIds(prev => Array.from(new Set([...prev, uniqueId])));
          }
        }
      } catch (err) {
        console.error("WS error parsing message:", err);
      }
    };

    ws.onclose = () => {
      socketRef.current = null;
      if (hasSession() && pathname !== "/login" && pathname !== "/register") {
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        }
      }
    };

    ws.onerror = (err) => console.error("WS error:", err.type, err.target?.url);
  }, [pathname, me]);

  const sendMessage = useCallback((message) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
      
      // Real-time 'Jump to Top' on sending
      const chatType = message.group_id ? 'group' : 'private';
      const targetIdForMap = message.group_id || message.receiver_id;
      const uniqueIdForMap = `${chatType}_${targetIdForMap}`;
      setLastActivityMap(prev => ({ ...prev, [uniqueIdForMap]: Date.now() }));

      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect]);

  const value = {
    realtimeMessages,
    realtimeNotifications,
    setRealtimeNotifications,
    unreadChatIds,
    lastActivityMap,
    setLastActivityMap,
    socialNotifications,
    hasUnreadNotifications,
    setHasUnreadNotifications,
    hasNewMessage,
    activeChat,
    setActiveChat,
    sendMessage,
    markAsRead,
    removeSocialNotification,
    me,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};

function isSocialNotificationType(item) {
  return (
    item?.type === "follow_request" ||
    item?.type === "follow_accept" ||
    item?.type === "group_invite" ||
    item?.type === "group_request" ||
    item?.type === "group_request_response" ||
    item?.type === "group_event"
  );
}

function buildWebSocketURL(configuredURL) {
  const fallback = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}:8080/ws`;
  const value = configuredURL || fallback;

  try {
    const url = new URL(value, window.location.href);
    if (isLoopbackHost(url.hostname) && isLoopbackHost(window.location.hostname)) {
      url.hostname = window.location.hostname;
    }
    return url.toString();
  } catch {
    return fallback;
  }
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
