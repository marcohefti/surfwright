import type { TargetOutputOpts } from "../commands/types.js";
import { printTargetCoreSuccess } from "./core.js";
import { printTargetMaintenanceSuccess } from "./maintenance.js";
import { printTargetNetworkSuccess } from "./network.js";

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

export function printTargetSuccess(report: unknown, opts: TargetOutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }

  if (printTargetCoreSuccess(report)) {
    return;
  }
  if (printTargetNetworkSuccess(report)) {
    return;
  }
  if (printTargetMaintenanceSuccess(report)) {
    return;
  }

  process.stdout.write("ok\n");
}
