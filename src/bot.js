/**
 * SutraWeave WhatsApp Marketing Bot
 *
 * QR-based WhatsApp bot that sends customized marketing messages
 * to businesses in Patna promoting SutraWeave.
 *
 * Usage:
 *   node src/bot.js            → Run normally (sends messages)
 *   node src/bot.js --dry-run  → Preview messages without sending
 *   node src/bot.js --test     → Send a test message to yourself
 *
 * On first run, a QR code will appear in your terminal.
 * Scan it with your WhatsApp to authenticate.
 * Subsequent runs will reuse the saved session.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const qrcode = require("qrcode-terminal");
const chalk = require("chalk");
const { loadContacts, markAsSent } = require("./contacts");
const { getMessage } = require("./messages");
const { logSend, getLogFilePath } = require("./logger");

/**
 * Clean up stale browser lock files from a previous crashed session.
 * Prevents "browser is already running" errors.
 */
function cleanupStaleLocks() {
  const lockFile = path.join(
    __dirname, "..", ".wwebjs_auth", "session", "SingletonLock"
  );
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log(chalk.gray("🧹 Cleaned up stale browser lock file."));
    }
  } catch (err) {
    // Ignore — lock file may not exist
  }
}

// ─── Config ──────────────────────────────────────────────────────────
const MIN_DELAY = parseInt(process.env.MIN_DELAY, 10) || 30;
const MAX_DELAY = parseInt(process.env.MAX_DELAY, 10) || 90;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES, 10) || 50;
const DEFAULT_TEMPLATE = parseInt(process.env.DEFAULT_TEMPLATE, 10) || 1;

const DRY_RUN = process.argv.includes("--dry-run");
const TEST_MODE = process.argv.includes("--test");

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Sleep for a random duration between min and max seconds.
 */
function randomDelay(minSec, maxSec) {
  const ms = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format seconds into a human-readable string.
 */
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

/**
 * Print a styled banner on startup.
 */
function printBanner() {
  console.log();
  console.log(
    chalk.bold.cyan(
      "╔══════════════════════════════════════════════════════╗"
    )
  );
  console.log(
    chalk.bold.cyan(
      "║       🚀 SutraWeave WhatsApp Marketing Bot         ║"
    )
  );
  console.log(
    chalk.bold.cyan(
      "╚══════════════════════════════════════════════════════╝"
    )
  );
  console.log();

  if (DRY_RUN) {
    console.log(
      chalk.yellow.bold("  ⚠️  DRY RUN MODE — No messages will be sent\n")
    );
  }
  if (TEST_MODE) {
    console.log(
      chalk.magenta.bold("  🧪 TEST MODE — Will send to your own number\n")
    );
  }

  console.log(chalk.gray(`  Delay: ${MIN_DELAY}-${MAX_DELAY}s between messages`));
  console.log(chalk.gray(`  Max messages: ${MAX_MESSAGES}`));
  console.log(chalk.gray(`  Default template: ${DEFAULT_TEMPLATE}`));
  console.log();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  printBanner();
  cleanupStaleLocks();
  console.log(chalk.gray("⏳ Launching stealth browser...\n"));
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--disable-gpu",
      ],
    });
  } catch (err) {
    console.error(chalk.red("Failed to launch stealth browser."));
    process.exit(1);
  }

  // Initialize WhatsApp client with persistent auth and stealth browser
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      browserWSEndpoint: browser.wsEndpoint(),
    },
  });

  // ─── QR Code Event ───
  client.on("qr", async (qr) => {
    console.log(
      chalk.yellow.bold("\n📱 Scan this QR code with your WhatsApp:\n")
    );
    qrcode.generate(qr, { small: true });

    // Also save QR as an image file for easier scanning
    const QRCode = require("qrcode");
    const qrImagePath = path.join(__dirname, "..", "qr-code.png");
    try {
      await QRCode.toFile(qrImagePath, qr, {
        width: 600,
        margin: 4,
        color: { dark: "#000000", light: "#ffffff" },
      });
      console.log(
        chalk.green(`\n  ✅ QR saved as image: ${chalk.underline("qr-code.png")}`)
      );
      console.log(
        chalk.cyan("  📂 Opening the QR image now — scan it from your phone!\n")
      );
      // Auto-open on macOS
      require("child_process").exec(`open "${qrImagePath}"`);
    } catch (err) {
      // Fallback — terminal QR is still available
    }

    console.log(
      chalk.gray(
        "  Open WhatsApp → Settings → Linked Devices → Link a Device\n"
      )
    );
  });

  // ─── Auth Success ───
  client.on("authenticated", () => {
    console.log(chalk.green("✅ Authenticated successfully!"));
  });

  // ─── Auth Failure ───
  client.on("auth_failure", (msg) => {
    console.error(chalk.red(`❌ Authentication failed: ${msg}`));
    console.log(
      chalk.yellow(
        "   Delete the .wwebjs_auth folder and try again."
      )
    );
    process.exit(1);
  });

  // ─── Ready ───
  client.on("ready", async () => {
    console.log(chalk.green.bold("\n✅ WhatsApp is connected and ready!\n"));

    try {
      if (TEST_MODE) {
        await runTestMode(client);
      } else {
        await runCampaign(client);
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}`));
      console.error(err);
    } finally {
      console.log(chalk.gray("\n📋 Logs saved to: " + getLogFilePath()));
      console.log(chalk.cyan("\n👋 Bot finished. Disconnecting...\n"));
      await client.destroy();
      if (browser) await browser.close();
      process.exit(0);
    }
  });

  // ─── Disconnected ───
  client.on("disconnected", (reason) => {
    console.log(chalk.yellow(`\n⚠️  Disconnected: ${reason}`));
  });

  // ─── Graceful Shutdown ───
  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n\n⏹️  Stopping bot gracefully..."));
    await client.destroy();
    if (browser) await browser.close();
    process.exit(0);
  });

  // Start the client
  console.log(chalk.gray("⏳ Initializing WhatsApp client...\n"));
  await client.initialize();
}

// ─── Campaign Runner ─────────────────────────────────────────────────

async function runCampaign(client) {
  // Load contacts
  console.log(chalk.cyan("📂 Loading contacts...\n"));
  const contacts = await loadContacts({ skipSent: true });

  if (contacts.length === 0) {
    console.log(
      chalk.yellow(
        "⚠️  No unsent contacts found!\n" +
          "   Either all contacts have been sent, or data/contacts.csv is empty.\n" +
          "   To resend, delete data/sent.json and run again."
      )
    );
    return;
  }

  // Cap at max messages
  const toSend = contacts.slice(0, MAX_MESSAGES);
  console.log(
    chalk.white(
      `📋 Found ${chalk.bold(contacts.length)} unsent contacts. ` +
        `Sending to ${chalk.bold(toSend.length)} (max: ${MAX_MESSAGES}).\n`
    )
  );

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < toSend.length; i++) {
    const contact = toSend[i];
    const templateId = contact.template || DEFAULT_TEMPLATE;
    const message = getMessage(templateId, contact.businessName, contact.category);
    const chatId = `${contact.phone}@c.us`;

    const progress = chalk.gray(`[${i + 1}/${toSend.length}]`);

    if (DRY_RUN) {
      // Preview mode
      console.log(
        `${progress} ${chalk.yellow("DRY-RUN")} → ${chalk.white(contact.businessName)} ${chalk.gray(`[${contact.category}]`)} (${contact.phone})`
      );
      console.log(chalk.gray(`   Template: ${templateId} | Category: ${contact.category}`));
      console.log(chalk.gray(`   Preview: ${message.substring(0, 100)}...`));

      logSend({
        phone: contact.phone,
        businessName: contact.businessName,
        template: templateId,
        status: "dry-run",
      });
      continue;
    }

    try {
      console.log(
        `${progress} 📤 Sending to ${chalk.bold(contact.businessName)} (${contact.phone})...`
      );

      let chat;
      try {
        // Fetch chat to simulate typing indicator
        chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        // Simulate typing delay based on message length (approx 3-6s)
        const typeDelayMs = Math.min(6000, Math.max(2500, message.length * 15));
        await new Promise((r) => setTimeout(r, typeDelayMs));
      } catch (e) {
        // Ignore if getting chat fails, sendMessage will handle the error
      }

      // Do NOT send images for cold outreach (Template 1) to avoid spam filters
      if (templateId !== 1) {
        const mediaPath = path.join(__dirname, "..", "data", "marketing_banner.jpg");
        const media = MessageMedia.fromFilePath(mediaPath);
        await client.sendMessage(chatId, media, { caption: message });
      } else {
        await client.sendMessage(chatId, message);
      }

      // Clear typing state
      if (chat) await chat.clearState();

      // Mark as sent (with full details for tracking)
      markAsSent(contact.phone, {
        businessName: contact.businessName,
        category: contact.category,
        template: templateId,
      });
      sent++;

      logSend({
        phone: contact.phone,
        businessName: contact.businessName,
        template: templateId,
        status: "sent",
      });

      console.log(`${progress} ${chalk.green("✅ Sent!")} → ${contact.businessName}`);

      // Random delay before next message (skip delay after last message)
      if (i < toSend.length - 1) {
        // Coffee break after every 12 messages to simulate human behavior
        if ((i + 1) % 12 === 0) {
          console.log(chalk.magenta.bold(`   ☕ Taking a 10-minute coffee break to prevent bans...`));
          await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
        } else {
          const delaySec =
            Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
          console.log(
            chalk.gray(`   ⏳ Waiting ${formatDuration(delaySec)} before next message...`)
          );
          await randomDelay(MIN_DELAY, MAX_DELAY);
        }
      }
    } catch (err) {
      failed++;

      logSend({
        phone: contact.phone,
        businessName: contact.businessName,
        template: templateId,
        status: "failed",
        details: err.message,
      });

      console.log(
        `${progress} ${chalk.red("❌ Failed")} → ${contact.businessName}: ${err.message}`
      );
    }
  }

  // Summary
  console.log(chalk.cyan("\n═══════════════════════════════════════"));
  console.log(chalk.cyan.bold("  📊 Campaign Summary"));
  console.log(chalk.cyan("═══════════════════════════════════════"));
  if (DRY_RUN) {
    console.log(chalk.yellow(`  Mode:     DRY RUN (no messages sent)`));
    console.log(chalk.white(`  Previewed: ${toSend.length} messages`));
  } else {
    console.log(chalk.green(`  ✅ Sent:    ${sent}`));
    console.log(chalk.red(`  ❌ Failed:  ${failed}`));
    console.log(chalk.gray(`  📋 Total:   ${sent + failed}`));
  }
  console.log(chalk.cyan("═══════════════════════════════════════\n"));
}

// ─── Test Mode ───────────────────────────────────────────────────────

async function runTestMode(client) {
  console.log(chalk.magenta("🧪 Test Mode: Sending a test message to yourself...\n"));

  // Get the bot's own number
  const info = client.info;
  const myNumber = info.wid.user;
  const chatId = `${myNumber}@c.us`;

  // Show a restaurant example so you can see category customization
  const testCategory = "restaurant";
  const message = getMessage(DEFAULT_TEMPLATE, "My Test Restaurant", testCategory);

  console.log(chalk.gray(`  Your number: ${myNumber}`));
  console.log(chalk.gray(`  Template: ${DEFAULT_TEMPLATE} | Category: ${testCategory}\n`));
  console.log(chalk.gray("  Message preview:"));
  console.log(chalk.gray("  " + message.split("\n").join("\n  ")));
  console.log();

  if (DRY_RUN) {
    console.log(chalk.yellow("  DRY-RUN: Would have sent the above message."));
    return;
  }

  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    await new Promise((r) => setTimeout(r, 3000));
  } catch (e) {}

  if (DEFAULT_TEMPLATE !== 1) {
    const mediaPath = path.join(__dirname, "..", "data", "marketing_banner.jpg");
    const media = MessageMedia.fromFilePath(mediaPath);
    await client.sendMessage(chatId, media, { caption: message });
  } else {
    await client.sendMessage(chatId, message);
  }
  
  console.log(chalk.green.bold("  ✅ Test message sent to your own WhatsApp!\n"));
  console.log(chalk.gray("  Check your WhatsApp to verify the message looks good."));
}

// ─── Run ─────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(chalk.red(`\n💥 Fatal error: ${err.message}`));
  console.error(err);
  process.exit(1);
});
