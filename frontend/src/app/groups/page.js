"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGroup,
  createGroupComment,
  createGroupEvent,
  createGroupPost,
  getFollowers,
  getGroup,
  getGroupInvitations,
  getGroups,
  getGroupPost,
  inviteToGroup,
  mediaUrl,
  requestToJoinGroup,
  respondToGroupEvent,
  respondToGroupInvitation,
  respondToGroupJoinRequest,
} from "@/lib/api";
import {
  MaxCommentLen,
  MaxEventDescriptionLen,
  MaxEventTitleLen,
  MaxGroupDescriptionLen,
  MaxGroupInviteesLen,
  MaxGroupPostLen,
  MaxGroupTitleLen,
  MaxImageSizeBytes,
  MaxImageSizeMB,
} from "@/lib/limits";
import Notification from "@/components/ui/Notification";
import styles from "./Groups.module.css";

export default function GroupsPage() {
  const [groups, setGroups] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [detail, setDetail] = useState(null);
  const [expandedPosts, setExpandedPosts] = useState({});
  const [createInviteIds, setCreateInviteIds] = useState([]);
  const [memberInviteId, setMemberInviteId] = useState("");
  const [postImage, setPostImage] = useState(null);
  const [commentImages, setCommentImages] = useState({});
  const [drafts, setDrafts] = useState({
    title: "",
    description: "",
    invitees: "",
    inviteUser: "",
    post: "",
    eventTitle: "",
    eventDescription: "",
    eventTime: "",
  });
  const [commentDrafts, setCommentDrafts] = useState({});
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [activeInviteField, setActiveInviteField] = useState("");

  const refreshGroups = useCallback(async () => {
    try {
      const [groupList, inviteList, followerList] = await Promise.all([
        getGroups(),
        getGroupInvitations(),
        getFollowers(),
      ]);
      setGroups(groupList || []);
      setInvitations(inviteList || []);
      setFollowers(followerList || []);
      if (!selectedGroupId && groupList?.[0]) {
        setSelectedGroupId(groupList[0].id);
      }
    } catch (err) {
      setError(err.message || "Could not load groups");
    } finally {
      setIsLoading(false);
    }
  }, [selectedGroupId]);

  const loadGroup = useCallback(async (groupId) => {
    try {
      const nextDetail = await getGroup(groupId);
      setDetail(nextDetail);
      setExpandedPosts({});
    } catch (err) {
      setError(err.message || "Could not load group");
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialGroups() {
      try {
        const [groupList, inviteList, followerList] = await Promise.all([
          getGroups(),
          getGroupInvitations(),
          getFollowers(),
        ]);
        if (!isMounted) return;
        setGroups(groupList || []);
        setInvitations(inviteList || []);
        setFollowers(followerList || []);
        if (!selectedGroupId && groupList?.[0]) {
          setSelectedGroupId(groupList[0].id);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Could not load groups");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialGroups();
    return () => {
      isMounted = false;
    };
  }, [selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) return;
    let isMounted = true;

    async function loadSelectedGroup() {
      try {
        const nextDetail = await getGroup(selectedGroupId);
        if (!isMounted) return;
        setDetail(nextDetail);
        setExpandedPosts({});
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Could not load group");
        }
      }
    }

    loadSelectedGroup();
    return () => {
      isMounted = false;
    };
  }, [selectedGroupId]);

  const selectedGroup = detail?.group;
  const isMember = Boolean(selectedGroup?.is_member);
  const isCreator = Boolean(detail?.requests);
  const minEventTime = formatDateTimeLocal(new Date());
  const createInviteSuggestions = useMemo(
    () => getMentionSuggestions(drafts.invitees, followers, true, createInviteIds),
    [drafts.invitees, followers, createInviteIds],
  );
  const memberInviteSuggestions = useMemo(
    () => getMentionSuggestions(drafts.inviteUser, followers, false, memberInviteId ? [memberInviteId] : []),
    [drafts.inviteUser, followers, memberInviteId],
  );

  function updateDraft(key, value) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function focusInviteField(field, key) {
    setActiveInviteField(field);
    setDrafts((current) => {
      const value = current[key];
      if (hasActiveMention(value, field === "create")) {
        return current;
      }

      return { ...current, [key]: appendMentionTrigger(value, field === "create") };
    });
  }

  function selectCreateInvite(user) {
    setCreateInviteIds((current) => (current.includes(user.id) ? current : [...current, user.id]));
    updateDraft("invitees", replaceMentionToken(drafts.invitees, displayName(user), true));
    setActiveInviteField("create");
  }

  function selectMemberInvite(user) {
    setMemberInviteId(user.id);
    updateDraft("inviteUser", displayName(user));
    setActiveInviteField("member");
  }

  function handleCreateInviteChange(value) {
    updateDraft("invitees", value);
    const labels = new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
    setCreateInviteIds((current) =>
      current.filter((userId) => {
        const user = followers.find((item) => item.id === userId);
        return user && labels.has(displayName(user).toLowerCase());
      }),
    );
  }

  async function handleCreateGroup(event) {
    event.preventDefault();
    setError("");
    try {
      const group = await createGroup({
        title: drafts.title,
        description: drafts.description,
        inviteeUserIds: createInviteIds,
      });
      setDrafts((current) => ({
        ...current,
        title: "",
        description: "",
        invitees: "",
      }));
      setCreateInviteIds([]);
      await refreshGroups();
      setSelectedGroupId(group.id);
    } catch (err) {
      setError(err.message || "Could not create group");
    }
  }

  async function handleRequestJoin(groupId) {
    setError("");
    try {
      await requestToJoinGroup(groupId);
      await refreshGroups();
      await loadGroup(groupId);
    } catch (err) {
      setError(err.message || "Could not request access");
    }
  }

  async function handleInvitation(groupId, status) {
    setError("");
    try {
      await respondToGroupInvitation(groupId, status);
      await refreshGroups();
      await loadGroup(groupId);
    } catch (err) {
      setError(err.message || "Could not update invitation");
    }
  }

  async function handleJoinRequest(userId, status) {
    setError("");
    try {
      await respondToGroupJoinRequest(selectedGroupId, userId, status);
      await loadGroup(selectedGroupId);
      await refreshGroups();
    } catch (err) {
      setError(err.message || "Could not update request");
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    if (!memberInviteId || !selectedGroupId) return;
    setError("");
    try {
      await inviteToGroup(selectedGroupId, memberInviteId);
      updateDraft("inviteUser", "");
      setMemberInviteId("");
    } catch (err) {
      setError(err.message || "Could not invite user");
    }
  }

  function handleImageChange(event, setter) {
    const file = event.target.files?.[0] || null;
    if (file && file.size > MaxImageSizeBytes) {
      event.target.value = "";
      setter(null);
      setError(`Images must be ${MaxImageSizeMB} MB or smaller`);
      return;
    }
    setter(file);
  }

  async function handleCreatePost(event) {
    event.preventDefault();
    const form = getSubmitForm(event);
    setError("");
    try {
      const post = await createGroupPost(selectedGroupId, {
        content: drafts.post,
        image: postImage,
      });
      setDetail((current) => ({
        ...current,
        posts: [post, ...(current?.posts || [])],
      }));
      updateDraft("post", "");
      setPostImage(null);
      form?.reset();
    } catch (err) {
      setError(err.message || "Could not create post");
    }
  }

  async function handleToggleComments(postId) {
    if (expandedPosts[postId]) {
      setExpandedPosts((current) => {
        const next = { ...current };
        delete next[postId];
        return next;
      });
      return;
    }
    setError("");
    try {
      const postDetail = await getGroupPost(selectedGroupId, postId);
      setExpandedPosts((current) => ({
        ...current,
        [postId]: postDetail.comments || [],
      }));
    } catch (err) {
      setError(err.message || "Could not load comments");
    }
  }

  async function handleCreateComment(event, postId) {
    event.preventDefault();
    const form = getSubmitForm(event);
    setError("");
    try {
      const comment = await createGroupComment(
        selectedGroupId,
        postId,
        {
          content: commentDrafts[postId] || "",
          image: commentImages[postId] || null,
        },
      );
      setExpandedPosts((current) => ({
        ...current,
        [postId]: [...(current[postId] || []), comment],
      }));
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      setCommentImages((current) => ({ ...current, [postId]: null }));
      form?.reset();
    } catch (err) {
      setError(err.message || "Could not add comment");
    }
  }

  async function handleCreateEvent(event) {
    event.preventDefault();
    setError("");
    try {
      const eventDate = new Date(drafts.eventTime);
      if (!drafts.eventTime || Number.isNaN(eventDate.getTime())) {
        setError("event title and day/time are required");
        return;
      }
      if (eventDate <= new Date()) {
        setError("event time must be in the future");
        return;
      }
      const eventTime = eventDate.toISOString();
      const groupEvent = await createGroupEvent(selectedGroupId, {
        title: drafts.eventTitle,
        description: drafts.eventDescription,
        eventTime,
      });
      setDetail((current) => ({
        ...current,
        events: [...(current?.events || []), groupEvent],
      }));
      setDrafts((current) => ({
        ...current,
        eventTitle: "",
        eventDescription: "",
        eventTime: "",
      }));
    } catch (err) {
      setError(err.message || "Could not create event");
    }
  }

  async function handleEventResponse(eventId, response) {
    setError("");
    try {
      await respondToGroupEvent(selectedGroupId, eventId, response);
      await loadGroup(selectedGroupId);
    } catch (err) {
      setError(err.message || "Could not save event response");
    }
  }

  return (
    <div className={styles.groupsPage}>
      <Notification message={error} type="error" onClose={() => setError("")} />
      <aside className={styles.sidebar}>
        <section className={styles.panel}>
          <h1>Groups</h1>
          {isLoading ? (
            <p className={styles.muted}>Loading groups...</p>
          ) : groups.length === 0 ? (
            <p className={styles.muted}>No groups yet.</p>
          ) : (
            <div className={styles.groupList}>
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={group.id === selectedGroupId ? styles.activeGroup : ""}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <strong>{group.title}</strong>
                  <span>{group.member_count} members</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2>Create Group</h2>
          <form className={styles.stackForm} onSubmit={handleCreateGroup}>
            <input
              value={drafts.title}
              onChange={(event) => updateDraft("title", event.target.value)}
              placeholder="Title"
              maxLength={MaxGroupTitleLen}
            />
            <textarea
              value={drafts.description}
              onChange={(event) => updateDraft("description", event.target.value)}
              placeholder="Description"
              rows={3}
              maxLength={MaxGroupDescriptionLen}
            />
            <div className={styles.suggestField}>
              <input
                value={drafts.invitees}
                onFocus={() => focusInviteField("create", "invitees")}
                onBlur={() => setTimeout(() => setActiveInviteField(""), 120)}
                onChange={(event) => handleCreateInviteChange(event.target.value)}
                placeholder="First Last, First Last"
                maxLength={MaxGroupInviteesLen}
              />
              {activeInviteField === "create" && createInviteSuggestions.length > 0 && (
                <InviteSuggestions
                  users={createInviteSuggestions}
                  onSelect={selectCreateInvite}
                />
              )}
            </div>
            <button type="submit">Create</button>
          </form>
        </section>

        {invitations.length > 0 && (
          <section className={styles.panel}>
            <h2>Invitations</h2>
            <div className={styles.invitationList}>
              {invitations.map((invitation) => (
                <div key={invitation.id} className={styles.requestRow}>
                  <span>{invitation.group.title}</span>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleInvitation(invitation.group_id, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInvitation(invitation.group_id, "declined")}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>

      <main className={styles.groupMain}>
        {!selectedGroup ? (
          <section className={styles.emptyState}>Select or create a group.</section>
        ) : (
          <>
            <section className={`${styles.panel} ${styles.groupHero}`}>
              <div className={styles.groupHeader}>
                <div>
                  <h1>{selectedGroup.title}</h1>
                  <p>{selectedGroup.description || "No description."}</p>
                  <span>
                    Created by {displayName(selectedGroup.creator)} ·{" "}
                    {selectedGroup.member_count} members
                  </span>
                </div>
                {!isMember && (
                  <button
                    type="button"
                    disabled={selectedGroup.has_request}
                    onClick={() => handleRequestJoin(selectedGroup.id)}
                  >
                    {selectedGroup.has_request ? "Requested" : "Request to join"}
                  </button>
                )}
              </div>
            </section>

            {isMember ? (
              <div className={styles.contentGrid}>
                <section className={`${styles.panel} ${styles.postsPanel}`}>
                  <h2>Group Feed</h2>
                  <form className={styles.composer} onSubmit={handleCreatePost}>
                    <textarea
                      value={drafts.post}
                      onChange={(event) => updateDraft("post", event.target.value)}
                      placeholder="Share with this group"
                      rows={3}
                      maxLength={MaxGroupPostLen}
                    />
                    <div className={styles.composerActions}>
                      <label className={styles.fileButton}>
                        Image
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          onChange={(event) => handleImageChange(event, setPostImage)}
                        />
                      </label>
                      {postImage && <span className={styles.fileName}>{postImage.name}</span>}
                    </div>
                    <button type="submit">Post</button>
                  </form>
                  <div className={styles.postList}>
                    {(detail.posts || []).map((post) => (
                      <article key={post.id} className={styles.post}>
                        <header>
                          <div className={styles.authorRow}>
                            <Avatar user={post.author} />
                            <strong>{displayName(post.author)}</strong>
                          </div>
                          <span>{formatDate(post.created_at)}</span>
                        </header>
                        <p>{post.content}</p>
                        {post.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.postImage} src={mediaUrl(post.image)} alt="" />
                        )}
                        <button type="button" onClick={() => handleToggleComments(post.id)}>
                          {expandedPosts[post.id] ? "Hide comments" : "View comments"}
                        </button>
                        {expandedPosts[post.id] && (
                          <div className={styles.comments}>
                            {(expandedPosts[post.id] || []).map((comment) => (
                              <div key={comment.id} className={styles.comment}>
                                <Avatar user={comment.author} size="small" />
                                <div>
                                  <strong>{displayName(comment.author)}</strong>
                                  <span>{comment.content}</span>
                                  {comment.image && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      className={styles.commentImage}
                                      src={mediaUrl(comment.image)}
                                      alt=""
                                    />
                                  )}
                                </div>
                              </div>
                            ))}
                            <form onSubmit={(event) => handleCreateComment(event, post.id)}>
                              <input
                                value={commentDrafts[post.id] || ""}
                                onChange={(event) =>
                                  setCommentDrafts((current) => ({
                                    ...current,
                                    [post.id]: event.target.value,
                                  }))
                                }
                                placeholder="Write a comment"
                                maxLength={MaxCommentLen}
                              />
                              <label className={styles.fileButton}>
                                Image
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/gif,image/webp"
                                  onChange={(event) =>
                                    handleImageChange(event, (file) =>
                                      setCommentImages((current) => ({
                                        ...current,
                                        [post.id]: file,
                                      })),
                                    )
                                  }
                                />
                              </label>
                              <button type="submit">Send</button>
                              {commentImages[post.id] && (
                                <p className={styles.fileName}>{commentImages[post.id].name}</p>
                              )}
                            </form>
                          </div>
                        )}
                      </article>
                    ))}
                    {detail.posts?.length === 0 && (
                      <p className={styles.muted}>No group posts yet.</p>
                    )}
                  </div>
                </section>

                <aside className={styles.sideColumn}>
                  <section className={styles.panel}>
                    <h2>Events</h2>
                    <form className={styles.stackForm} onSubmit={handleCreateEvent}>
                      <input
                        value={drafts.eventTitle}
                        onChange={(event) => updateDraft("eventTitle", event.target.value)}
                        placeholder="Title"
                        maxLength={MaxEventTitleLen}
                      />
                      <textarea
                        value={drafts.eventDescription}
                        onChange={(event) =>
                          updateDraft("eventDescription", event.target.value)
                        }
                        placeholder="Description"
                        rows={2}
                        maxLength={MaxEventDescriptionLen}
                      />
                      <input
                        type="datetime-local"
                        value={drafts.eventTime}
                        min={minEventTime}
                        onChange={(event) => updateDraft("eventTime", event.target.value)}
                      />
                      <button type="submit">Create event</button>
                    </form>
                    <div className={styles.eventList}>
                      {(detail.events || []).map((event) => (
                        <article key={event.id} className={styles.event}>
                          <strong>{event.title}</strong>
                          <span>{formatDate(event.event_time)}</span>
                          <p>{event.description}</p>
                          <div className={styles.eventActions}>
                            <button
                              type="button"
                              className={event.my_response === "going" ? styles.selected : ""}
                              onClick={() => handleEventResponse(event.id, "going")}
                            >
                              Going {event.going_count}
                            </button>
                            <button
                              type="button"
                              className={
                                event.my_response === "not_going" ? styles.selected : ""
                              }
                              onClick={() => handleEventResponse(event.id, "not_going")}
                            >
                              Not going {event.not_going_count}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className={styles.panel}>
                    <h2>Members</h2>
                    <div className={styles.memberList}>
                      {(detail.members || []).map((member) => (
                        <span key={member.id}>{displayName(member)}</span>
                      ))}
                    </div>
                    <form className={styles.inlineForm} onSubmit={handleInvite}>
                      <div className={styles.suggestField}>
                        <input
                          value={drafts.inviteUser}
                          onFocus={() => focusInviteField("member", "inviteUser")}
                          onBlur={() => setTimeout(() => setActiveInviteField(""), 120)}
                          onChange={(event) => {
                            updateDraft("inviteUser", event.target.value);
                            setMemberInviteId("");
                          }}
                          placeholder="First Last"
                          maxLength={MaxGroupInviteesLen}
                        />
                        {activeInviteField === "member" &&
                          memberInviteSuggestions.length > 0 && (
                            <InviteSuggestions
                              users={memberInviteSuggestions}
                              onSelect={selectMemberInvite}
                            />
                          )}
                      </div>
                      <button type="submit">Invite</button>
                    </form>
                  </section>

                  {isCreator && detail.requests?.length > 0 && (
                    <section className={styles.panel}>
                      <h2>Join Requests</h2>
                      {detail.requests.map((request) => (
                        <div key={request.id} className={styles.requestRow}>
                          <span>{displayName(request.user)}</span>
                          <div>
                            <button
                              type="button"
                              onClick={() => handleJoinRequest(request.user_id, "accepted")}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => handleJoinRequest(request.user_id, "declined")}
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                </aside>
              </div>
            ) : (
              <section className={styles.emptyState}>
                Join the group to view posts, comments, events, and members.
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function InviteSuggestions({ users, onSelect }) {
  return (
    <div className={styles.suggestions} role="listbox">
      {users.map((user) => (
        <button
          key={user.id}
          type="button"
          role="option"
          aria-selected="false"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(user);
          }}
        >
          <strong>{displayName(user)}</strong>
          {user.nickname && <span>@{mentionHandle(user)}</span>}
        </button>
      ))}
    </div>
  );
}

function getSubmitForm(event) {
  const form = event.currentTarget || event.target;
  return form instanceof HTMLFormElement ? form : null;
}

function getMentionSuggestions(value, followers, allowCommaList, selectedUserIds = []) {
  const mention = getActiveMention(value, allowCommaList);
  const query = mention.toLowerCase();
  const selected = new Set(selectedUserIds);
  return followers
    .filter((user) => !selected.has(user.id))
    .filter((user) => {
      if (!query) {
        return true;
      }

      return (
        mentionHandle(user).toLowerCase().includes(query) ||
        displayName(user).toLowerCase().includes(query)
      );
    });
}

function getActiveMention(value, allowCommaList) {
  const token = allowCommaList ? value.split(",").at(-1).trimStart() : value.trimStart();
  return token;
}

function hasActiveMention(value, allowCommaList) {
  return Boolean(getActiveMention(value, allowCommaList));
}

function appendMentionTrigger(value, allowCommaList) {
  if (!allowCommaList) {
    return value;
  }

  if (!value.trim()) return value;

  return value.trimEnd().endsWith(",") ? `${value.trimEnd()} ` : `${value}, `;
}

function replaceMentionToken(value, label, allowCommaList) {
  const replacement = label;
  if (!allowCommaList) return replacement;
  const parts = value.split(",");
  parts[parts.length - 1] = ` ${label}`;
  return `${parts.join(",").trimStart()}, `;
}

function displayName(user) {
  if (!user) return "Unknown user";
  return (
    `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
    user.nickname ||
    "Unknown user"
  );
}

function mentionHandle(user) {
  return user?.nickname?.trim()?.replace(/^@+/, "") || "";
}

function Avatar({ user, size = "default" }) {
  const initial = user?.first_name?.trim()?.charAt(0)?.toUpperCase() || "?";
  const className = size === "small" ? styles.avatarSmall : styles.avatar;

  return (
    <div className={className}>
      {user?.avatar ? (
        <span
          className={styles.avatarImage}
          style={{ backgroundImage: `url(${mediaUrl(user.avatar)})` }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateTimeLocal(date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
