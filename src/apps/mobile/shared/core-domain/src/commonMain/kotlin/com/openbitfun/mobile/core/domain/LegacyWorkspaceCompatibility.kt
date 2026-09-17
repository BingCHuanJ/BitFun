package com.openbitfun.mobile.core.domain

/**
 * Upgrade-only conversion for pre-ID mobile caches and host projections.
 * Paths are not workspace keys. New state and commands retain workspaceId.
 * Remove when all supported caches have migrated and peers negotiate ID references.
 * Unknown IDs never fall back to a path; ambiguous old roots stay unresolved.
 */
public object LegacyWorkspaceCompatibility {
    public fun resolve(reference: RemoteWorkspaceIdentity, catalog: List<RemoteWorkspaceIdentity>): RemoteWorkspaceIdentity? {
        reference.workspaceId?.let { id -> return catalog.singleOrNull { it.workspaceId == id } }
        val root = reference.path.trim().trimEnd('/')
        return catalog.filter { candidate ->
            candidate.path.trim().trimEnd('/') == root &&
                (reference.remoteConnectionId.isNullOrBlank() || candidate.remoteConnectionId == reference.remoteConnectionId) &&
                (reference.remoteSshHost.isNullOrBlank() ||
                    (reference.remoteConnectionId.isNullOrBlank() && reference.remoteSshHost == "localhost") ||
                    candidate.remoteSshHost == reference.remoteSshHost)
        }.singleOrNull()
    }
}
