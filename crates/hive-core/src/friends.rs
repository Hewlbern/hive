//! Local friend / trusted-peer store for the desktop config dir.
//!
//! Same model as `src/server/friends-store.ts`: request → accept → bidirectional
//! friends; shares are explicit addressed payloads (default deny). Identity is
//! the existing Hive device id.

use chrono::Utc;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

const MAX_SHARE_BODY: usize = 8000;
const MAX_SHARE_LABEL: usize = 64;
const MAX_POD_ID: usize = 128;
const MAX_TTL_SECS: i64 = 30 * 24 * 60 * 60;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FriendError {
    #[error("pod id required (Hive device id)")]
    InvalidPod,
    #[error("cannot friend your own pod")]
    SelfFriend,
    #[error("no pending friend request from that pod")]
    NotFound,
    #[error("only the recipient can accept a friend request")]
    NotRecipient,
    #[error("not friends: default deny. Send a friend request and wait for accept before sharing.")]
    NotFriends,
    #[error("share body required — Hive never dumps ambient context")]
    EmptyShare,
    #[error("share body exceeds {0} characters")]
    ShareTooLarge(usize),
    #[error("scope must be one of: note, fact, context")]
    InvalidScope,
    #[error("ttlSeconds must be between 1 and {0}")]
    InvalidTtl(i64),
    #[error("io error: {0}")]
    Io(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FriendshipStatus {
    Pending,
    Accepted,
    Revoked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShareScope {
    Note,
    Fact,
    Context,
}

impl ShareScope {
    fn parse(raw: &str) -> Result<Self, FriendError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "note" => Ok(Self::Note),
            "fact" => Ok(Self::Fact),
            "context" => Ok(Self::Context),
            _ => Err(FriendError::InvalidScope),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Friendship {
    pub id: String,
    pub requester_id: String,
    pub peer_id: String,
    pub status: FriendshipStatus,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requester_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendShare {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub body: String,
    pub scope: ShareScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendView {
    pub peer_id: String,
    pub status: FriendshipStatus,
    pub since: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requester_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingView {
    pub peer_id: String,
    pub direction: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requester_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FriendGraph {
    pub pod_id: String,
    pub friends: Vec<FriendView>,
    pub incoming: Vec<PendingView>,
    pub outgoing: Vec<PendingView>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    friendships: HashMap<String, Friendship>,
    shares: HashMap<String, FriendShare>,
}

#[derive(Debug)]
pub struct FriendStore {
    path: PathBuf,
    state: State,
}

impl FriendStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, FriendError> {
        let path = path.as_ref().to_path_buf();
        let state = if path.exists() {
            let raw = fs::read_to_string(&path).map_err(|e| FriendError::Io(e.to_string()))?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            State::default()
        };
        Ok(Self { path, state })
    }

    pub fn in_memory() -> Self {
        Self {
            path: PathBuf::from(":memory:"),
            state: State::default(),
        }
    }

    fn persist(&self) -> Result<(), FriendError> {
        if self.path == Path::new(":memory:") {
            return Ok(());
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| FriendError::Io(e.to_string()))?;
        }
        let raw =
            serde_json::to_string_pretty(&self.state).map_err(|e| FriendError::Io(e.to_string()))?;
        fs::write(&self.path, raw).map_err(|e| FriendError::Io(e.to_string()))
    }

    pub fn request(
        &mut self,
        requester_id: &str,
        peer_id: &str,
        requester_name: Option<&str>,
    ) -> Result<Friendship, FriendError> {
        let requester_id = normalize_pod(requester_id)?;
        let peer_id = normalize_pod(peer_id)?;
        if requester_id == peer_id {
            return Err(FriendError::SelfFriend);
        }
        let key = pair_key(&requester_id, &peer_id);
        let name = requester_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(64).collect::<String>());

        if let Some(existing) = self.state.friendships.get(&key) {
            if existing.status == FriendshipStatus::Accepted {
                return Ok(existing.clone());
            }
            if existing.status == FriendshipStatus::Pending {
                if existing.peer_id == requester_id && existing.requester_id == peer_id {
                    let mut row = existing.clone();
                    row.status = FriendshipStatus::Accepted;
                    row.accepted_at = Some(now_ms());
                    self.state.friendships.insert(key, row.clone());
                    self.persist()?;
                    return Ok(row);
                }
                return Ok(existing.clone());
            }
        }

        let id = self
            .state
            .friendships
            .get(&key)
            .map(|r| r.id.clone())
            .unwrap_or_else(new_id);
        let row = Friendship {
            id,
            requester_id,
            peer_id,
            status: FriendshipStatus::Pending,
            created_at: now_ms(),
            accepted_at: None,
            revoked_at: None,
            requester_name: name,
        };
        self.state.friendships.insert(key, row.clone());
        self.persist()?;
        Ok(row)
    }

    pub fn accept(&mut self, pod_id: &str, peer_id: &str) -> Result<Friendship, FriendError> {
        let pod_id = normalize_pod(pod_id)?;
        let peer_id = normalize_pod(peer_id)?;
        let key = pair_key(&pod_id, &peer_id);
        let Some(existing) = self.state.friendships.get(&key).cloned() else {
            return Err(FriendError::NotFound);
        };
        if existing.status == FriendshipStatus::Revoked {
            return Err(FriendError::NotFound);
        }
        if existing.status == FriendshipStatus::Accepted {
            return Ok(existing);
        }
        if existing.peer_id != pod_id {
            return Err(FriendError::NotRecipient);
        }
        let mut row = existing;
        row.status = FriendshipStatus::Accepted;
        row.accepted_at = Some(now_ms());
        self.state.friendships.insert(key, row.clone());
        self.persist()?;
        Ok(row)
    }

    pub fn revoke(&mut self, pod_id: &str, peer_id: &str) -> Result<Friendship, FriendError> {
        let pod_id = normalize_pod(pod_id)?;
        let peer_id = normalize_pod(peer_id)?;
        let key = pair_key(&pod_id, &peer_id);
        let Some(existing) = self.state.friendships.get(&key).cloned() else {
            return Err(FriendError::NotFound);
        };
        if existing.status == FriendshipStatus::Revoked {
            return Err(FriendError::NotFound);
        }
        let mut row = existing;
        row.status = FriendshipStatus::Revoked;
        row.revoked_at = Some(now_ms());
        self.state.friendships.insert(key, row.clone());
        self.state.shares.retain(|_, s| pair_key(&s.from_id, &s.to_id) != key);
        self.persist()?;
        Ok(row)
    }

    pub fn list(&self, pod_id: &str) -> Result<FriendGraph, FriendError> {
        let pod_id = normalize_pod(pod_id)?;
        let mut friends = Vec::new();
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();
        for row in self.state.friendships.values() {
            if row.requester_id != pod_id && row.peer_id != pod_id {
                continue;
            }
            if row.status == FriendshipStatus::Revoked {
                continue;
            }
            let peer = if row.requester_id == pod_id {
                row.peer_id.clone()
            } else {
                row.requester_id.clone()
            };
            match row.status {
                FriendshipStatus::Accepted => friends.push(FriendView {
                    peer_id: peer,
                    status: FriendshipStatus::Accepted,
                    since: row.accepted_at.unwrap_or(row.created_at),
                    requester_name: row.requester_name.clone(),
                }),
                FriendshipStatus::Pending if row.peer_id == pod_id => incoming.push(PendingView {
                    peer_id: peer,
                    direction: "incoming".into(),
                    created_at: row.created_at,
                    requester_name: row.requester_name.clone(),
                }),
                FriendshipStatus::Pending => outgoing.push(PendingView {
                    peer_id: peer,
                    direction: "outgoing".into(),
                    created_at: row.created_at,
                    requester_name: row.requester_name.clone(),
                }),
                FriendshipStatus::Revoked => {}
            }
        }
        friends.sort_by(|a, b| a.peer_id.cmp(&b.peer_id));
        incoming.sort_by(|a, b| a.peer_id.cmp(&b.peer_id));
        outgoing.sort_by(|a, b| a.peer_id.cmp(&b.peer_id));
        Ok(FriendGraph {
            pod_id,
            friends,
            incoming,
            outgoing,
        })
    }

    pub fn share(
        &mut self,
        from_id: &str,
        to_id: &str,
        body: &str,
        scope: ShareScope,
        label: Option<&str>,
        ttl_seconds: Option<i64>,
    ) -> Result<FriendShare, FriendError> {
        let from_id = normalize_pod(from_id)?;
        let to_id = normalize_pod(to_id)?;
        if from_id == to_id {
            return Err(FriendError::SelfFriend);
        }
        if !self.is_accepted(&from_id, &to_id) {
            return Err(FriendError::NotFriends);
        }
        let body = body.trim();
        if body.is_empty() {
            return Err(FriendError::EmptyShare);
        }
        if body.len() > MAX_SHARE_BODY {
            return Err(FriendError::ShareTooLarge(MAX_SHARE_BODY));
        }
        let label = label
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(MAX_SHARE_LABEL).collect::<String>());
        let expires_at = match ttl_seconds {
            None => None,
            Some(ttl) if ttl > 0 && ttl <= MAX_TTL_SECS => Some(now_ms() + ttl * 1000),
            _ => return Err(FriendError::InvalidTtl(MAX_TTL_SECS)),
        };
        let share = FriendShare {
            id: new_id(),
            from_id,
            to_id,
            body: body.to_string(),
            scope,
            label,
            created_at: now_ms(),
            expires_at,
        };
        self.state.shares.insert(share.id.clone(), share.clone());
        self.persist()?;
        Ok(share)
    }

    pub fn pull(
        &self,
        pod_id: &str,
        from_id: Option<&str>,
        scope: Option<ShareScope>,
        label: Option<&str>,
    ) -> Result<Vec<FriendShare>, FriendError> {
        let pod_id = normalize_pod(pod_id)?;
        let from_id = match from_id {
            Some(id) => Some(normalize_pod(id)?),
            None => None,
        };
        let now = now_ms();
        let mut out: Vec<FriendShare> = self
            .state
            .shares
            .values()
            .filter(|s| s.to_id == pod_id)
            .filter(|s| from_id.as_ref().map(|f| s.from_id == *f).unwrap_or(true))
            .filter(|s| scope.map(|sc| s.scope == sc).unwrap_or(true))
            .filter(|s| label.map(|l| s.label.as_deref() == Some(l)).unwrap_or(true))
            .filter(|s| s.expires_at.map(|exp| exp > now).unwrap_or(true))
            .filter(|s| self.is_accepted(&pod_id, &s.from_id))
            .cloned()
            .collect();
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }

    fn is_accepted(&self, a: &str, b: &str) -> bool {
        self.state
            .friendships
            .get(&pair_key(a, b))
            .map(|r| r.status == FriendshipStatus::Accepted)
            .unwrap_or(false)
    }
}

/// Parse a scope string (MCP / REST).
pub fn parse_share_scope(raw: &str) -> Result<ShareScope, FriendError> {
    ShareScope::parse(raw)
}

fn normalize_pod(raw: &str) -> Result<String, FriendError> {
    let id = raw.trim().to_ascii_lowercase();
    if id.is_empty() || id.len() > MAX_POD_ID {
        Err(FriendError::InvalidPod)
    } else {
        Ok(id)
    }
}

fn pair_key(a: &str, b: &str) -> String {
    if a < b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn new_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .map(char::from)
        .take(16)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_accept_list_revoke() {
        let mut store = FriendStore::in_memory();
        let pending = store.request("pod-a", "pod-b", Some("Alice")).unwrap();
        assert_eq!(pending.status, FriendshipStatus::Pending);
        assert!(store.list("pod-b").unwrap().incoming.iter().any(|p| p.peer_id == "pod-a"));
        store.accept("pod-b", "pod-a").unwrap();
        assert_eq!(store.list("pod-a").unwrap().friends.len(), 1);
        assert_eq!(store.list("pod-b").unwrap().friends[0].peer_id, "pod-a");
        store.revoke("pod-a", "pod-b").unwrap();
        assert!(store.list("pod-a").unwrap().friends.is_empty());
    }

    #[test]
    fn mutual_request_accepts() {
        let mut store = FriendStore::in_memory();
        store.request("aaa", "bbb", None).unwrap();
        let back = store.request("bbb", "aaa", None).unwrap();
        assert_eq!(back.status, FriendshipStatus::Accepted);
    }

    #[test]
    fn default_deny_until_accepted() {
        let mut store = FriendStore::in_memory();
        store.request("alpha", "charlie", None).unwrap();
        assert_eq!(
            store.share("alpha", "charlie", "secret", ShareScope::Note, None, None),
            Err(FriendError::NotFriends)
        );
        assert!(store.pull("charlie", None, None, None).unwrap().is_empty());
    }

    #[test]
    fn share_is_addressed_and_opt_in() {
        let mut store = FriendStore::in_memory();
        store.request("alpha", "bravo", None).unwrap();
        store.accept("bravo", "alpha").unwrap();
        store
            .share(
                "alpha",
                "bravo",
                "layer split is 0-8",
                ShareScope::Fact,
                Some("assignment"),
                None,
            )
            .unwrap();
        let inbound = store.pull("bravo", None, None, None).unwrap();
        assert_eq!(inbound.len(), 1);
        assert_eq!(inbound[0].body, "layer split is 0-8");
        assert!(store.pull("alpha", None, None, None).unwrap().is_empty());
        assert!(store.pull("charlie", None, None, None).unwrap().is_empty());
        assert!(store.share("alpha", "bravo", "  ", ShareScope::Note, None, None).is_err());
    }

    #[test]
    fn revoke_drops_shares() {
        let mut store = FriendStore::in_memory();
        store.request("alpha", "bravo", None).unwrap();
        store.accept("bravo", "alpha").unwrap();
        store
            .share("alpha", "bravo", "old fact", ShareScope::Note, None, None)
            .unwrap();
        store.revoke("bravo", "alpha").unwrap();
        assert!(store.pull("bravo", None, None, None).unwrap().is_empty());
        store.request("alpha", "bravo", None).unwrap();
        store.accept("bravo", "alpha").unwrap();
        assert!(store.pull("bravo", None, None, None).unwrap().is_empty());
    }
}
