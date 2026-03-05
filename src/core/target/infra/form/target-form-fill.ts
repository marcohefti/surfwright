import { type Locator } from "playwright-core";
import { CliError } from "../../../errors.js";
import type { BrowserNodeLike } from "../types/browser-dom-types.js";

export type FormFieldValue = string | number | boolean | null | Array<string | number | boolean | null>;

export type TargetFormFillReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  applied: Array<{
    selector: string;
    action: "fill" | "select" | "check" | "uncheck";
    valueLength: number;
  }>;
  count: number;
  submitted: boolean;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseBooleanInput(value: FormFieldValue): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  throw new CliError("E_QUERY_INVALID", "checkbox/radio value must be boolean-like (true|false)");
}

export async function resolveFormSelectorLocator(opts: { page: { locator(selector: string): Locator }; selector: string }): Promise<Locator> {
  const locator = opts.page.locator(opts.selector);
  let count = 0;
  try {
    count = await locator.count();
  } catch {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${opts.selector}`);
  }

  if (count < 1) {
    throw new CliError("E_QUERY_INVALID", `No element matched selector: ${opts.selector}`);
  }
  return locator.first();
}

export async function applyFormValue(opts: {
  locator: Locator;
  value: FormFieldValue;
  timeoutMs: number;
}): Promise<{ action: "fill" | "select" | "check" | "uncheck"; valueLength: number }> {
  const descriptor = await opts.locator.evaluate((node: BrowserNodeLike) => {
    const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
    const inputType = typeof node?.type === "string" ? node.type.toLowerCase() : "";
    return {
      tagName,
      inputType,
    };
  });

  if (descriptor.tagName === "select") {
    const rawOptions = Array.isArray(opts.value) ? opts.value : [opts.value];
    const options = rawOptions.map((entry) => (entry === null ? "" : String(entry)));
    await opts.locator.selectOption(options, {
      timeout: opts.timeoutMs,
    });
    return {
      action: "select",
      valueLength: options.join(",").length,
    };
  }

  if (descriptor.tagName === "input" && descriptor.inputType === "radio") {
    const radioValue = parseBooleanInput(opts.value);
    if (!radioValue) {
      throw new CliError("E_QUERY_INVALID", "radio inputs only support truthy values");
    }
    await opts.locator.check({
      timeout: opts.timeoutMs,
    });
    return {
      action: "check",
      valueLength: 1,
    };
  }

  if (descriptor.tagName === "input" && descriptor.inputType === "checkbox") {
    const checked = parseBooleanInput(opts.value);
    if (checked) {
      await opts.locator.check({
        timeout: opts.timeoutMs,
      });
      return {
        action: "check",
        valueLength: 1,
      };
    }
    await opts.locator.uncheck({
      timeout: opts.timeoutMs,
    });
    return {
      action: "uncheck",
      valueLength: 0,
    };
  }

  if (Array.isArray(opts.value)) {
    throw new CliError("E_QUERY_INVALID", "array values are only supported for <select> controls");
  }

  const fillValue = opts.value === null ? "" : String(opts.value);
  await opts.locator.fill(fillValue, {
    timeout: opts.timeoutMs,
  });
  return {
    action: "fill",
    valueLength: fillValue.length,
  };
}
