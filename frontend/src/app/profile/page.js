"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  createComment,
  followUser,
  getCurrentUser,
  getFeed,
  getPost,
  getUserProfile,
  isUnauthorized,
  mediaUrl,
  unfollowUser,
  updateProfileVisibility,
} from "@/lib/api";
import { MaxCommentLen } from "@/lib/limits";
import Notification from "@/components/ui/Notification";
import styles from "./Profile.module.css";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileRoute />
    </Suspense>
  );
}

function ProfileRoute() {
  const searchParams = useSearchParams();
  const requestedProfileId = searchParams.get("user_id") || "";

  return (
    <ProfileContent
      key={requestedProfileId || "current-user"}
      requestedProfileId={requestedProfileId}
    />
  );
}

function ProfileContent({ requestedProfileId }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [activeList, setActiveList] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [expandedPosts, setExpandedPosts] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [postingComments, setPostingComments] = useState({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    loadProfileData()
      .catch((err) => {
        if (!isMounted) {
          return;
        }
        if (isUnauthorized(err)) {
          router.replace("/login");
        } else {
          setError(err.message || "Could not load profile");
          setProfile(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    async function loadProfileData() {
      const currentUser = await getCurrentUser();
      const targetId = requestedProfileId || currentUser.id;
      const profileData = await getUserProfile(targetId);
      let profilePosts = [];

      if (profileData.can_view_details) {
        const feed = await getFeed();
        profilePosts = (feed || []).filter(
          (post) => post.user_id === profileData.id || post.author?.id === profileData.id
        );
      }

      if (!isMounted) {
        return;
      }

      setError("");
      setActiveList("");
      setUser(currentUser);
      setProfile(profileData);
      setPosts(profilePosts);
      setExpandedPosts({});
      setCommentDrafts({});
    }

    return () => {
      isMounted = false;
    };
  }, [requestedProfileId, reloadKey, router]);

  const refreshProfile = () => {
    setReloadKey((current) => current + 1);
  };

  const handleVisibilityChange = async () => {
    if (!profile) {
      return;
    }
    const nextVisibility = !profile.is_public;
    setBusyId("visibility");
    setError("");
    try {
      await updateProfileVisibility(nextVisibility);
      setIsLoading(true);
      refreshProfile();
    } catch (err) {
      setError(err.message || "Could not update profile visibility");
    } finally {
      setBusyId("");
    }
  };

  const handleFollow = async () => {
    if (!profile) {
      return;
    }
    setBusyId("follow");
    setError("");
    try {
      await followUser(profile.id);
      setIsLoading(true);
      refreshProfile();
    } catch (err) {
      setError(err.message || "Could not update follow status");
    } finally {
      setBusyId("");
    }
  };

  const handleUnfollow = async () => {
    if (!profile) {
      return;
    }
    setBusyId("follow");
    setError("");
    try {
      await unfollowUser(profile.id);
      setIsLoading(true);
      refreshProfile();
    } catch (err) {
      setError(err.message || "Could not unfollow user");
    } finally {
      setBusyId("");
    }
  };

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

  const handleCreateComment = async (event, postId) => {
    event.preventDefault();
    setError("");
    setPostingComments((current) => ({ ...current, [postId]: true }));

    try {
      const comment = await createComment(postId, {
        content: commentDrafts[postId] || "",
        image: null,
      });
      setExpandedPosts((current) => ({
        ...current,
        [postId]: [...(current[postId] || []), comment],
      }));
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
    } catch (err) {
      setError(err.message || "Could not add comment");
    } finally {
      setPostingComments((current) => ({ ...current, [postId]: false }));
    }
  };

  const followers = profile?.followers || [];
  const following = profile?.following || [];
  const canViewDetails = Boolean(profile?.can_view_details);
  const isOwnProfile = Boolean(user?.id && profile?.id && user.id === profile.id);
  const avatarInitial = profile?.first_name?.trim()?.charAt(0)?.toUpperCase() || "?";
  const visibleList = activeList === "following" ? following : followers;

  if (isLoading && !profile) {
    return <ProfileLoading />;
  }

  if (!profile) {
    return (
      <main className={styles.profilePage}>
        <Notification message={error} type="error" onClose={() => setError("")} />
        <div className={styles.profileGrid}>
          <section className={styles.sectionPanel}>
            <h2>Profile unavailable</h2>
            <p className={styles.emptyState}>This profile could not be loaded.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.profilePage}>
      <Notification message={error} type="error" onClose={() => setError("")} />
      <section className={styles.profilePanel}>
        <div className={styles.avatar}>
          {profile?.avatar ? (
            <span
              className={styles.avatarImage}
              style={{ backgroundImage: `url(${mediaUrl(profile.avatar)})` }}
            />
          ) : (
            <span className={styles.avatarInitial}>{avatarInitial}</span>
          )}
        </div>

        <div className={styles.profileInfo}>
          <h1>{profile ? displayName(profile) : "Profile"}</h1>
          {profile?.nickname && <p className={styles.nickname}>@{mentionHandle(profile)}</p>}
          {profile?.about_me && <p className={styles.about}>{profile.about_me}</p>}
          <div className={styles.metaRow}>
            {canViewDetails ? (
              <>
                <button
                  type="button"
                  className={`${styles.metaButton} ${
                    activeList === "followers" ? styles.activeMetaButton : ""
                  }`}
                  onClick={() =>
                    setActiveList((current) =>
                      current === "followers" ? "" : "followers"
                    )
                  }
                >
                  {followers.length} followers
                </button>
                <button
                  type="button"
                  className={`${styles.metaButton} ${
                    activeList === "following" ? styles.activeMetaButton : ""
                  }`}
                  onClick={() =>
                    setActiveList((current) =>
                      current === "following" ? "" : "following"
                    )
                  }
                >
                  {following.length} following
                </button>
              </>
            ) : (
              <>
                <span>Followers hidden</span>
                <span>Following hidden</span>
              </>
            )}
            <span>{profile?.is_public ? "Public profile" : "Private profile"}</span>
          </div>
        </div>

        {isOwnProfile ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleVisibilityChange}
            disabled={busyId === "visibility"}
          >
            {profile?.is_public ? "Make Private" : "Make Public"}
          </button>
        ) : (
          <ProfileFollowButton
            profile={profile}
            busy={busyId === "follow"}
            onFollow={handleFollow}
            onUnfollow={handleUnfollow}
          />
        )}
      </section>

      <div className={styles.profileGrid}>
        {!canViewDetails ? (
          <section className={styles.sectionPanel}>
            <h2>Private profile</h2>
            <p className={styles.emptyState}>
              Follow this user to see posts, followers, and following.
            </p>
          </section>
        ) : (
          <>
            {activeList && (
              <section className={styles.sectionPanel}>
                <h2>{activeList === "following" ? "Following" : "Followers"}</h2>
                {visibleList.length === 0 ? (
                  <p className={styles.emptyState}>
                    No {activeList === "following" ? "following" : "followers"} yet.
                  </p>
                ) : (
                  <div className={styles.userList}>
                    {visibleList.map((person) => (
                      <UserRow key={person.id} user={person} />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className={styles.sectionPanel}>
              <h2>Posts</h2>
              {posts.length === 0 ? (
                <p className={styles.emptyState}>No visible posts yet.</p>
              ) : (
                <div className={styles.postList}>
                  {posts.map((post) => (
                    <article key={post.id} className={styles.postCard}>
                      <header className={styles.postHeader}>
                        <MiniAvatar user={post.author} />
                        <div>
                          <strong>{displayName(post.author)}</strong>
                          <span>
                            {formatDate(post.created_at)} · {privacyLabel(post.privacy)}
                          </span>
                        </div>
                      </header>
                      {post.title && <h3 className={styles.postTitle}>{post.title}</h3>}
                      {post.content && <p className={styles.postContent}>{post.content}</p>}
                      {post.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.postImage} src={mediaUrl(post.image)} alt="" />
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
                            <button type="submit" disabled={postingComments[post.id]}>
                              {postingComments[post.id] ? "Sending..." : "Send"}
                            </button>
                          </form>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function ProfileLoading() {
  return (
    <main className={styles.profilePage}>
      <section className={styles.sectionPanel}>
        <p className={styles.emptyState}>Loading profile...</p>
      </section>
    </main>
  );
}

function ProfileFollowButton({ profile, busy, onFollow, onUnfollow }) {
  if (!profile) {
    return null;
  }

  if (profile.follow_status === "following") {
    return (
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={onUnfollow}
        disabled={busy}
      >
        Unfollow
      </button>
    );
  }

  if (profile.follow_status === "pending") {
    return (
      <button type="button" className={styles.secondaryButton} disabled>
        Requested
      </button>
    );
  }

  return (
    <button type="button" className={styles.primaryButton} onClick={onFollow} disabled={busy}>
      Follow
    </button>
  );
}

function UserRow({ user }) {
  return (
    <Link href={`/profile?user_id=${user.id}`} className={styles.userRow}>
      <MiniAvatar user={user} />
      <div className={styles.userText}>
        <strong>{displayName(user)}</strong>
        <span>@{mentionHandle(user)}</span>
      </div>
    </Link>
  );
}

function Comment({ comment }) {
  return (
    <div className={styles.comment}>
      <MiniAvatar user={comment.author} />
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

function MiniAvatar({ user }) {
  const initial = user?.first_name?.trim()?.charAt(0)?.toUpperCase() || "?";
  return (
    <span className={styles.miniAvatar}>
      {user?.avatar ? (
        <span
          className={styles.avatarImage}
          style={{ backgroundImage: `url(${mediaUrl(user.avatar)})` }}
        />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}

function displayName(user) {
  return `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || "User";
}

function mentionHandle(user) {
  return user?.nickname || displayName(user).toLowerCase().replace(/\s+/g, ".") || "user";
}

function privacyLabel(privacy) {
  if (privacy === "followers") {
    return "Followers";
  }
  if (privacy === "private_selected") {
    return "Selected";
  }
  return "Public";
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
