//! Upgrade-only adapter for session commands from pre-ID clients.
//! Normal callers use SessionStorePort::resolve_workspace_storage(workspace_id).
//! Remove with the pre-ID protocol; never use execution paths as storage fallbacks.
use crate::api::app_state::AppState;
use openbitfun_runtime_ports::SessionStorePort;

pub async fn desktop_effective_session_storage_path(
    app_state: &AppState,
    workspace_path: &str,
    remote_connection_id: Option<&str>,
    remote_ssh_host: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let workspace = app_state
        .workspace_service
        .resolve_legacy_workspace_reference(
            None,
            workspace_path,
            remote_connection_id,
            remote_ssh_host,
        )
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workspace ID is unavailable".to_string())?;
    openbitfun_core::agentic::session::CoreSessionStorePort::default()
        .resolve_workspace_storage(&workspace.id)
        .await
        .map(|resolution| resolution.effective_storage_path)
        .map_err(|error| error.to_string())
}
