import { probeUnpackedExtensionSideloadSupport, resolveManagedBrowserExecutablePath } from "../../browser.js";
import type { DoctorReport } from "../../types.js";
import { providers } from "../../providers/index.js";

export async function getDoctorReport(): Promise<DoctorReport> {
  const { runtime } = providers();
  const browser = resolveManagedBrowserExecutablePath();
  const found = browser.executablePath !== null;
  const probe =
    found && browser.executablePath
      ? await probeUnpackedExtensionSideloadSupport({
          executablePath: browser.executablePath,
          timeoutMs: 8000,
          browserMode: "headless",
        }).catch(() => ({
          checked: false,
          supported: false,
          executablePath: browser.executablePath,
          launchArgs: [],
          checkedPreferencePaths: [],
          readablePreferencePaths: [],
          preferenceRuntimeIds: [],
          cdpRuntimeIds: [],
          cdpTargetUrls: [],
          cdpMatchedExtensionIds: [],
          observedWaitMs: 0,
          reason: "spawn_failed" as const,
        }))
      : null;
  return {
    ok: found,
    node: {
      version: runtime.version,
      platform: runtime.platform,
      arch: runtime.arch,
    },
    chrome: {
      found,
      candidates: browser.candidates,
      executablePath: browser.executablePath,
      executableSource: browser.source,
      overridePath: browser.overridePath,
      unpackedExtensionSideload: probe
        ? {
            checked: probe.checked,
            supported: probe.checked ? probe.supported : null,
            reason: probe.reason === "ok" ? "ok" : probe.reason,
            launchArgs: probe.launchArgs,
            cdpMatchedExtensionIds: probe.cdpMatchedExtensionIds,
          }
        : {
            checked: false,
            supported: null,
            reason: browser.executablePath ? "not_checked" : "browser_not_found",
            launchArgs: [],
            cdpMatchedExtensionIds: [],
          },
    },
  };
}
