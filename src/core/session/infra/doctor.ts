import { chromeCandidatesForPlatform } from "../../browser.js";
import type { DoctorReport } from "../../types.js";
import { providers } from "../../providers/index.js";

export function getDoctorReport(): DoctorReport {
  const { fs, runtime } = providers();
  const candidates = chromeCandidatesForPlatform();
  const found = candidates.some((candidatePath) => {
    try {
      return fs.existsSync(candidatePath);
    } catch {
      return false;
    }
  });
  return {
    ok: found,
    node: {
      version: runtime.version,
      platform: runtime.platform,
      arch: runtime.arch,
    },
    chrome: {
      found,
      candidates,
    },
  };
}

