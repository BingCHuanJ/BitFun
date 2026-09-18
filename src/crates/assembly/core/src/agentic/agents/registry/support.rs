use crate::service::config::agent_profile_project_store::{
    get_project_subagent_overrides, load_project_agent_profiles_document_local,
    save_project_agent_profiles_document_local, set_project_subagent_overrides,
};
use crate::service::config::global::GlobalConfigManager;
use crate::service::config::types::{AgentProfileConfig, AgentSubagentOverrideConfig};
use crate::util::errors::OpenBitFunResult;
use std::collections::HashMap;
use std::path::Path;

/// Tool-name prefixes of the tool families that are registered dynamically at
/// runtime and therefore cannot appear in an Agent's static tool manifest.
///
/// These mirror `openbitfun_agent_tools::{ACP_TOOL_PREFIX, MCP_TOOL_PREFIX}`, but
/// are declared locally on purpose: both of those constants sit behind that
/// crate's `acp-bridge` / `mcp-bridge` cargo features, while this module also
/// compiles under `agent-runtime` alone, where neither feature is enabled.
const DYNAMIC_MCP_TOOL_PREFIX: &str = "mcp__";
const DYNAMIC_ACP_TOOL_PREFIX: &str = "acp__";

pub(super) async fn get_mode_configs() -> HashMap<String, AgentProfileConfig> {
    if let Ok(config_service) = GlobalConfigManager::get_service().await {
        config_service
            .get_config(Some("ai.agent_profiles"))
            .await
            .unwrap_or_default()
    } else {
        HashMap::new()
    }
}

pub(super) async fn get_subagent_overrides() -> AgentSubagentOverrideConfig {
    get_mode_configs()
        .await
        .into_iter()
        .filter_map(|(profile_id, config)| {
            if config.subagent_overrides.is_empty() {
                None
            } else {
                Some((profile_id, config.subagent_overrides))
            }
        })
        .collect()
}

pub(super) async fn load_project_subagent_overrides_local(
    workspace_root: &Path,
) -> OpenBitFunResult<AgentSubagentOverrideConfig> {
    let document = load_project_agent_profiles_document_local(workspace_root).await?;
    Ok(document
        .keys()
        .map(|profile_id| {
            (
                profile_id.clone(),
                get_project_subagent_overrides(&document, profile_id),
            )
        })
        .filter(|(_, overrides)| !overrides.is_empty())
        .collect())
}

pub(super) async fn save_project_subagent_overrides_local(
    workspace_root: &Path,
    overrides: &AgentSubagentOverrideConfig,
) -> OpenBitFunResult<()> {
    let mut document = load_project_agent_profiles_document_local(workspace_root).await?;

    let existing_profile_ids: Vec<String> = document.keys().cloned().collect();
    for profile_id in existing_profile_ids {
        let next = overrides.get(&profile_id).cloned().unwrap_or_default();
        set_project_subagent_overrides(&mut document, &profile_id, next);
    }

    for (profile_id, profile_overrides) in overrides {
        set_project_subagent_overrides(&mut document, profile_id, profile_overrides.clone());
    }

    save_project_agent_profiles_document_local(workspace_root, &document).await
}

fn merge_dynamic_tool_names(
    mut configured_tools: Vec<String>,
    registered_tool_names: &[String],
    prefixes: &[&str],
) -> Vec<String> {
    for tool_name in registered_tool_names {
        if !prefixes.iter().any(|prefix| tool_name.starts_with(*prefix)) {
            continue;
        }

        if configured_tools
            .iter()
            .any(|existing| existing == tool_name)
        {
            continue;
        }

        configured_tools.push(tool_name.clone());
    }

    configured_tools
}

pub(super) fn merge_dynamic_mcp_tools(
    configured_tools: Vec<String>,
    registered_tool_names: &[String],
) -> Vec<String> {
    merge_dynamic_tool_names(
        configured_tools,
        registered_tool_names,
        &[DYNAMIC_MCP_TOOL_PREFIX],
    )
}

/// Append the tools of every ACP client that is enabled as a subagent.
///
/// ACP clients are registered as regular tools (`acp__<client>__prompt`) rather
/// than as agents, so without this step an ACP subagent the user explicitly
/// enabled stays unreachable: the tool exists in the registry but no Agent
/// manifest ever lists its name, and the manifest allowlist is what decides
/// which tools reach the model. Like the MCP merge above, this only applies to
/// Agents that accept dynamically registered tools.
pub(super) fn merge_dynamic_acp_tools(
    configured_tools: Vec<String>,
    registered_tool_names: &[String],
) -> Vec<String> {
    merge_dynamic_tool_names(
        configured_tools,
        registered_tool_names,
        &[DYNAMIC_ACP_TOOL_PREFIX],
    )
}
