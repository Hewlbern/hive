//! Shared Hive desktop / Discord logic (no Discord SDK, no GUI).

mod catalog;
mod friends;
mod pairing;
mod swarm;

pub use catalog::{
    catalog_status, model_fits, next_unlock_hint, pooled_mb, sharing_count, CatalogStatus, ModelDef,
    MODEL_CATALOG,
};
pub use friends::{
    parse_share_scope, FriendError, FriendGraph, FriendShare, FriendStore, FriendView, Friendship,
    FriendshipStatus, PendingView, ShareScope,
};
pub use pairing::{Binding, PairingError, PairingStore, PendingPair};
pub use swarm::{guild_to_swarm_id, is_discord_swarm, normalize_swarm_id, SwarmError};
