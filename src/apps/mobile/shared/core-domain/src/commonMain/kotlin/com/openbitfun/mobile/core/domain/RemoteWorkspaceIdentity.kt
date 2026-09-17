package com.openbitfun.mobile.core.domain

/** A path belongs to the serving runtime's saved connection, not the phone. */
public data class RemoteWorkspaceIdentity public constructor(
    public val path: String,
    public val remoteConnectionId: String?,
    public val remoteSshHost: String?,
    public val workspaceId: String? = null,
) {
    public val key: String get() = workspaceId?.let { "workspace:${it.length}:$it" } ?: legacyKey

    /** Upgrade-only key for caches and peers predating workspace IDs. */
    private val legacyKey: String get() = listOf(remoteConnectionId.orEmpty(), remoteSshHost.orEmpty(), normalizedPath(path))
        .joinToString("") { "${it.length}:$it" }

    public fun matches(other: RemoteWorkspaceIdentity): Boolean = key == other.key

    public companion object {
        private fun normalizedPath(path: String): String = path.trim().let { it.trimEnd('/').ifEmpty { it } }
    }
}

public fun RecentWorkspace.identity(): RemoteWorkspaceIdentity = RemoteWorkspaceIdentity(path, remoteConnectionId, remoteSshHost, workspaceId)

/** Old cache rows have no provenance: only an unambiguous local root can own them. */
public fun RemoteSession.belongsTo(workspace: RemoteWorkspaceIdentity, catalog: List<RemoteWorkspaceIdentity>): Boolean {
    workspaceIdentity?.let { return LegacyWorkspaceCompatibility.resolve(it, catalog)?.matches(workspace) == true }
    if (!workspace.remoteConnectionId.isNullOrEmpty() || !workspace.remoteSshHost.isNullOrEmpty()) return false
    val local = LegacyWorkspaceCompatibility.resolve(RemoteWorkspaceIdentity(workspacePath.orEmpty(), null, null), catalog)
    return local?.matches(workspace) == true
}
