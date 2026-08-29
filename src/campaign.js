/**
 * Full Campaign Runner
 *
 * Runs WhatsApp + Email campaigns simultaneously.
 * WhatsApp bot sends via QR-linked account,
 * Email campaign scrapes & sends via Mailtrap SMTP.
 *
 * Usage:
 *   node src/campaign.js            → Run both channels
 *   node src/campaign.js --dry-run  → Preview both (no sends)
 */

const { spawn } = require("child_process");
const path = require("path");
const chalk = require("chalk");

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = path.join(__dirname, "..");

console.log();
console.log(chalk.bold.magenta("╔══════════════════════════════════════════════════════╗"));
console.log(chalk.bold.magenta("║   🚀 Full Marketing Campaign                        ║"));
console.log(chalk.bold.magenta("║   📱 WhatsApp + 📧 Email (running in parallel)      ║"));
console.log(chalk.bold.magenta("╚══════════════════════════════════════════════════════╝"));
console.log();

if (DRY_RUN) console.log(chalk.yellow.bold("  ⚠️  DRY RUN — No messages or emails will be sent\n"));

const args = DRY_RUN ? ["--dry-run"] : [];

// ─── Launch WhatsApp Bot ─────────────────────────────────────────────
console.log(chalk.green.bold("  📱 Starting WhatsApp campaign...\n"));

const whatsapp = spawn("node", [path.join(__dirname, "bot.js"), ...args], {
  cwd: ROOT,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env },
});

whatsapp.stdout.on("data", (data) => {
  const lines = data.toString().split("\n").filter(Boolean);
  lines.forEach((line) => {
    console.log(chalk.green("  [WhatsApp] ") + line);
  });
});

whatsapp.stderr.on("data", (data) => {
  const lines = data.toString().split("\n").filter(Boolean);
  lines.forEach((line) => {
    console.log(chalk.green("  [WhatsApp] ") + chalk.gray(line));
  });
});

// ─── Launch Email Campaign ───────────────────────────────────────────
// Start email with a small delay so WhatsApp QR shows first
setTimeout(() => {
  console.log(chalk.blue.bold("\n  📧 Starting Email campaign...\n"));

  const email = spawn("node", [path.join(__dirname, "scrape-and-email.js"), ...args], {
    cwd: ROOT,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env },
  });

  email.stdout.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    lines.forEach((line) => {
      console.log(chalk.blue("  [Email]    ") + line);
    });
  });

  email.stderr.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    lines.forEach((line) => {
      console.log(chalk.blue("  [Email]    ") + chalk.gray(line));
    });
  });

  email.on("close", (code) => {
    console.log(chalk.blue(`\n  📧 Email campaign finished (exit code: ${code})\n`));
  });
}, 3000);

// ─── Handle WhatsApp exit ────────────────────────────────────────────
whatsapp.on("close", (code) => {
  console.log(chalk.green(`\n  📱 WhatsApp campaign finished (exit code: ${code})\n`));
});

// ─── Graceful shutdown ───────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log(chalk.yellow("\n\n⏹️  Stopping all campaigns...\n"));
  whatsapp.kill("SIGINT");
  // email process will die with parent
  setTimeout(() => process.exit(0), 2000);
});
