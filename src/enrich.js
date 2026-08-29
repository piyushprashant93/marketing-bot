/**
 * SutraWeave - Business Contact Enricher
 *
 * Visits each business website found by the scraper and extracts:
 * - Email addresses
 * - Instagram handles
 * - Facebook pages
 * - Twitter/X handles
 * - YouTube channels
 *
 * Updates data/contacts.csv with the enriched information.
 *
 * Usage:
 *   node src/enrich.js            → Enrich all contacts with websites
 *   node src/enrich.js --dry-run  → Preview without saving
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const chalk = require("chalk");
const csv = require("csv-parser");
const puppeteer = require("puppeteer");

const CONTACTS_FILE = path.join(__dirname, "..", "data", "contacts.csv");
const ENRICHED_FILE = path.join(__dirname, "..", "data", "contacts_enriched.csv");
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch a URL and return the HTML body. Follows redirects (up to 5).
 */
function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      resolve(""); // Too many redirects
      return;
    }

    const client = url.startsWith("https") ? https : http;
    const timeout = 8000; // 8 second timeout

    const req = client.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout,
      },
      (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith("/")) {
            const urlObj = new URL(url);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          resolve(fetchPage(redirectUrl, redirectCount + 1));
          return;
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
          // Limit to 500KB to avoid huge pages
          if (data.length > 500000) {
            res.destroy();
            resolve(data);
          }
        });
        res.on("end", () => resolve(data));
        res.on("error", () => resolve(""));
      }
    );

    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Extraction Functions ────────────────────────────────────────────

/**
 * Extract email addresses from HTML content.
 */
function extractEmails(html) {
  if (!html) return [];

  const emails = new Set();

  // Match mailto: links
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let match;
  while ((match = mailtoRegex.exec(html)) !== null) {
    emails.add(match[1].toLowerCase());
  }

  // Match plain email patterns in text
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  while ((match = emailRegex.exec(html)) !== null) {
    const email = match[0].toLowerCase();
    // Filter out common false positives
    if (
      !email.endsWith(".png") &&
      !email.endsWith(".jpg") &&
      !email.endsWith(".gif") &&
      !email.endsWith(".svg") &&
      !email.endsWith(".css") &&
      !email.endsWith(".js") &&
      !email.includes("example.com") &&
      !email.includes("sentry.io") &&
      !email.includes("schema.org") &&
      !email.includes("w3.org") &&
      !email.includes("googleapis.com") &&
      !email.includes("cloudflare") &&
      !email.includes("webpack") &&
      !email.startsWith("data:") &&
      email.length < 60
    ) {
      emails.add(email);
    }
  }

  return Array.from(emails);
}

/**
 * Extract Instagram handle from HTML.
 */
function extractInstagram(html) {
  if (!html) return "";

  // Match instagram.com/username links
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?/gi,
  ];

  const handles = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const handle = match[1].toLowerCase();
      // Filter out generic Instagram pages
      if (
        !["p", "explore", "reel", "reels", "stories", "accounts", "direct", "tv", ""].includes(handle)
      ) {
        handles.add(`@${handle}`);
      }
    }
  }

  return Array.from(handles).join(", ");
}

/**
 * Extract Facebook page from HTML.
 */
function extractFacebook(html) {
  if (!html) return "";

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/([a-zA-Z0-9._\-]{1,50})\/?/gi,
    /(?:https?:\/\/)?(?:www\.)?fb\.com\/([a-zA-Z0-9._\-]{1,50})\/?/gi,
  ];

  const pages = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const page = match[1];
      if (
        !["sharer", "share", "dialog", "login", "groups", "events", "pages", "hashtag", "plugins", "tr", ""].includes(
          page.toLowerCase()
        )
      ) {
        pages.add(page);
      }
    }
  }

  const result = Array.from(pages);
  return result.length > 0 ? `fb.com/${result[0]}` : "";
}

/**
 * Extract Twitter/X handle from HTML.
 */
function extractTwitter(html) {
  if (!html) return "";

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?twitter\.com\/([a-zA-Z0-9_]{1,15})\/?/gi,
    /(?:https?:\/\/)?(?:www\.)?x\.com\/([a-zA-Z0-9_]{1,15})\/?/gi,
  ];

  const handles = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const handle = match[1].toLowerCase();
      if (
        !["intent", "share", "home", "search", "login", "i", ""].includes(handle)
      ) {
        handles.add(`@${handle}`);
      }
    }
  }

  return Array.from(handles).join(", ");
}

/**
 * Extract YouTube channel from HTML.
 */
function extractYouTube(html) {
  if (!html) return "";

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:channel|c|user|@)\/([a-zA-Z0-9_\-]{1,50})\/?/gi,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/@([a-zA-Z0-9_\-]{1,50})\/?/gi,
  ];

  const channels = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      channels.add(match[1]);
    }
  }

  const result = Array.from(channels);
  return result.length > 0 ? result[0] : "";
}

// ─── CSV Functions ───────────────────────────────────────────────────

function loadCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function escapeCSV(value) {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Google Search Fallback ──────────────────────────────────────────

async function searchGoogleForInstagram(businessName, city, page) {
  const query = encodeURIComponent(`${businessName} ${city} site:instagram.com`);
  const url = `https://www.google.com/search?q=${query}`;
  
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 10000 });
    
    const handle = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        if (link.href && link.href.includes('instagram.com/')) {
          const match = link.href.match(/instagram\.com\/([a-zA-Z0-9_.]{1,30})/i);
          if (match) {
            const h = match[1].toLowerCase();
            if (!["p", "explore", "reel", "reels", "stories", "accounts"].includes(h)) {
              return `@${h}`;
            }
          }
        }
      }
      return null;
    });
    return handle;
  } catch (err) {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(
    chalk.bold.magenta(
      "╔══════════════════════════════════════════════════════╗"
    )
  );
  console.log(
    chalk.bold.magenta(
      "║     🔗 SutraWeave - Contact Enricher                ║"
    )
  );
  console.log(
    chalk.bold.magenta(
      "╚══════════════════════════════════════════════════════╝"
    )
  );
  console.log();

  if (DRY_RUN) {
    console.log(chalk.yellow.bold("  ⚠️  DRY RUN — Will fetch but not save\n"));
  }

  // Load contacts
  console.log(chalk.cyan("📂 Loading contacts...\n"));
  const contacts = await loadCSV(CONTACTS_FILE);

  const withWebsite = contacts.filter((c) => c.website && c.website.trim());
  console.log(
    chalk.white(
      `  📋 Total contacts: ${chalk.bold(contacts.length)}\n` +
        `  🌐 With website:   ${chalk.bold(withWebsite.length)} (will be enriched)\n` +
        `  —  No website:     ${chalk.gray(contacts.length - withWebsite.length)} (skipped)\n`
    )
  );

  // Enrich each contact that has a website
  console.log(chalk.cyan.bold("━━━ Enriching contacts ━━━\n"));

  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
  } catch (err) {
    console.log(chalk.yellow("⚠️ Failed to launch browser for Google Search fallback."));
  }

  let enrichedCount = 0;
  let emailsFound = 0;
  let instagramFound = 0;
  let facebookFound = 0;
  let twitterFound = 0;
  let errors = 0;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Skip contacts without websites, but try Google search for Instagram
    if (!contact.website || !contact.website.trim()) {
      contact.email = "";
      contact.facebook = "";
      contact.twitter = "";
      contact.youtube = "";
      
      const progress = chalk.gray(`[${i + 1}/${contacts.length}]`);
      const name = (contact.business_name || "").substring(0, 35).padEnd(35);
      process.stdout.write(`${progress} 🔍 ${name} ...`);

      if (page) {
        const handle = await searchGoogleForInstagram(contact.business_name, contact.city || "Patna", page);
        if (handle) {
          contact.instagram = handle;
          instagramFound++;
          enrichedCount++;
          console.log(` ${chalk.magenta("📸")} ${handle} ${chalk.gray("(via Google)")}`);
        } else {
          contact.instagram = "";
          console.log(chalk.gray(" no social found"));
        }
      } else {
        contact.instagram = "";
        console.log(chalk.gray(" skipped"));
      }
      continue;
    }

    const progress = chalk.gray(`[${i + 1}/${contacts.length}]`);
    const name = (contact.business_name || "").substring(0, 35).padEnd(35);

    process.stdout.write(`${progress} 🌐 ${name} ...`);

    try {
      const html = await fetchPage(contact.website);

      if (html && html.length > 100) {
        // Extract all social info
        const emails = extractEmails(html);
        const instagram = extractInstagram(html);
        const facebook = extractFacebook(html);
        const twitter = extractTwitter(html);
        const youtube = extractYouTube(html);

        contact.email = emails.join(", ");
        contact.instagram = instagram || contact.instagram || "";
        contact.facebook = facebook;
        contact.twitter = twitter;
        contact.youtube = youtube;

        // Track stats
        if (emails.length > 0) emailsFound++;
        if (instagram) instagramFound++;
        if (facebook) facebookFound++;
        if (twitter) twitterFound++;

        const icons = [];
        if (emails.length > 0) icons.push(chalk.green("📧"));
        if (instagram) icons.push(chalk.magenta("📸"));
        if (facebook) icons.push(chalk.blue("👤"));
        if (twitter) icons.push(chalk.cyan("🐦"));

        if (icons.length > 0) {
          console.log(` ${icons.join(" ")} ${emails[0] || instagram || facebook || ""}`);
          enrichedCount++;
        } else {
          console.log(chalk.gray(" no social found"));
        }
      } else {
        console.log(chalk.gray(" empty/unreachable"));
        contact.email = "";
        contact.facebook = "";
        contact.twitter = "";
        contact.youtube = "";
        if (!contact.instagram) contact.instagram = "";
      }
    } catch (err) {
      console.log(chalk.red(` error: ${err.message}`));
      contact.email = "";
      contact.facebook = "";
      contact.twitter = "";
      contact.youtube = "";
      if (!contact.instagram) contact.instagram = "";
      errors++;
    }

    // Rate limit — be respectful to websites
    if (i % 5 === 4) {
      await sleep(500);
    } else {
      await sleep(200);
    }
  }

  if (browser) await browser.close();

  // ─── Save Results ───
  console.log(chalk.cyan.bold("\n━━━ Saving enriched data ━━━\n"));

  if (DRY_RUN) {
    console.log(chalk.yellow("  DRY RUN: Would have saved enriched data.\n"));
  } else {
    const header =
      "phone,business_name,category,city,template,website,email,instagram,facebook,twitter,youtube,rating,address,google_maps_url";

    const rows = contacts.map((c) => {
      return [
        escapeCSV(c.phone),
        escapeCSV(c.business_name),
        escapeCSV(c.category),
        escapeCSV(c.city),
        escapeCSV(c.template),
        escapeCSV(c.website),
        escapeCSV(c.email),
        escapeCSV(c.instagram),
        escapeCSV(c.facebook),
        escapeCSV(c.twitter),
        escapeCSV(c.youtube),
        escapeCSV(c.rating),
        escapeCSV(c.address),
        escapeCSV(c.google_maps_url),
      ].join(",");
    });

    const csvContent = [header, ...rows].join("\n") + "\n";

    // Save enriched version
    fs.writeFileSync(ENRICHED_FILE, csvContent);
    console.log(
      chalk.green.bold(`  ✅ Enriched data saved: data/contacts_enriched.csv`)
    );

    // Also update the original
    fs.writeFileSync(CONTACTS_FILE, csvContent);
    console.log(
      chalk.green(`  ✅ Original updated:    data/contacts.csv`)
    );
  }

  // ─── Summary ───
  console.log(chalk.magenta("\n═══════════════════════════════════════"));
  console.log(chalk.magenta.bold("  📊 Enrichment Summary"));
  console.log(chalk.magenta("═══════════════════════════════════════"));
  console.log(chalk.white(`  🏢 Total contacts:     ${contacts.length}`));
  console.log(chalk.white(`  🌐 Websites visited:   ${withWebsite.length}`));
  console.log(chalk.green(`  🔗 Enriched:           ${enrichedCount}`));
  console.log(chalk.green(`  📧 With email:         ${emailsFound}`));
  console.log(chalk.magenta(`  📸 With Instagram:     ${instagramFound}`));
  console.log(chalk.blue(`  👤 With Facebook:      ${facebookFound}`));
  console.log(chalk.cyan(`  🐦 With Twitter/X:     ${twitterFound}`));
  if (errors > 0) console.log(chalk.red(`  ❌ Errors:             ${errors}`));
  console.log(chalk.magenta("═══════════════════════════════════════\n"));
}

main().catch((err) => {
  console.error(chalk.red(`\n💥 Fatal error: ${err.message}`));
  console.error(err);
  process.exit(1);
});
