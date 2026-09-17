import type { Session } from '@/flow_chat/types/flow-chat';
import { sessionProjectWorkspacePath } from '@/flow_chat/utils/sessionWorkspace';
import { findWorkspaceForSession } from '@/flow_chat/utils/workspaceScope';
import type { WorkspaceInfo } from '@/shared/types';
import type { SessionSceneTarget } from '../components/SceneBar/types';

/** Resolve the owning project, including worktree sessions and legacy metadata. */
export function resolveSessionSceneWorkspace(session: Session, workspaces: Iterable<WorkspaceInfo>) {
  return findWorkspaceForSession({
    ...session,
    workspaceId: session.projectWorkspaceId || session.config?.projectWorkspaceId || session.workspaceId || session.config?.workspaceId,
    workspacePath: sessionProjectWorkspacePath(session),
    remoteConnectionId: session.remoteConnectionId || session.config?.remoteConnectionId,
    remoteSshHost: session.remoteSshHost || session.config?.remoteSshHost,
  }, workspaces);
}

export function resolveSessionSceneTarget(
  session: Session,
  workspaces: Iterable<WorkspaceInfo>,
  surfaceId: string,
): SessionSceneTarget {
  const workspace = resolveSessionSceneWorkspace(session, workspaces);
  const workspaceId = workspace?.id || session.workspaceId;
  // An unresolved legacy session remains individually addressable. Never group
  // it with another workspace through a guessed folder key.
  const workspaceKey = workspaceId
    ? JSON.stringify(['workspace', workspaceId])
    : JSON.stringify(['unresolved-workspace', session.sessionId]);
  return { surfaceId, workspaceKey, sessionId: session.sessionId };
}
