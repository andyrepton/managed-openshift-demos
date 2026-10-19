/** Shared request/response shapes for the Dev Spaces self-service plugin. */

import type { SizingInput, Sizing } from './sizing';

/**
 * Where an AI coding assistant sends its requests.
 *
 * `none` is a first-class choice, not an absence - a workspace with no agent
 * is a perfectly good workspace and should not require unticking anything.
 */
export type AiBackendKind = 'none' | 'in-cluster' | 'third-party';

export interface AiBackend {
  kind: AiBackendKind;
  /** `third-party` only: an https base URL, OpenAI-compatible. */
  baseUrl?: string;
  /** `third-party` only. Never stored in the devfile - see manifests.ts. */
  apiKey?: string;
  /** Served model name, where the endpoint needs one. */
  model?: string;
}

export interface DevSpaceRequest extends SizingInput {
  /** OpenShift username. Becomes the namespace, so it must be a DNS label. */
  username: string;
  /** Agents to install, by id from the UDI's published capability list. */
  agents: string[];
  ai: AiBackend;
  /** Optional git repository to clone into the workspace. */
  repoUrl?: string;
}

export interface GeneratedFile {
  path: string;
  contents: string;
  /** What this file is for, shown next to it in the preview. */
  purpose: string;
  /** False when it is shown for information and never applied. */
  applied: boolean;
}

export interface PlanResponse {
  request: DevSpaceRequest;
  namespace: string;
  sizing: Sizing;
  files: GeneratedFile[];
  warnings: string[];
  /** Factory URL that opens a workspace from the generated devfile. */
  factoryUrl?: string;
}

export interface ProvisionResult {
  namespace: string;
  /** What was created or updated, in the order it was applied. */
  applied: { kind: string; name: string; created: boolean }[];
  factoryUrl?: string;
  /** Where to send the user to actually start a workspace. */
  openUrl?: string;
  openLabel?: string;
  /**
   * Whether following `openUrl` reproduces exactly what was requested.
   *
   * False today in every case: this creates the namespace, Dev Spaces creates
   * the workspace, and the generated devfile is what carries the image and
   * the assistant selection. The UI says so rather than implying otherwise.
   */
  exact?: boolean;
  /** The DevWorkspace created, when one was. */
  workspaceName?: string;
  /** Why no workspace was created, when the namespace still was. */
  workspaceError?: string;
}
