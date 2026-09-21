import * as os from "node:os";
import { MCP_ENDPOINT_PATH } from "../mcp/protocol.js";
import { effectiveHost } from "./defaults.js";
import type { CodeLinkConfig } from "./schema.js";

/** Deliberately free of any `vscode` import so it can be unit-tested. */

export type Ipv6Scope = "global" | "unique-local" | "link-local" | "loopback" | "other";

/** Classifies an IPv6 address by its leading hextet (RFC 4291 / RFC 4193). */
export function classifyIpv6(address: string): Ipv6Scope {
  const lower = (address.split("%")[0] ?? "").toLowerCase();
  if (lower === "::1") {
    return "loopback";
  }
  const first = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (Number.isNaN(first)) {
    return "other";
  }
  if ((first & 0xe000) === 0x2000) {
    return "global"; // 2000::/3
  }
  if ((first & 0xfe00) === 0xfc00) {
    return "unique-local"; // fc00::/7
  }
  if ((first & 0xffc0) === 0xfe80) {
    return "link-local"; // fe80::/10
  }
  return "other";
}

export interface Ipv6Candidate {
  address: string;
  /** `global` is reachable from the internet (firewall permitting);
   * `unique-local` only from inside the local network. */
  scope: "global" | "unique-local";
}

/** IPv6 addresses on this machine that another host could plausibly dial.
 * Link-local addresses are skipped: they need a zone id (`%eth0`) that a
 * client on another machine can't supply. Public addresses come first. */
export function listShareableIpv6(
  interfaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces(),
): Ipv6Candidate[] {
  const found: Ipv6Candidate[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv6" || entry.internal) {
        continue;
      }
      const scope = classifyIpv6(entry.address);
      if ((scope === "global" || scope === "unique-local") && !found.some((c) => c.address === entry.address)) {
        found.push({ address: entry.address, scope });
      }
    }
  }
  return found.sort((a, b) => Number(b.scope === "global") - Number(a.scope === "global"));
}

/** IPv6 literals must be bracketed inside a URL authority (RFC 3986). */
export function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function mcpUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}${MCP_ENDPOINT_PATH}`;
}

/** True when the server is (or will be, once started) listening on every
 * IPv6 interface. Also covers a hand-edited `codelink.server.host` of `::`. */
export function bindsAllIpv6(config: CodeLinkConfig): boolean {
  return effectiveHost(config) === "::";
}

/** The endpoint to use from this machine. Wildcard binds (`::`, `0.0.0.0`)
 * aren't addresses a client can dial, so they map to loopback. */
export function localEndpoint(config: CodeLinkConfig): string {
  const host = effectiveHost(config);
  return mcpUrl(host === "::" || host === "0.0.0.0" ? "127.0.0.1" : host, config.server.port);
}

export interface Ipv6Endpoint {
  url: string;
  scope: Ipv6Candidate["scope"];
}

/** Direct-by-address URLs for other machines; empty unless IPv6 is exposed. */
export function ipv6Endpoints(
  config: CodeLinkConfig,
  interfaces?: ReturnType<typeof os.networkInterfaces>,
): Ipv6Endpoint[] {
  if (!bindsAllIpv6(config)) {
    return [];
  }
  return listShareableIpv6(interfaces).map(({ address, scope }) => ({
    url: mcpUrl(address, config.server.port),
    scope,
  }));
}

/** The URL to put in another machine's MCP client config: the public IPv6
 * endpoint when there is one, otherwise the local endpoint. */
export function clientEndpoint(config: CodeLinkConfig): string {
  const publicEndpoint = ipv6Endpoints(config).find((endpoint) => endpoint.scope === "global");
  return publicEndpoint?.url ?? localEndpoint(config);
}
