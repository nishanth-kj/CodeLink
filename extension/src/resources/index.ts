import type { PermissionKey } from "../security/permissions.js";
import type { ToolContext } from "../tools/index.js";

export type ResourceContext = ToolContext;

export interface RegisteredResource {
  /** Fixed MCP resource URI, e.g. "workspace://info". */
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  permission: PermissionKey | null;
  read: (ctx: ResourceContext) => Promise<string>;
}

export function defineResource(resource: RegisteredResource): RegisteredResource {
  return resource;
}
