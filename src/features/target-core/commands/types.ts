import type { Command } from "commander";

export type TargetOutputOpts = {
  json: boolean;
  pretty: boolean;
};

export type TargetCommandContext = {
  target: Command;
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => TargetOutputOpts;
  handleFailure: (error: unknown, outputOpts: TargetOutputOpts) => void;
  printTargetSuccess: (report: unknown, output: TargetOutputOpts) => void;
};

export type TargetCommandSpec = {
  id: string;
  usage: string;
  summary: string;
  register: (ctx: TargetCommandContext) => void;
};
