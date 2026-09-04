require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const chalk = require("chalk");
const { getMessage } = require("./messages");

const INSTA_USER = process.env.INSTAGRAM_USERNAME;
const INSTA_PASS = process.env.INSTAGRAM_PASSWORD;
const MAX_MESSAGES = parseInt(process.env.INSTA_MAX_MESSAGES, 10) || 20;
const DELAY_MIN = parseInt(process.env.INSTA_DELAY_MIN, 10) || 120;
const DELAY_MAX = parseInt(process.env.INSTA_DELAY_MAX, 10) || 300;
const FORCE_TEMPLATE = process.env.FORCE_TEMPLATE ? parseInt(process.env.FORCE_TEMPLATE, 10) : null;
const DEFAULT_TEMPLATE = parseInt(process.env.DEFAULT_TEMPLATE, 10) || 1;
const IMAGE_ATTACHMENT = process.env.IMAGE_ATTACHMENT || null;

const DRY_RUN = process.argv.includes("--dry-run");
const CONTACTS_FILE = path.join(__dirname, "..", "data", "contacts.csv");
const SENT_FILE = path.join(__dirname, "..", "data", "insta_sent.json");
const COOKIE_PATH = path.join(__dirname, "..", ".insta_cache", "cookies.json");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay(minSec, maxSec) {
  const ms = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
  return sleep(ms);
}

// Dismiss common Instagram popups/overlays that block the DM input
async function dismissPopups(page) {
  const dismissTexts = ['Not Now', 'Not now', 'Turn Off', 'Allow', 'Cancel', 'Close', 'Save Info', 'Dismiss'];
  try {
    await page.evaluate((texts) => {
      const buttons = [...document.querySelectorAll('button, div[role="button"]')];
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (texts.includes(text)) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
          }
        }
      }
      // Also dismiss any dialog/modal close buttons (X icons)
      const closeButtons = document.querySelectorAll('div[role="dialog"] button svg, div[role="dialog"] [aria-label="Close"]');
      // Don't auto-close dialogs — only dismiss known text-based popups
    }, texts);
    await sleep(500);
  } catch(e) {}
}

function loadSentList() {
  try {
    if (fs.existsSync(SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
      return new Set(data.sent.map(d => d.handle));
    }
  } catch (err) {}
  return new Set();
}

function markSent(handle, details) {
  let records = [];
  try {
    if (fs.existsSync(SENT_FILE)) {
      records = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8")).sent || [];
    }
  } catch (err) {}
  records.push({ handle, businessName: details.businessName, sentAt: new Date().toISOString() });
  const dir = path.dirname(SENT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SENT_FILE, JSON.stringify({ sent: records }, null, 2));
}

function loadContacts() {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(CONTACTS_FILE)
      .pipe(csv())
      .on("data", (r) => rows.push(r))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function login(page) {
  console.log(chalk.gray("⏳ Logging into Instagram..."));
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle2" });
  await sleep(3000);

  // Check if we are already logged in (if cookies were valid)
  // Sometimes URL has query params, so checking just the pathname is safer
  if (!page.url().includes("/accounts/login")) {
    console.log(chalk.green("✅ Already logged in using cached cookies."));
    return;
  }

  if (!INSTA_USER || !INSTA_PASS || INSTA_USER.includes("your_agency_account")) {
    console.error(chalk.red("❌ Missing Instagram credentials in .env"));
    process.exit(1);
  }

  try {
    // Explicitly wait for the input to appear
    await page.waitForSelector("input[name='username']", { timeout: 10000 });
    await page.type("input[name='username']", INSTA_USER, { delay: 50 });
    await page.type("input[name='password']", INSTA_PASS, { delay: 50 });
    await page.click("button[type='submit']");
    await sleep(5000); // Give it time to submit and navigate
  } catch (err) {
    console.log(chalk.yellow("\n⚠️ Could not auto-fill login (Instagram might be showing a pop-up or blocking bots)."));
    console.log(chalk.yellow("⚠️ Please log in MANUALLY in the open browser window. You have 60 seconds...\n"));
    
    let waited = 0;
    while (page.url().includes("/accounts/login") && waited < 60) {
      await sleep(1000);
      waited++;
    }
    
    if (page.url().includes("/accounts/login")) {
      console.error(chalk.red("❌ Manual login timed out."));
      process.exit(1);
    }
  }
  
  await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}); // Optional wait

  
  // Save cookies
  const cookies = await page.cookies();
  const dir = path.dirname(COOKIE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies));
  console.log(chalk.green("✅ Logged in successfully and saved cookies."));
}

async function main() {
  console.log(chalk.bold.magenta("╔══════════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("║     📸 Instagram DM Automation                      ║"));
  console.log(chalk.bold.magenta("╚══════════════════════════════════════════════════════╝\n"));

  if (DRY_RUN) console.log(chalk.yellow.bold("  ⚠️  DRY RUN — No DMs will be sent\n"));

  const allContacts = await loadContacts();
  const instaContacts = allContacts.filter(c => c.instagram && c.instagram.trim());
  const sentList = loadSentList();
  
  const toProcess = instaContacts.filter(c => {
    const handle = c.instagram.replace("@", "").trim();
    return !sentList.has(handle);
  }).slice(0, MAX_MESSAGES);

  console.log(chalk.white(`📋 Total contacts with Instagram: ${instaContacts.length}`));
  console.log(chalk.white(`📤 Queued to send: ${toProcess.length} (Max: ${MAX_MESSAGES})\n`));

  if (toProcess.length === 0) {
    console.log(chalk.yellow("No unsent contacts to process."));
    return;
  }

  let browser;
  let page;
  if (!DRY_RUN) {
    browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    // Use the first open page instead of creating a second blank tab
    page = (await browser.pages())[0];
    
    // Load cookies if they exist
    if (fs.existsSync(COOKIE_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
      await page.setCookie(...cookies);
    }
    await login(page);
  }

  for (let i = 0; i < toProcess.length; i++) {
    const contact = toProcess[i];
    const handle = contact.instagram.replace("@", "").trim();
    const biz = contact.business_name || "Business";
    const templateId = FORCE_TEMPLATE || contact.template || DEFAULT_TEMPLATE;
    const msg = getMessage(templateId, biz, contact.category);
    const progress = chalk.gray(`[${i + 1}/${toProcess.length}]`);

    if (DRY_RUN) {
      console.log(`${progress} 📸 ${chalk.white(biz)} (@${handle})`);
      console.log(chalk.gray(`Preview:\n${msg.substring(0, 100)}...\n`));
      if (IMAGE_ATTACHMENT) console.log(chalk.gray(`Attachment: ${IMAGE_ATTACHMENT}\n`));
      continue;
    }

    try {
      console.log(`${progress} 📤 Sending DM to @${handle} (${biz})...`);
      
      // Navigate directly to user profile
      await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "networkidle2" });
      await sleep(4000);

      // Dismiss any popups/overlays that Instagram might show
      await dismissPopups(page);
      
      // Click message button (exact match to avoid clicking the sidebar "Messages" header)
      const messageBtnHandle = await page.evaluateHandle(() => {
        const elements = [...document.querySelectorAll('div[role="button"], button, a, div')];
        // We go in reverse because the actual button is usually deeper in the DOM
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (el.textContent.trim() === 'Message') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return el;
          }
        }
        return null;
      });

      if (messageBtnHandle && messageBtnHandle.asElement()) {
        await messageBtnHandle.asElement().click();
      } else {
        throw new Error("Message button not found on profile.");
      }
      
      await sleep(6000); // Wait for chat window to fully open

      // Dismiss any popups again (Instagram often shows "Turn on Notifications" after opening DMs)
      await dismissPopups(page);

      // Type and send message with retry logic
      const inputSelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]', 
        'div[role="textbox"]', 
        'p[contenteditable="true"]',
        'textarea[placeholder]',
        'textarea'
      ];
      
      // Retry finding the input box up to 3 times with increasing waits
      let inputHandle = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        for (const sel of inputSelectors) {
          try {
            inputHandle = await page.waitForSelector(sel, { timeout: 5000, visible: true });
            if (inputHandle) break;
          } catch(e) {}
        }
        if (inputHandle) break;
        
        console.log(chalk.yellow(`   ⏳ Retry ${attempt}/3: input box not found yet, dismissing popups and waiting...`));
        await dismissPopups(page);
        
        // Try clicking on the chat area to focus it
        try {
          await page.evaluate(() => {
            const chatArea = document.querySelector('div[role="main"]') || 
                             document.querySelector('section main');
            if (chatArea) chatArea.click();
          });
        } catch(e) {}
        
        await sleep(3000);
      }

      if (!inputHandle) {
        throw new Error("Could not find message input box (account might restrict DMs).");
      }

      // Split the message into smaller parts and send each as a separate DM
      const parts = msg.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
      for (let p = 0; p < parts.length; p++) {
        // Re-find the input box for each message (DOM can change after sending)
        let msgInput = null;
        for (const sel of inputSelectors) {
          try {
            msgInput = await page.waitForSelector(sel, { timeout: 5000, visible: true });
            if (msgInput) break;
          } catch(e) {}
        }
        if (!msgInput) {
          throw new Error("Lost message input box while sending multi-part DM.");
        }

        await msgInput.click(); // Focus the input
        await sleep(300);
        await msgInput.type(parts[p], { delay: 10 });
        await sleep(500);
        await page.keyboard.press("Enter");
        await sleep(2000); // Pause between parts to look human
      }
      
      // Send image if specified
      if (IMAGE_ATTACHMENT && fs.existsSync(IMAGE_ATTACHMENT)) {
        console.log(chalk.gray(`   📎 Attaching image...`));
        try {
          const fileInputs = await page.$$('input[type="file"]');
          let attached = false;
          for (const fileInput of fileInputs) {
            const accept = await page.evaluate(el => el.getAttribute('accept') || '', fileInput);
            if (accept.includes('image')) {
              await fileInput.uploadFile(IMAGE_ATTACHMENT);
              await sleep(4000); // Wait for upload preview/send
              
              // In some Instagram updates, uploading auto-sends. In others, we need to click Send or press Enter.
              await page.keyboard.press("Enter");
              // Also try to find a send button if it didn't auto-send
              try {
                const sendBtn = await page.$('div[role="button"]:has-text("Send")');
                if (sendBtn) await sendBtn.click();
              } catch(e) {}
              
              await sleep(3000);
              attached = true;
              break;
            }
          }
          if (!attached) {
             console.log(chalk.yellow(`   ⚠️ Could not find image file input.`));
          }
        } catch (e) {
          console.log(chalk.red(`   ⚠️ Failed to attach image: ${e.message}`));
        }
      }
      
      markSent(handle, { businessName: biz });
      console.log(chalk.green(`✅ Sent successfully!`));

      if (i < toProcess.length - 1) {
        const d = Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
        console.log(chalk.gray(`⏳ Waiting ${Math.floor(d/60)}m ${d%60}s before next...`));
        await randomDelay(DELAY_MIN, DELAY_MAX);
      }
    } catch (err) {
      console.log(chalk.red(`❌ Failed to send to @${handle}: ${err.message}`));
    }
  }

  if (!DRY_RUN) {
    console.log(chalk.cyan("\n👋 Finished campaign. Closing browser..."));
    await browser.close();
  }
}

main().catch(err => {
  console.error(chalk.red(`\n💥 Fatal error: ${err.message}`));
  process.exit(1);
});
