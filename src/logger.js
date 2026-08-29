/**
 * SutraWeave WhatsApp Marketing Bot - Logger
 *
 * Logs each message send attempt with timestamp, phone, status, and details.
 * Writes to both console and a CSV log file.
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(
  LOG_DIR,
  `send-log-${new Date().toISOString().split("T")[0]}.csv`
);

let initialized = false;

/**
 * Ensure the log directory and file header exist.
 */
function initLogger() {
  if (initialized) return;

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(
      LOG_FILE,
      "timestamp,phone,business_name,template,status,details\n"
    );
  }

  initialized = true;
}

/**
 * Log a message send attempt.
 * @param {Object} entry
 * @param {string} entry.phone
 * @param {string} entry.businessName
 * @param {number} entry.template
 * @param {string} entry.status - 'sent', 'failed', 'skipped', 'dry-run'
 * @param {string} [entry.details]
 */
function logSend(entry) {
  initLogger();

  const timestamp = new Date().toISOString();
  const { phone, businessName, template, status, details = "" } = entry;

  // Escape CSV fields
  const escapedName = `"${(businessName || "").replace(/"/g, '""')}"`;
  const escapedDetails = `"${(details || "").replace(/"/g, '""')}"`;

  const line = `${timestamp},${phone},${escapedName},${template},${status},${escapedDetails}\n`;

  fs.appendFileSync(LOG_FILE, line);
}

/**
 * Get the current log file path.
 * @returns {string}
 */
function getLogFilePath() {
  initLogger();
  return LOG_FILE;
}

module.exports = { logSend, getLogFilePath };
