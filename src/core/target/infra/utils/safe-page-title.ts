export async function safePageTitle(
  page: { title(): Promise<string>; waitForLoadState(state: "domcontentloaded", opts: { timeout: number }): Promise<void> },
  timeoutMs: number,
): Promise<string> {
  try {
    return await page.title();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/execution context was destroyed|most likely because of a navigation/i.test(message)) {
      throw error;
    }
    await page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(2000, timeoutMs)),
      })
      .catch(() => {});
    try {
      return await page.title();
    } catch {
      return "";
    }
  }
}

