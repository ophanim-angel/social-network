"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createComment,
  createPost,
  followUser,
  getCurrentUser,
  getFeed,
  getFollowRequests,
  getFollowers,
  getPost,
  getUsers,
  isUnauthorized,
  mediaUrl,
  respondToFollowRequest,
  unfollowUser,
} from "@/lib/api";
import {
  MaxCommentLen,
  MaxGroupInviteesLen,
  MaxImageSizeBytes,
  MaxImageSizeMB,
  MaxPostContentLen,
  MaxPostTitleLen,
} from "@/lib/limits";
import Notification from "@/components/ui/Notification";
import styles from "./Feed.module.css";

const privacyOptions = [
  { value: "public", label: "Public" },
  { value: "followers", label: "Followers" },
  { value: "private_selected", label: "Selected" },
];

const peoplePageSize = 6;
const commentSubmitDebounceMs = 350;

export default function Feed() {
  // Router helper for client navigation.
  const router = useRouter();
  const commentSubmitTimers = useRef({});
  const activeCommentSubmissions = useRef(new Set());
  // Local state for feed data and UI state.
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [followers, setFollowers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peoplePage, setPeoplePage] = useState(1);
  const [busyFollowId, setBusyFollowId] = useState("");
  const [busyRequestId, setBusyRequestId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [mentionInput, setMentionInput] = useState("@");
  const [selectedFollowerIds, setSelectedFollowerIds] = useState([]);
  const [image, setImage] = useState(null);
  const [expandedPosts, setExpandedPosts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentImages, setCommentImages] = useState({});
  const [postingComments, setPostingComments] = useState({});
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);

  // Load initial feed and related data when the component mounts.
  useEffect(() => {
    let isMounted = true;

    Promise.all([getCurrentUser(), getFeed(), getFollowers(), getUsers(), getFollowRequests()])
      .then(([currentUser, feed, followerList, userList, requestList]) => {
        if (isMounted) {
          setUser(currentUser);
          setPosts(feed);
          setFollowers(followerList || []);
          setUsers(userList || []);
          setRequests(requestList || []);
        }
      })
      .catch((err) => {
        if (isMounted) {
          if (isUnauthorized(err)) {
            router.replace("/login");
          } else {
            setError(err.message || "Could not load feed");
          }
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    const timers = commentSubmitTimers.current;

    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  // Compute the allowed follower IDs for private posts.
  const allowedUserIds = useMemo(() => {
    return privacy === "private_selected" ? selectedFollowerIds : [];
  }, [privacy, selectedFollowerIds]);

  // Filter the people list by the current search query.
  const filteredPeople = useMemo(() => {
    const query = peopleQuery.trim().toLowerCase();
    return users
      .filter((item) => item.id !== user?.id)
      .filter((item) => {
        if (!query) {
          return true;
        }
        return (
          displayName(item).toLowerCase().includes(query) ||
          mentionHandle(item).toLowerCase().includes(query)
        );
      });
  }, [peopleQuery, user?.id, users]);

  const peoplePageCount = Math.max(1, Math.ceil(filteredPeople.length / peoplePageSize));
  const currentPeoplePage = Math.min(peoplePage, peoplePageCount);
  const paginatedPeople = useMemo(() => {
    const start = (currentPeoplePage - 1) * peoplePageSize;
    return filteredPeople.slice(start, start + peoplePageSize);
  }, [currentPeoplePage, filteredPeople]);

  const selectedFollowers = useMemo(() => {
    const selected = new Set(selectedFollowerIds);
    return followers.filter((follower) => selected.has(follower.id));
  }, [followers, selectedFollowerIds]);

  const mentionQuery = mentionInput.replace(/^@/, "").trim().toLowerCase();
  const suggestedFollowers = useMemo(() => {
    const selected = new Set(selectedFollowerIds);
    return followers
      .filter((follower) => !selected.has(follower.id))
      .filter((follower) => {
        if (!mentionQuery) {
          return true;
        }
        return (
          displayName(follower).toLowerCase().includes(mentionQuery) ||
          mentionHandle(follower).toLowerCase().includes(mentionQuery)
        );
      });
  }, [followers, mentionQuery, selectedFollowerIds]);

  // Submit a new post to the backend API.
  const handleCreatePost = async (event) => {
    event.preventDefault();
    const form = getSubmitForm(event);
    setError("");
    setIsPosting(true);

    try {
      const post = await createPost({
        title,
        content,
        privacy,
        allowedUserIds,
        image,
      });

      setPosts((currentPosts) => [post, ...currentPosts]);
      setTitle("");
      setContent("");
      setPrivacy("public");
      setMentionInput("@");
      setSelectedFollowerIds([]);
      setImage(null);
      form?.reset();
    } catch (err) {
      setError(err.message || "Could not create post");
    } finally {
      setIsPosting(false);
    }
  };

  const handleMentionInputChange = (event) => {
    const value = event.target.value;
    setMentionInput(value.startsWith("@") ? value : `@${value}`);
  };

  const handleSelectFollower = (followerId) => {
    setSelectedFollowerIds((current) =>
      current.includes(followerId) ? current : [...current, followerId]
    );
    setMentionInput("@");
  };

  const handleRemoveFollower = (followerId) => {
    setSelectedFollowerIds((current) => current.filter((id) => id !== followerId));
  };

  // Toggle comment thread visibility for a post.
  const handleToggleComments = async (postId) => {
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
      const detail = await getPost(postId);
      setExpandedPosts((current) => ({
        ...current,
        [postId]: detail.comments || [],
      }));
    } catch (err) {
      setError(err.message || "Could not load comments");
    }
  };

  const handleCommentImageChange = (event, postId) => {
    const file = event.target.files?.[0] || null;
    setError("");

    if (file && file.size > MaxImageSizeBytes) {
      event.target.value = "";
      setCommentImages((current) => ({ ...current, [postId]: null }));
      setError(`Images must be ${MaxImageSizeMB} MB or smaller`);
      return;
    }

    setCommentImages((current) => ({
      ...current,
      [postId]: file,
    }));
  };

  const submitComment = async (postId, { content, image, form }) => {
    if (activeCommentSubmissions.current.has(postId)) {
      return;
    }

    activeCommentSubmissions.current.add(postId);

    try {
      const comment = await createComment(postId, {
        content,
        image,
      });

      setExpandedPosts((current) => ({
        ...current,
        [postId]: [...(current[postId] || []), comment],
      }));
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      setCommentImages((current) => ({ ...current, [postId]: null }));
      form?.reset();
    } catch (err) {
      setError(err.message || "Could not add comment");
    } finally {
      activeCommentSubmissions.current.delete(postId);
      setPostingComments((current) => ({ ...current, [postId]: false }));
    }
  };

  const handleCreateComment = (event, postId) => {
    event.preventDefault();
    const form = getSubmitForm(event);
    setError("");

    if (activeCommentSubmissions.current.has(postId)) {
      return;
    }

    if (commentSubmitTimers.current[postId]) {
      window.clearTimeout(commentSubmitTimers.current[postId]);
    }

    const content = commentDrafts[postId] || "";
    const image = commentImages[postId] || null;
    setPostingComments((current) => ({ ...current, [postId]: true }));

    commentSubmitTimers.current[postId] = window.setTimeout(() => {
      delete commentSubmitTimers.current[postId];
      submitComment(postId, { content, image, form });
    }, commentSubmitDebounceMs);
  };

  const handlePeopleSearch = (event) => {
    setPeopleQuery(event.target.value);
    setPeoplePage(1);
  };

  const refreshPeopleData = async () => {
    const [userList, feed] = await Promise.all([getUsers(), getFeed()]);
    setUsers(userList || []);
    setPosts(feed || []);
  };

  const refreshRequestData = async () => {
    const [requestList, followerList] = await Promise.all([
      getFollowRequests(),
      getFollowers(),
    ]);
    setRequests(requestList || []);
    setFollowers(followerList || []);
  };

  const handleFollow = async (targetId) => {
    setBusyFollowId(targetId);
    setError("");
    try {
      await followUser(targetId);
      await refreshPeopleData();
    } catch (err) {
      setError(err.message || "Could not update follow status");
    } finally {
      setBusyFollowId("");
    }
  };

  const handleUnfollow = async (targetId) => {
    setBusyFollowId(targetId);
    setError("");
    try {
      await unfollowUser(targetId);
      await refreshPeopleData();
    } catch (err) {
      setError(err.message || "Could not unfollow user");
    } finally {
      setBusyFollowId("");
    }
  };

  const handleRequestResponse = async (requestId, status) => {
    setBusyRequestId(requestId);
    setError("");
    try {
      await respondToFollowRequest(requestId, status);
      await refreshRequestData();
    } catch (err) {
      setError(err.message || "Could not update request");
    } finally {
      setBusyRequestId("");
    }
  };

  return (
    <div className={styles.feedContainer}>
      <Notification message={error} type="error" onClose={() => setError("")} />
      <div className={styles.feedLayout}>
        <main className={styles.mainContent}>
          <section className={styles.welcomeSection}>
            <div>
              <h2>Welcome{user?.first_name ? `, ${user.first_name}` : ""}</h2>
              <p>Share an update or catch up with posts you can see.</p>
            </div>
          </section>

          <form className={styles.composer} onSubmit={handleCreatePost}>
            <div className={styles.composerHeader}>
              <Avatar user={user} />
              <div className={styles.composerFields}>
                <label className={styles.srOnly} htmlFor="post-title">
                  Post title
                </label>
                <input
                id="post-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Post title"
                maxLength={MaxPostTitleLen}
              />
              <label className={styles.srOnly} htmlFor="post-content">
                Post content
              </label>
              <textarea
                id="post-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="What would you like to share?"
                rows={3}
                maxLength={MaxPostContentLen}
              />
            </div>
          </div>

          {privacy === "private_selected" && (
            <div className={styles.mentionPicker}>
              <label htmlFor="selected-followers">Tag followers</label>
              <div className={styles.mentionInputWrap}>
                {selectedFollowers.map((follower) => (
                  <button
                    key={follower.id}
                    type="button"
                    className={styles.mentionChip}
                    onClick={() => handleRemoveFollower(follower.id)}
                    aria-label={`Remove ${displayName(follower)}`}
                  >
                    @{mentionHandle(follower)}
                  </button>
                ))}
                <input
                  id="selected-followers"
                  type="text"
                  value={mentionInput}
                  onChange={handleMentionInputChange}
                  placeholder="@username"
                  autoComplete="off"
                  maxLength={MaxGroupInviteesLen}
                />
              </div>

              <div className={styles.followerList}>
                {suggestedFollowers.length === 0 ? (
                  <p>
                    {followers.length === 0
                      ? "No followers yet."
                      : "No matching followers."}
                  </p>
                ) : (
                  suggestedFollowers.map((follower) => (
                    <button
                      key={follower.id}
                      type="button"
                      onClick={() => handleSelectFollower(follower.id)}
                    >
                      <Avatar user={follower} size="small" />
                      <span>
                        <strong>{displayName(follower)}</strong>
                        <small>@{mentionHandle(follower)}</small>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className={styles.composerActions}>
            <div className={styles.segmentedControl} aria-label="Post privacy">
              {privacyOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={privacy === option.value ? styles.activeSegment : ""}
                  onClick={() => setPrivacy(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className={styles.fileButton}>
              Image
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(event) => setImage(event.target.files?.[0] || null)}
              />
            </label>

            <button type="submit" className={styles.primaryButton} disabled={isPosting}>
              {isPosting ? "Posting..." : "Post"}
            </button>
          </div>

          {image && <p className={styles.fileName}>{image.name}</p>}
        </form>

        <section className={styles.postsSection}>
          {isLoading ? (
            <>
              <PostPlaceholder />
              <PostPlaceholder />
            </>
          ) : posts.length === 0 ? (
            <div className={styles.emptyState}>No posts are visible yet.</div>
          ) : (
            posts.map((post) => (
              <article key={post.id} className={styles.postCard}>
                <header className={styles.postHeader}>
                  <Avatar user={post.author} />
                  <div>
                    <h3>
                      <Link href={`/profile?user_id=${post.author.id}`}>
                        {displayName(post.author)}
                      </Link>
                    </h3>
                    <p>
                      {formatDate(post.created_at)} · {privacyLabel(post.privacy)}
                    </p>
                  </div>
                </header>

                {post.title && <h2 className={styles.postTitle}>{post.title}</h2>}
                {post.content && <p className={styles.postContent}>{post.content}</p>}
                {post.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.postImage}
                    src={mediaUrl(post.image)}
                    alt=""
                  />
                )}

                <div className={styles.postActions}>
                  <button type="button" onClick={() => handleToggleComments(post.id)}>
                    {expandedPosts[post.id] ? "Hide comments" : "View comments"}
                  </button>
                </div>

                {expandedPosts[post.id] && (
                  <div className={styles.comments}>
                    {expandedPosts[post.id].length === 0 ? (
                      <p className={styles.emptyComments}>No comments yet.</p>
                    ) : (
                      expandedPosts[post.id].map((comment) => (
                        <Comment key={comment.id} comment={comment} />
                      ))
                    )}

                    <form
                      className={styles.commentForm}
                      onSubmit={(event) => handleCreateComment(event, post.id)}
                    >
                      <input
                        type="text"
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
                      <label className={styles.commentFileButton}>
                        Image
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/gif,image/webp"
                          onChange={(event) => handleCommentImageChange(event, post.id)}
                        />
                      </label>
                      <button type="submit" disabled={postingComments[post.id]}>
                        {postingComments[post.id] ? "Sending..." : "Send"}
                      </button>
                      {commentImages[post.id] && (
                        <p className={styles.commentFileName}>
                          {commentImages[post.id].name}
                        </p>
                      )}
                    </form>
                  </div>
                )}
              </article>
            ))
          )}
          </section>
        </main>
        <aside className={styles.peoplePanel} aria-label="People">
          <section className={styles.requestsSection} aria-label="Follow requests">
            <div className={styles.peopleHeader}>
              <h2>Follow Requests</h2>
              <span>{requests.length}</span>
            </div>

            {isLoading ? (
              <p className={styles.peopleEmpty}>Loading requests...</p>
            ) : requests.length === 0 ? (
              <p className={styles.peopleEmpty}>No pending requests.</p>
            ) : (
              <div className={styles.requestList}>
                {requests.map((request) => (
                  <div key={request.id} className={styles.requestRow}>
                    <Link
                      href={`/profile?user_id=${request.requester.id}`}
                      className={styles.requestProfileLink}
                    >
                      <Avatar user={request.requester} size="small" />
                      <span>
                        <strong>{displayName(request.requester)}</strong>
                        <small>@{mentionHandle(request.requester)}</small>
                      </span>
                    </Link>
                    <div className={styles.requestActions}>
                      <button
                        type="button"
                        className={styles.peoplePrimaryButton}
                        onClick={() => handleRequestResponse(request.id, "accepted")}
                        disabled={busyRequestId === request.id}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className={styles.peopleSecondaryButton}
                        onClick={() => handleRequestResponse(request.id, "declined")}
                        disabled={busyRequestId === request.id}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className={styles.peopleHeader}>
            <h2>People</h2>
            <span>{filteredPeople.length}</span>
          </div>

          <label className={styles.srOnly} htmlFor="people-search">
            Search people
          </label>
          <input
            id="people-search"
            className={styles.peopleSearch}
            type="search"
            value={peopleQuery}
            onChange={handlePeopleSearch}
            placeholder="Search people"
            maxLength={120}
          />

          {isLoading ? (
            <p className={styles.peopleEmpty}>Loading people...</p>
          ) : paginatedPeople.length === 0 ? (
            <p className={styles.peopleEmpty}>No matching users.</p>
          ) : (
            <div className={styles.peopleList}>
              {paginatedPeople.map((person) => (
                <PeopleRow
                  key={person.id}
                  user={person}
                  busy={busyFollowId === person.id}
                  onFollow={handleFollow}
                  onUnfollow={handleUnfollow}
                />
              ))}
            </div>
          )}

          {filteredPeople.length > peoplePageSize && (
            <div className={styles.peoplePagination}>
              <button
                type="button"
                onClick={() => setPeoplePage((page) => Math.max(1, page - 1))}
                disabled={currentPeoplePage === 1}
              >
                Prev
              </button>
              <span>
                {currentPeoplePage} / {peoplePageCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPeoplePage((page) => Math.min(peoplePageCount, page + 1))
                }
                disabled={currentPeoplePage === peoplePageCount}
              >
                Next
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PeopleRow({ user, busy, onFollow, onUnfollow }) {
  return (
    <div className={styles.peopleRow}>
      <Link href={`/profile?user_id=${user.id}`} className={styles.peopleProfileLink}>
        <Avatar user={user} size="small" />
        <div className={styles.peopleText}>
          <strong>{displayName(user)}</strong>
          <span>@{mentionHandle(user)}</span>
        </div>
      </Link>
      <FollowButton
        user={user}
        busy={busy}
        onFollow={onFollow}
        onUnfollow={onUnfollow}
      />
    </div>
  );
}

function FollowButton({ user, busy, onFollow, onUnfollow }) {
  if (user.follow_status === "following") {
    return (
      <button
        type="button"
        className={styles.peopleSecondaryButton}
        onClick={() => onUnfollow(user.id)}
        disabled={busy}
      >
        Unfollow
      </button>
    );
  }

  if (user.follow_status === "pending") {
    return (
      <button type="button" className={styles.peopleSecondaryButton} disabled>
        Requested
      </button>
    );
  }

  return (
    <button
      type="button"
      className={styles.peoplePrimaryButton}
      onClick={() => onFollow(user.id)}
      disabled={busy}
    >
      Follow
    </button>
  );
}

function Comment({ comment }) {
  return (
    <div className={styles.comment}>
      <Avatar user={comment.author} size="small" />
      <div className={styles.commentBody}>
        <strong>{displayName(comment.author)}</strong>
        {comment.content && <p>{comment.content}</p>}
        {comment.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(comment.image)} alt="" />
        )}
      </div>
    </div>
  );
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

function PostPlaceholder() {
  return (
    <div className={styles.postPlaceholder}>
      <div className={styles.avatarPlaceholder}></div>
      <div className={styles.contentPlaceholder}>
        <div className={styles.linePlaceholder}></div>
        <div className={styles.linePlaceholder}></div>
        <div className={styles.linePlaceholderShort}></div>
      </div>
    </div>
  );
}

function getSubmitForm(event) {
  const form = event.currentTarget || event.target;
  return form instanceof HTMLFormElement ? form : null;
}

function displayName(user) {
  if (!user) {
    return "Unknown user";
  }

  return (
    `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
    user.nickname ||
    "Unknown user"
  );
}

function mentionHandle(user) {
  const nickname = user?.nickname?.trim();
  if (nickname) {
    return nickname.replace(/^@+/, "");
  }

  const fallback = displayName(user)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  return fallback || "user";
}

function privacyLabel(privacy) {
  const option = privacyOptions.find((item) => item.value === privacy);
  return option?.label || "Public";
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
