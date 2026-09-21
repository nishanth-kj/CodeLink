import type * as os from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, effectiveHost } from "../../extension/src/config/defaults.js";
import {
  bindsAllIpv6,
  classifyIpv6,
  clientEndpoint,
  formatHostForUrl,
  ipv6Endpoints,
  listShareableIpv6,
  localEndpoint,
  mcpUrl,
} from "../../extension/src/config/network.js";
import type { CodeLinkConfig } from "../../extension/src/config/schema.js";

function configWith(remote: Partial<CodeLinkConfig["remote"]>, host = "127.0.0.1"): CodeLinkConfig {
  return {
    ...DEFAULT_CONFIG,
    server: { ...DEFAULT_CONFIG.server, host, port: 32100 },
    remote: { ...DEFAULT_CONFIG.remote, ...remote },
  };
}

function iface(address: string, overrides: Partial<os.NetworkInterfaceInfo> = {}): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0,
    ...overrides,
  } as os.NetworkInterfaceInfo;
}

describe("effectiveHost", () => {
  it("is always loopback while remote access is off, even if IPv6 is requested", () => {
    expect(effectiveHost(configWith({ enabled: false, ipv6: true }, "0.0.0.0"))).toBe("127.0.0.1");
  });

  it("uses the configured host when remote is on and IPv6 is off", () => {
    expect(effectiveHost(configWith({ enabled: true, ipv6: false }, "192.168.1.5"))).toBe("192.168.1.5");
  });

  it("binds every IPv6 interface when remote and IPv6 are both on", () => {
    expect(effectiveHost(configWith({ enabled: true, ipv6: true }, "192.168.1.5"))).toBe("::");
  });
});

describe("classifyIpv6", () => {
  it("recognises public, unique-local, link-local and loopback addresses", () => {
    expect(classifyIpv6("2401:4900:8839:ebc6::1")).toBe("global");
    expect(classifyIpv6("3fff::1")).toBe("global");
    expect(classifyIpv6("fd12:3456:789a::1")).toBe("unique-local");
    expect(classifyIpv6("fc00::1")).toBe("unique-local");
    expect(classifyIpv6("fe80::1")).toBe("link-local");
    expect(classifyIpv6("::1")).toBe("loopback");
  });

  it("does not treat anything else as shareable", () => {
    expect(classifyIpv6("::")).toBe("other");
    expect(classifyIpv6("::ffff:192.168.1.5")).toBe("other");
    expect(classifyIpv6("ff02::1")).toBe("other");
  });

  it("ignores a zone id suffix", () => {
    expect(classifyIpv6("fe80::1%eth0")).toBe("link-local");
  });
});

describe("listShareableIpv6", () => {
  it("keeps public and unique-local addresses, public first, and drops the rest", () => {
    const found = listShareableIpv6({
      lan: [iface("fd12::5"), iface("fe80::5"), iface("2001:db8::5"), iface("192.168.1.5", { family: "IPv4" })],
      lo: [iface("::1", { internal: true })],
    });
    expect(found).toEqual([
      { address: "2001:db8::5", scope: "global" },
      { address: "fd12::5", scope: "unique-local" },
    ]);
  });

  it("de-duplicates an address that appears on more than one interface", () => {
    const found = listShareableIpv6({ a: [iface("2001:db8::5")], b: [iface("2001:db8::5")] });
    expect(found).toHaveLength(1);
  });

  it("returns nothing when the machine has no usable IPv6 address", () => {
    expect(listShareableIpv6({ lan: [iface("fe80::5")] })).toEqual([]);
    expect(listShareableIpv6({})).toEqual([]);
  });
});

describe("URL formatting", () => {
  it("brackets IPv6 literals and leaves everything else alone", () => {
    expect(formatHostForUrl("2001:db8::5")).toBe("[2001:db8::5]");
    expect(formatHostForUrl("[2001:db8::5]")).toBe("[2001:db8::5]");
    expect(formatHostForUrl("127.0.0.1")).toBe("127.0.0.1");
    expect(formatHostForUrl("example.com")).toBe("example.com");
  });

  it("builds a valid MCP URL for an IPv6 address and port", () => {
    const url = mcpUrl("2001:db8::5", 32100);
    expect(url).toBe("http://[2001:db8::5]:32100/mcp");
    expect(new URL(url).port).toBe("32100");
    expect(new URL(url).hostname).toBe("[2001:db8::5]");
  });
});

describe("endpoints", () => {
  const interfaces = { lan: [iface("2001:db8::5"), iface("fd12::5")] };

  it("uses loopback as the local endpoint of a wildcard bind", () => {
    expect(localEndpoint(configWith({ enabled: true, ipv6: true }))).toBe("http://127.0.0.1:32100/mcp");
    expect(localEndpoint(configWith({ enabled: true }, "0.0.0.0"))).toBe("http://127.0.0.1:32100/mcp");
    expect(localEndpoint(configWith({ enabled: true }, "192.168.1.5"))).toBe("http://192.168.1.5:32100/mcp");
  });

  it("exposes IPv6 endpoints only while the server binds every IPv6 interface", () => {
    expect(ipv6Endpoints(configWith({ enabled: true, ipv6: true }), interfaces)).toEqual([
      { url: "http://[2001:db8::5]:32100/mcp", scope: "global" },
      { url: "http://[fd12::5]:32100/mcp", scope: "unique-local" },
    ]);
    expect(ipv6Endpoints(configWith({ enabled: true, ipv6: false }), interfaces)).toEqual([]);
    expect(ipv6Endpoints(configWith({ enabled: false, ipv6: true }), interfaces)).toEqual([]);
  });

  it("treats a hand-edited host of :: like the IPv6 toggle", () => {
    expect(bindsAllIpv6(configWith({ enabled: true }, "::"))).toBe(true);
    expect(bindsAllIpv6(configWith({ enabled: false }, "::"))).toBe(false);
  });

  it("hands remote clients the local endpoint when there is no public IPv6 address", () => {
    expect(clientEndpoint(configWith({ enabled: true, ipv6: false }))).toBe("http://127.0.0.1:32100/mcp");
  });
});
