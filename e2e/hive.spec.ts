import { expect, test, type Page } from "@playwright/test";

async function waitForRoom(page: Page) {
  await page.goto("/hive/HIVE");
  await expect(page.getByTestId("contributor-card")).toBeVisible();
  await expect(page.locator("[data-connected='true']")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("model-hive-nano")).toBeVisible({ timeout: 20_000 });
}

test("landing join sheet looks like a wallet amount screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /building can run a 27B/i })).toBeVisible();
  await expect(page.getByTestId("join-code")).toBeVisible();
  await expect(page.getByTestId("join-submit")).toBeVisible();
});

test("two browsers: share unlocks catalog, prompt streams to both, balances move", async ({ browser }) => {
  const workerCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const worker = await workerCtx.newPage();
  const buyer = await buyerCtx.newPage();

  await waitForRoom(worker);
  await waitForRoom(buyer);

  await expect(worker.getByTestId("model-hive-nano")).toHaveAttribute("data-unlocked", "false");

  await worker.getByTestId("share-toggle").click({ force: true });
  await expect(worker.getByTestId("share-toggle")).toHaveAttribute("aria-checked", "true");
  await expect(worker.getByTestId("model-hive-nano")).toHaveAttribute("data-unlocked", "true", { timeout: 15_000 });
  await expect(buyer.getByTestId("model-hive-nano")).toHaveAttribute("data-unlocked", "true", { timeout: 15_000 });

  const workerBalance = await worker.getByTestId("balance").innerText();
  const buyerBalance = await buyer.getByTestId("balance").innerText();

  await buyer.getByTestId("prompt-input").fill("Once upon a time");
  await buyer.getByTestId("prompt-send").click();

  await expect(buyer.getByTestId("swarm-message")).toBeVisible({ timeout: 45_000 });
  await expect(worker.getByTestId("swarm-message")).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => buyer.getByTestId("swarm-message").innerText(), { timeout: 45_000 }).toMatch(/\w{3,}/);
  await expect.poll(async () => worker.getByTestId("swarm-message").innerText(), { timeout: 45_000 }).toMatch(/\w{3,}/);

  await expect.poll(async () => buyer.getByTestId("balance").innerText()).not.toEqual(buyerBalance);
  try {
    await expect
      .poll(async () => Number(await worker.getByTestId("earnings").getAttribute("data-earned")))
      .toBeGreaterThan(0);
  } catch (err) {
    const dump = await worker.evaluate(() => ({
      earnedText: document.querySelector("[data-testid=earnings]")?.textContent,
      earnedAttr: document.querySelector("[data-testid=earnings]")?.getAttribute("data-earned"),
      balance: document.querySelector("[data-testid=balance]")?.textContent,
      connected: document.querySelector("[data-connected]")?.getAttribute("data-connected"),
      swarm: document.querySelector("[data-testid=swarm-message]")?.textContent,
    }));
    const buyerDump = await buyer.evaluate(() => ({
      balance: document.querySelector("[data-testid=balance]")?.textContent,
      swarm: document.querySelector("[data-testid=swarm-message]")?.textContent,
    }));
    console.log("earnings dump", { dump, buyerDump, workerBalance, buyerBalance });
    throw err;
  }

  void workerBalance;
  await workerCtx.close();
  await buyerCtx.close();
});

test("demo wallet top-up credits instantly", async ({ page }) => {
  await waitForRoom(page);
  const before = await page.getByTestId("balance").innerText();
  await page.getByTestId("wallet-open").click({ force: true });
  await expect(page.getByTestId("wallet-sheet")).toBeVisible();
  await page.getByTestId("topup-5").click();
  await expect.poll(async () => page.getByTestId("wallet-balance").innerText()).not.toEqual(before);
});
