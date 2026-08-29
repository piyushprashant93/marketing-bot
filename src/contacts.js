/**
 * SutraWeave WhatsApp Marketing Bot - Contact Loader
 *
 * Loads business contacts from CSV, validates phone numbers,
 * and tracks sent status to prevent duplicate messages.
 */

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const CONTACTS_FILE = path.join(__dirname, "..", "data", "contacts.csv");
const SENT_FILE = path.join(__dirname, "..", "data", "sent.json");

/**
 * In-memory cache of sent numbers (avoids re-reading file on every call)
 * @type {Set<string>|null}
 */
let sentCache = null;

/**
 * Load the set of already-sent phone numbers.
 * @returns {Set<string>} Set of phone numbers that have been sent messages
 */
function loadSentNumbers() {
  if (sentCache) return sentCache;

  try {
    if (fs.existsSync(SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
      // Support both old format (array of strings) and new format (array of objects)
      const numbers = (data.sent || []).map((entry) =>
        typeof entry === "string" ? entry : entry.phone
      );
      sentCache = new Set(numbers);
      return sentCache;
    }
  } catch (err) {
    console.error("⚠️  Could not load sent.json, starting fresh:", err.message);
  }
  sentCache = new Set();
  return sentCache;
}

/**
 * Save a phone number to the sent tracking file with full details.
 * @param {string} phone - Phone number that was sent a message
 * @param {Object} [details] - Additional details to track
 * @param {string} [details.businessName] - Name of the business
 * @param {string} [details.category] - Business category
 * @param {number} [details.template] - Template ID used
 */
function markAsSent(phone, details = {}) {
  // Load existing records
  let records = [];
  try {
    if (fs.existsSync(SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
      records = data.sent || [];
    }
  } catch (err) {
    // Start fresh
  }

  // Add new record (with full details for audit trail)
  records.push({
    phone,
    businessName: details.businessName || "",
    category: details.category || "",
    template: details.template || 1,
    sentAt: new Date().toISOString(),
  });

  // Update in-memory cache
  if (!sentCache) sentCache = new Set();
  sentCache.add(phone);

  // Write to file
  const dir = path.dirname(SENT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    SENT_FILE,
    JSON.stringify(
      {
        sent: records,
        totalSent: records.length,
        lastUpdated: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/**
 * Normalize an Indian phone number to the format used by WhatsApp (91XXXXXXXXXX).
 * Handles formats: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX
 * @param {string} phone - Raw phone number
 * @returns {string|null} Normalized phone number or null if invalid
 */
function normalizePhone(phone) {
  if (!phone) return null;

  // Remove all spaces, dashes, parentheses
  let cleaned = phone.toString().replace(/[\s\-\(\)\+]/g, "");

  // Remove leading zero
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }

  // Add country code if not present
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }

  // Validate: should be 12 digits starting with 91
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return cleaned;
  }

  return null;
}

/**
 * Load contacts from CSV file.
 * @param {Object} options
 * @param {string} [options.category] - Filter by business category
 * @param {boolean} [options.skipSent] - Skip already-sent contacts (default: true)
 * @returns {Promise<Array<{phone: string, businessName: string, category: string, city: string, template: number}>>}
 */
function loadContacts(options = {}) {
  const { category, skipSent = true } = options;

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CONTACTS_FILE)) {
      reject(
        new Error(
          `Contacts file not found: ${CONTACTS_FILE}\n` +
            `Please create it with columns: phone,business_name,category,city,template`
        )
      );
      return;
    }

    const contacts = [];
    const sentNumbers = skipSent ? loadSentNumbers() : new Set();

    fs.createReadStream(CONTACTS_FILE)
      .pipe(csv())
      .on("data", (row) => {
        const normalizedPhone = normalizePhone(row.phone);

        if (!normalizedPhone) {
          console.warn(
            `⚠️  Skipping invalid phone: ${row.phone} (${row.business_name || "unknown"})`
          );
          return;
        }

        // Skip already sent
        if (skipSent && sentNumbers.has(normalizedPhone)) {
          return;
        }

        // Filter by category if specified
        if (
          category &&
          row.category &&
          row.category.toLowerCase() !== category.toLowerCase()
        ) {
          return;
        }

        contacts.push({
          phone: normalizedPhone,
          businessName: row.business_name || row.businessName || "Business",
          category: row.category || "general",
          city: row.city || "Patna",
          template: parseInt(row.template, 10) || 1,
        });
      })
      .on("end", () => resolve(contacts))
      .on("error", reject);
  });
}

module.exports = { loadContacts, markAsSent, normalizePhone, loadSentNumbers };
