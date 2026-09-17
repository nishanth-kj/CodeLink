import { defineResource } from "./index.js";

export const workspaceFilesResource = defineResource({
  uri: "workspace://files",
  name: "workspace-files",
  description: "Top-level listing of the workspace, honoring the configured exclude patterns.",
  mimeType: "application/json",
  permission: "workspaceRead",
  read: async (ctx) => {
    const config = ctx.getConfig();
    const result = await ctx.bridge.call("filesystem.list", {
      root: ctx.workspaceRoot,
      path: ".",
      maxDepth: 1,
      exclude: config.files.excludePatterns,
    });
    return JSON.stringify(result, null, 2);
  },
});
