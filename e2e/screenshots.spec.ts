import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "docs/ui");

test.beforeAll(() => {
  mkdirSync(out, { recursive: true });
});

test("capture landing, room, mobile contributor, wallet", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "landing.png"), fullPage: true });

  await page.goto("/hive/HIVE");
  await page.locator("[data-connected='true']").waitFor({ timeout: 20_000 });
  await page.getByTestId("contributor-card").waitFor();
  await page.getByTestId("share-toggle").click({ force: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "group-room.png"), fullPage: true });

  await page.getByTestId("wallet-open").click({ force: true });
  await page.getByTestId("wallet-sheet").waitFor();
  await page.screenshot({ path: path.join(out, "wallet.png") });
  await page.getByRole("button", { name: "Done" }).click();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await phone.newPage();
  await mobile.goto("/hive/HIVE");
  await mobile.locator("[data-connected='true']").waitFor({ timeout: 20_000 });
  await mobile.getByTestId("contributor-card").waitFor();
  await mobile.getByTestId("share-toggle").click({ force: true });
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: path.join(out, "mobile-contributor.png"), fullPage: true });
  await phone.close();
});
