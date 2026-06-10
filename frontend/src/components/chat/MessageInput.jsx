"use client";

import React, { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useWebSocket } from "@/hooks/useWebSocket";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

export default function MessageInput({ target, onSendMessage }) {
  const [content, setContent] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef(null);
  const cursorRef = useRef(0);
  const { sendMessage } = useWebSocket();

  const handleSend = (e) => {
    if (e) e.preventDefault();
    if (!content.trim()) return;

    const isGroup = target?.type === "group";
    const targetId = isGroup ? target?.id || target?.group_id : target?.id || target?.user_id;
    if (!targetId) return;

    const messageData = {
      content: content.trim(),
    };

    if (isGroup) {
      messageData.group_id = targetId;
    } else {
      messageData.receiver_id = targetId;
    }

    if (sendMessage(messageData)) {
      if (onSendMessage) {
        onSendMessage(messageData);
      }
      setContent("");
      setShowEmojiPicker(false);
    }
  };

  const handleKeyDown = (e) => {
    cursorRef.current = e.currentTarget.selectionStart ?? content.length;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onEmojiClick = (emojiData) => {
    const cursorPos = cursorRef.current;

    setContent((prev) => {
      const safePos = Math.min(cursorPos, prev.length);
      return prev.slice(0, safePos) + emojiData.emoji + prev.slice(safePos);
    });

    const newCursorPos = cursorPos + emojiData.emoji.length;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        cursorRef.current = newCursorPos;
      }
    }, 0);
  };

  const handleContentChange = (e) => {
    setContent(e.target.value);
    cursorRef.current = e.target.selectionStart ?? e.target.value.length;
  };

  const rememberCursor = (e) => {
    cursorRef.current = e.currentTarget.selectionStart ?? content.length;
  };

  return (
    <div style={formStyle}>
      <div style={emojiPickerContainerStyle}>
        <button
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          style={emojiButtonStyle}
          title="Add emoji"
        >
          😀
        </button>
        {showEmojiPicker && (
          <div style={pickerWrapperStyle}>
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              theme="dark"
              searchDisabled
              skinTonesDisabled
              width={300}
              height={400}
            />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={content}
        onChange={handleContentChange}
        onKeyDown={handleKeyDown}
        onClick={rememberCursor}
        onKeyUp={rememberCursor}
        onSelect={rememberCursor}
        onBlur={rememberCursor}
        placeholder="Type a message..."
        style={inputStyle}
      />
      <button
        type="button"
        onClick={() => handleSend()}
        style={buttonStyle}
        disabled={!content.trim()}
      >
        Send
      </button>
    </div>
  );
}

const formStyle = {
  display: "flex",
  padding: "1rem",
  borderTop: "1px solid var(--border)",
  gap: "0.5rem",
  background: "var(--background)",
  position: "relative",
};

const emojiPickerContainerStyle = {
  display: "flex",
  alignItems: "center",
};

const emojiButtonStyle = {
  background: "none",
  border: "none",
  color: "var(--foreground)",
  fontSize: "1.2rem",
  cursor: "pointer",
  padding: "0 0.5rem",
};

const pickerWrapperStyle = {
  position: "absolute",
  bottom: "100%",
  left: "10px",
  marginBottom: "10px",
  zIndex: 1000,
};

const inputStyle = {
  flex: 1,
  padding: "0.5rem 0.75rem",
  borderRadius: "20px",
  border: "1px solid var(--border)",
  outline: "none",
  fontSize: "0.9rem",
  background: "var(--surface)",
  color: "var(--foreground)",
};

const buttonStyle = {
  background: "var(--primary)",
  color: "var(--text-bubble-me)",
  border: "none",
  borderRadius: "20px",
  padding: "0.5rem 1rem",
  cursor: "pointer",
  fontWeight: "bold",
  fontSize: "0.9rem",
};
