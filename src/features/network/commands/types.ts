import type { Command } from "commander";

export type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

export type NetworkCommandContext = {
  target: Command;
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => OutputOpts;
  handleFailure: (error: unknown, outputOpts: OutputOpts) => void;
  printTargetSuccess: (report: unknown, output: OutputOpts) => void;
};

export type NetworkCommandSpec = {
  id: string;
  usage: string;
  summary: string;
  register: (ctx: NetworkCommandContext) => void;
};

export function writeNdjson(event: unknown) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
