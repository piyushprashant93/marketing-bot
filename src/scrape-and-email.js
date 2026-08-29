/**
 * SutraWeave - Scrape & Send Email Campaign
 *
 * All-in-one script that:
 *   1. Reads contacts from CSV
 *   2. Visits each business website → extracts email
 *   3. Immediately sends a marketing email via Mailtrap SMTP
 *   4. Tracks sent emails to avoid duplicates
 *
 * Usage:
 *   node src/scrape-and-email.js            → Scrape + Send
 *   node src/scrape-and-email.js --dry-run  → Preview only
 *   node src/scrape-and-email.js --test     → Test email to yourself
 */

require("dotenv").config();

const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const csv = require("csv-parser");
const chalk = require("chalk");

// ─── Config ──────────────────────────────────────────────────────────
const MAIL_HOST = process.env.MAIL_HOST || "live.smtp.mailtrap.io";
const MAIL_PORT = parseInt(process.env.MAIL_PORT, 10) || 587;
const MAIL_USER = process.env.MAIL_USERNAME || "api";
const MAIL_PASS = process.env.MAIL_PASSWORD;
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "marketing@sutracode.in";
const FROM_NAME = process.env.MAIL_FROM_NAME || "Piyush from SutraWeave";
const EMAIL_DELAY = (parseInt(process.env.EMAIL_DELAY_SECONDS, 10) || 5) * 1000;
const MAX_EMAILS = parseInt(process.env.EMAIL_MAX_PER_RUN, 10) || 50;

const CONTACTS_FILE = path.join(__dirname, "..", "data", "contacts.csv");
const EMAIL_SENT_FILE = path.join(__dirname, "..", "data", "emails_sent.json");

const DRY_RUN = process.argv.includes("--dry-run");
const TEST_MODE = process.argv.includes("--test");

// ─── HTTP Fetch ──────────────────────────────────────────────────────

function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) { resolve(""); return; }
    const client = url.startsWith("https") ? https : http;

    const req = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      timeout: 8000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        let rUrl = res.headers.location;
        if (rUrl.startsWith("/")) {
          const u = new URL(url);
          rUrl = `${u.protocol}//${u.host}${rUrl}`;
        }
        resolve(fetchPage(rUrl, redirectCount + 1));
        return;
      }
      let data = "";
      res.on("data", (c) => { data += c; if (data.length > 500000) { res.destroy(); resolve(data); } });
      res.on("end", () => resolve(data));
      res.on("error", () => resolve(""));
    });
    req.on("error", () => resolve(""));
    req.on("timeout", () => { req.destroy(); resolve(""); });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Email Extraction ────────────────────────────────────────────────

function extractEmails(html) {
  if (!html) return [];
  const emails = new Set();

  // mailto: links
  const mailto = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = mailto.exec(html)) !== null) emails.add(m[1].toLowerCase());

  // Plain email patterns
  const plain = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  while ((m = plain.exec(html)) !== null) {
    const e = m[0].toLowerCase();
    if (
      !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".gif") &&
      !e.endsWith(".svg") && !e.endsWith(".css") && !e.endsWith(".js") &&
      !e.includes("example.com") && !e.includes("sentry.io") &&
      !e.includes("schema.org") && !e.includes("w3.org") &&
      !e.includes("googleapis.com") && !e.includes("cloudflare") &&
      !e.includes("webpack") && !e.includes("godaddy.com") &&
      !e.startsWith("data:") && e.length < 60
    ) {
      emails.add(e);
    }
  }
  return Array.from(emails);
}

function extractInstagram(html) {
  if (!html) return "";
  const re = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?/gi;
  const handles = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const h = m[1].toLowerCase();
    if (!["p", "explore", "reel", "reels", "stories", "accounts", "direct", "tv", "rsrc.php"].includes(h)) {
      handles.add(`@${h}`);
    }
  }
  return Array.from(handles).join(", ");
}

// ─── Email Sent Tracking ─────────────────────────────────────────────

let sentCache = null;

function loadSentEmails() {
  if (sentCache) return sentCache;
  try {
    if (fs.existsSync(EMAIL_SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(EMAIL_SENT_FILE, "utf-8"));
      sentCache = new Set((data.sent || []).map((e) => (typeof e === "string" ? e : e.email)));
      return sentCache;
    }
  } catch (err) { /* start fresh */ }
  sentCache = new Set();
  return sentCache;
}

function markEmailSent(email, details = {}) {
  let records = [];
  try {
    if (fs.existsSync(EMAIL_SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(EMAIL_SENT_FILE, "utf-8"));
      records = data.sent || [];
    }
  } catch (err) { /* start fresh */ }

  records.push({
    email,
    businessName: details.businessName || "",
    category: details.category || "",
    sentAt: new Date().toISOString(),
  });

  if (!sentCache) sentCache = new Set();
  sentCache.add(email);

  const dir = path.dirname(EMAIL_SENT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(EMAIL_SENT_FILE, JSON.stringify({
    sent: records,
    totalSent: records.length,
    lastUpdated: new Date().toISOString(),
  }, null, 2));
}

// ─── CSV Loader ──────────────────────────────────────────────────────

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

// ─── Category-Specific Email Content ─────────────────────────────────

const categoryContent = {
  restaurant: {
    subject: "🍽️ Your restaurant could answer customers 24/7 — for free",
    headline: "Never Miss a Hungry Customer Again",
    pain: "Are you losing orders because customers can't reach you after hours?",
    bullets: ["Auto-share your menu, specials & timings", "Take table reservations 24/7 via AI bot", "Handle delivery queries automatically"],
    cta: "Imagine a customer messages at 11 PM asking about tomorrow's lunch — your AI bot replies instantly!",
  },
  clinic: {
    subject: "🏥 Automate patient bookings — free AI bot for your clinic",
    headline: "Let Your AI Assistant Handle Patient Queries",
    pain: "Tired of answering the same appointment & timing calls all day?",
    bullets: ["Book patient appointments automatically", "Share doctor schedules & specializations", "Answer treatment & fee FAQs 24/7"],
    cta: "Patients can book appointments at midnight — no missed calls, no waiting!",
  },
  hospital: {
    subject: "🏥 Reduce front-desk load with a free AI assistant",
    headline: "AI-Powered Patient Experience",
    pain: "Your front desk is overwhelmed with routine queries?",
    bullets: ["Share department info & doctor schedules instantly", "Handle appointment queries automatically", "Provide emergency contact info 24/7"],
    cta: "Let your AI bot handle routine queries while your staff focuses on patient care!",
  },
  salon: {
    subject: "💇 Book salon appointments 24/7 — free AI bot",
    headline: "Never Miss a Client Booking Again",
    pain: "Missing appointment requests that come in after closing hours?",
    bullets: ["Show services & pricing instantly", "Book appointments without back-and-forth", "Share your latest portfolio automatically"],
    cta: "Clients can book at 2 AM — your AI bot handles it while you sleep!",
  },
  gym: {
    subject: "💪 Turn midnight inquiries into memberships — free AI bot",
    headline: "Convert Every Inquiry Into a Membership",
    pain: "Losing potential members who enquire after hours?",
    bullets: ["Share membership plans & pricing automatically", "Answer timing & batch schedule queries", "Capture new member leads 24/7"],
    cta: "Every late-night inquiry becomes a potential member — your AI bot never sleeps!",
  },
  education: {
    subject: "📚 Automate admission queries — free AI bot for coaching",
    headline: "Answer Student Queries While You Focus on Teaching",
    pain: "Spending hours answering the same admission & fee queries?",
    bullets: ["Share course details & fee structures instantly", "Handle admission enquiries automatically", "Provide batch timings & demo schedules"],
    cta: "Parents comparing coaching centers at 10 PM? Your bot answers instantly!",
  },
  hotel: {
    subject: "🏨 More bookings with a free AI assistant for your hotel",
    headline: "Convert Late-Night Travelers Into Guests",
    pain: "Travelers checking availability at midnight get no response?",
    bullets: ["Share room types & availability instantly", "Provide tariff details automatically", "Answer amenity & check-in queries 24/7"],
    cta: "Midnight travelers get instant replies — more bookings, less effort!",
  },
  real_estate: {
    subject: "🏠 Qualify property leads automatically — free AI bot",
    headline: "Wake Up to Qualified Leads Every Morning",
    pain: "Missing hot leads because you couldn't respond fast enough?",
    bullets: ["Share property listings with photos & pricing", "Schedule site visits automatically", "Qualify leads before you pick up the phone"],
    cta: "A 9 PM buyer gets instant listings, books a site visit — you wake up to a hot lead!",
  },
  retail: {
    subject: "🛍️ Answer product queries 24/7 — free AI bot for your store",
    headline: "Your Store, Open 24/7 on WhatsApp",
    pain: "Customers asking about products when your store is closed?",
    bullets: ["Share product catalog & pricing instantly", "Answer store timing & location queries", "Handle order status automatically"],
    cta: "Night-time shoppers see your latest products and deals via your AI bot!",
  },
  pharmacy: {
    subject: "💊 Check medicine availability 24/7 — free AI bot",
    headline: "Serve Patients Even After Store Hours",
    pain: "Customers calling at odd hours to check if a medicine is available?",
    bullets: ["Confirm medicine availability instantly", "Share store timings & delivery options", "Handle prescription queries automatically"],
    cta: "Someone needs medicine urgently at night — your bot confirms availability before they step out!",
  },
  automobile: {
    subject: "🚗 Convert car inquiries automatically — free AI bot",
    headline: "Turn Every Inquiry Into a Test Drive",
    pain: "Buyers researching cars at midnight get no response from you?",
    bullets: ["Share vehicle models, features & pricing", "Book test drives & service appointments", "Handle loan/EMI queries automatically"],
    cta: "Midnight car buyer gets instant comparisons — you get a qualified lead by morning!",
  },
  events: {
    subject: "🎉 Capture wedding leads 24/7 — free AI bot for events",
    headline: "Never Miss a Wedding Lead Again",
    pain: "Couples planning at night move to competitors because you didn't respond?",
    bullets: ["Share portfolio & packages instantly", "Check date availability automatically", "Provide customized quotations 24/7"],
    cta: "Couples planning at night get instant package info — before they check your competitor!",
  },
  services: {
    subject: "📷 Book more clients with a free AI assistant",
    headline: "More Bookings, Less Phone Calls",
    pain: "Clients checking your services can't reach you after hours?",
    bullets: ["Share service packages & pricing instantly", "Book appointments automatically", "Showcase your portfolio 24/7"],
    cta: "Late-night clients get instant answers — more bookings while you sleep!",
  },
  travel: {
    subject: "✈️ Convert travel inquiries 24/7 — free AI bot",
    headline: "Turn Every Inquiry Into a Booking",
    pain: "Travelers planning trips at night can't get package info?",
    bullets: ["Share tour packages & itineraries instantly", "Provide pricing & customization options", "Handle booking queries 24/7"],
    cta: "Midnight trip planners get instant package info — your bot converts them into bookings!",
  },
};

const defaultContent = {
  subject: "🚀 Automate customer queries for free — AI bot for your business",
  headline: "Your Business, Available 24/7",
  pain: "Missing customer messages when you're busy or after hours?",
  bullets: ["Auto-reply to customer queries 24/7", "Share your service details instantly", "Never miss a potential customer again"],
  cta: "Every missed message is a missed customer. Your AI bot ensures you never miss one!",
};

// ─── HTML Email Template ─────────────────────────────────────────────

function buildEmailHTML(businessName, category) {
  const content = categoryContent[category] || defaultContent;
  const bulletsHTML = content.bullets
    .map((b) => `<tr><td style="padding:4px 0;color:#334155;font-size:15px;">✅ ${b}</td></tr>`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">SutraWeave</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">No-Code AI Bot Builder</p>
        </td></tr>
        <tr><td style="padding:40px;">
          <!-- Hero Image -->
          <img src="cid:marketing_banner" alt="SutraWeave Marketing Banner" style="width: 100%; height: auto; border-radius: 8px; margin-bottom: 24px;" />
          
          <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Dear <strong>${businessName}</strong>,</p>
          <h2 style="margin:16px 0;color:#0f172a;font-size:22px;font-weight:700;line-height:1.3;">${content.headline}</h2>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">${content.pain}</p>
          <p style="margin:0 0 12px;color:#0f172a;font-size:15px;font-weight:600;">With SutraWeave, you can:</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${bulletsHTML}</table>
          <div style="background:#f0f9ff;border-left:4px solid #3b82f6;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 32px;">
            <p style="margin:0;color:#1e40af;font-size:14px;line-height:1.5;font-style:italic;">💡 ${content.cta}</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;"><tr>
            <td width="33%" style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;">
              <div style="font-size:24px;font-weight:700;color:#3b82f6;">180+</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">Businesses</div>
            </td><td width="8"></td>
            <td width="33%" style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;">
              <div style="font-size:24px;font-weight:700;color:#3b82f6;">3 min</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">Setup Time</div>
            </td><td width="8"></td>
            <td width="33%" style="text-align:center;padding:16px;background:#f8fafc;border-radius:8px;">
              <div style="font-size:24px;font-weight:700;color:#3b82f6;">Free</div>
              <div style="font-size:12px;color:#64748b;margin-top:4px;">To Start</div>
            </td>
          </tr></table>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
            <a href="https://sutraweave.sutracode.in/?ref=email&biz=${encodeURIComponent(businessName)}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:50px;font-size:16px;font-weight:600;">
              Start Building for Free →
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;text-align:center;">No credit card required • Setup in 3 minutes • Cancel anytime</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 8px;color:#64748b;font-size:13px;">Best regards,<br><strong>Piyush Prashant</strong><br>Founder, SutraCode</p>
          <p style="margin:12px 0 0;color:#94a3b8;font-size:11px;">
            <a href="https://sutracode.in" style="color:#3b82f6;text-decoration:none;">sutracode.in</a> •
            <a href="https://sutraweave.sutracode.in" style="color:#3b82f6;text-decoration:none;">sutraweave.sutracode.in</a>
          </p>
          <p style="margin:12px 0 0;color:#cbd5e1;font-size:10px;">
            You received this because your business is listed on Google Maps in Patna. Reply "unsubscribe" to opt out.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(chalk.bold.blue("╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.bold.blue("║   📧 SutraWeave - Scrape & Email (All-in-One)       ║"));
  console.log(chalk.bold.blue("╚══════════════════════════════════════════════════════╝"));
  console.log();

  if (DRY_RUN) console.log(chalk.yellow.bold("  ⚠️  DRY RUN — No emails will be sent\n"));

  // Validate SMTP config
  if (!DRY_RUN && (!MAIL_PASS || MAIL_PASS.includes("YOUR_"))) {
    console.error(chalk.red.bold("❌ Missing Mailtrap API token!\n"));
    console.log(chalk.yellow("  1. Go to https://mailtrap.io/sending/domains"));
    console.log(chalk.yellow("  2. Copy your API token"));
    console.log(chalk.yellow("  3. Set MAIL_PASSWORD in .env\n"));
    process.exit(1);
  }

  // Create SMTP transporter
  let transporter = null;
  if (!DRY_RUN) {
    transporter = nodemailer.createTransport({
      host: MAIL_HOST,
      port: MAIL_PORT,
      secure: false,
      auth: { user: MAIL_USER, pass: MAIL_PASS },
    });

    try {
      await transporter.verify();
      console.log(chalk.green("✅ SMTP connection verified!\n"));
    } catch (err) {
      console.error(chalk.red(`❌ SMTP connection failed: ${err.message}`));
      console.log(chalk.yellow("  Check MAIL_PASSWORD in .env\n"));
      process.exit(1);
    }
  }

  // Test mode
  if (TEST_MODE) {
    const testEmail = process.argv.find((a) => a.includes("@")) || FROM_EMAIL;
    console.log(chalk.magenta(`  🧪 Sending test email to: ${testEmail}\n`));
    const html = buildEmailHTML("My Test Business", "restaurant");
    const content = categoryContent.restaurant;
    if (!DRY_RUN) {
      await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to: testEmail,
        subject: content.subject, html,
        attachments: [{
          filename: 'marketing_banner.jpg',
          path: path.join(__dirname, "..", "data", "marketing_banner.jpg"),
          cid: 'marketing_banner'
        }]
      });
      console.log(chalk.green.bold("  ✅ Test email sent!"));
    } else {
      console.log(chalk.yellow(`  DRY-RUN: Would send "${content.subject}"`));
    }
    console.log(chalk.gray("  Check: https://mailtrap.io/sending/email_logs\n"));
    return;
  }

  // Load contacts
  console.log(chalk.cyan("━━━ Phase 1: Loading contacts ━━━\n"));
  const csvFile = CONTACTS_FILE;
  const allContacts = await loadCSV(csvFile);

  // Filter: only those with a website (so we can scrape for email)
  const withWebsite = allContacts.filter((c) => c.website && c.website.trim());
  const sentEmails = loadSentEmails();

  console.log(chalk.white(`  📋 Total contacts:   ${allContacts.length}`));
  console.log(chalk.white(`  🌐 With website:     ${withWebsite.length}`));
  console.log(chalk.gray(`  📧 Already emailed:  ${sentEmails.size}\n`));

  // Process: scrape website → find email → send email (all in one loop)
  console.log(chalk.cyan.bold("━━━ Phase 2: Scrape & Send ━━━\n"));

  let scraped = 0;
  let emailsFound = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  let skippedAlreadySent = 0;
  let noEmailFound = 0;

  const toProcess = withWebsite.slice(0, MAX_EMAILS * 3); // Process more since not all have emails

  for (let i = 0; i < toProcess.length; i++) {
    // Stop if we've sent enough
    if (emailsSent >= MAX_EMAILS) {
      console.log(chalk.yellow(`\n  ⚠️  Reached max emails per run (${MAX_EMAILS}). Stopping.\n`));
      break;
    }

    const contact = toProcess[i];
    const businessName = contact.business_name || "Business";
    const category = contact.category || "general";
    const progress = chalk.gray(`[${i + 1}/${toProcess.length}]`);
    const nameDisplay = businessName.substring(0, 35).padEnd(35);

    process.stdout.write(`${progress} 🌐 ${nameDisplay}`);

    // Check if we already have an email in the CSV
    let emails = [];
    if (contact.email && contact.email.trim()) {
      emails = contact.email.split(",").map((e) => e.trim()).filter(Boolean);
      process.stdout.write(` → found in CSV: ${chalk.green(emails[0])}\n`);
    }

    // If no email in CSV, scrape the website for one
    if (emails.length === 0) {
      process.stdout.write(` → scraping...`);
      scraped++;

      try {
        const html = await fetchPage(contact.website);
        if (html && html.length > 100) {
          emails = extractEmails(html);
          const instagram = extractInstagram(html);

          if (emails.length > 0) {
            // Update CSV data for future runs
            contact.email = emails.join(", ");
            if (instagram) contact.instagram = instagram;
          }
        }
      } catch (err) {
        // Scrape failed, continue
      }

      if (emails.length === 0) {
        console.log(chalk.gray(" no email found"));
        noEmailFound++;
        await sleep(200);
        continue;
      } else {
        process.stdout.clearLine && process.stdout.clearLine(0);
        process.stdout.cursorTo && process.stdout.cursorTo(0);
        console.log(`${progress} 🌐 ${nameDisplay} → found via scrape: ${chalk.green(emails[0])}`);
      }
    }

    // Use the first valid email
    const email = emails[0];
    emailsFound++;

    // Skip if already sent
    if (sentEmails.has(email)) {
      console.log(chalk.gray(` (already sent)`));
      skippedAlreadySent++;
      continue;
    }

    // Send the email!
    const content = categoryContent[category] || defaultContent;
    const subject = `${content.subject} | ${businessName}`;

    if (DRY_RUN) {
      console.log(chalk.yellow(` → DRY-RUN: would email ${email}`));
      continue;
    }

    try {
      const html = buildEmailHTML(businessName, category);

      await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: email,
        subject,
        html,
        headers: {
          "X-Campaign": "sutraweave-patna-outreach",
          "X-Category": category,
          "List-Unsubscribe": `<mailto:${FROM_EMAIL}?subject=unsubscribe>`,
        },
        attachments: [{
          filename: 'marketing_banner.jpg',
          path: path.join(__dirname, "..", "data", "marketing_banner.jpg"),
          cid: 'marketing_banner'
        }]
      });

      markEmailSent(email, { businessName, category });
      emailsSent++;
      console.log(chalk.green(` → ✅ sent!`));

      // Delay between emails
      await sleep(EMAIL_DELAY);
    } catch (err) {
      emailsFailed++;
      console.log(chalk.red(` → ❌ ${err.message}`));
    }
  }

  // ─── Summary ───
  console.log(chalk.blue("\n═══════════════════════════════════════"));
  console.log(chalk.blue.bold("  📊 Scrape & Email Summary"));
  console.log(chalk.blue("═══════════════════════════════════════"));
  console.log(chalk.white(`  🌐 Websites scraped:    ${scraped}`));
  console.log(chalk.white(`  📧 Emails found:        ${emailsFound}`));
  console.log(chalk.green(`  ✅ Emails sent:         ${emailsSent}`));
  console.log(chalk.gray(`  🚫 Already sent:        ${skippedAlreadySent}`));
  console.log(chalk.gray(`  📭 No email found:      ${noEmailFound}`));
  if (emailsFailed > 0) console.log(chalk.red(`  ❌ Failed:              ${emailsFailed}`));
  console.log(chalk.gray(`\n  📋 Sent log: https://mailtrap.io/sending/email_logs`));
  console.log(chalk.blue("═══════════════════════════════════════\n"));
}

main().catch((err) => {
  console.error(chalk.red(`\n💥 Fatal error: ${err.message}`));
  console.error(err);
  process.exit(1);
});
