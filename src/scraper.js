/**
 * SutraWeave - Patna Business Scraper
 *
 * Uses Google Maps Places API (New) to find all businesses in Patna,
 * extract phone numbers, websites, and other details,
 * then saves them to data/contacts.csv for the WhatsApp marketing bot.
 *
 * Usage:
 *   node src/scraper.js                    → Scrape all business types
 *   node src/scraper.js --category=restaurant → Scrape specific category
 *   node src/scraper.js --dry-run          → Preview without saving
 *
 * Prerequisites:
 *   - Set GOOGLE_MAPS_API_KEY in .env
 *   - Enable "Places API" and "Places API (New)" in Google Cloud Console
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");
const chalk = require("chalk");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const CONTACTS_FILE = path.join(__dirname, "..", "data", "contacts.csv");
const RAW_DATA_FILE = path.join(__dirname, "..", "data", "businesses_raw.json");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Search Config ─────────────────────────────────────────────
const TOP_INDIA_CITIES = [
  "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Ahmedabad", 
  "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", 
  "Lucknow", "Kanpur", "Nagpur", "Indore", "Thane", 
  "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad", "Patna", "Vadodara"
];

const TOP_US_CITIES = [
  "New York, USA", "Los Angeles, USA", "Chicago, USA", "Houston, USA", 
  "Phoenix, USA", "Philadelphia, USA", "San Antonio, USA", "San Diego, USA", 
  "Dallas, USA", "Austin, USA", "San Jose, USA", "Fort Worth, USA", 
  "Jacksonville, USA", "Columbus, USA", "Charlotte, USA"
];

const TOP_GLOBAL_CITIES = [
  "London, UK", "Manchester, UK", "Birmingham, UK",
  "Toronto, Canada", "Vancouver, Canada", "Montreal, Canada",
  "Sydney, Australia", "Melbourne, Australia", "Brisbane, Australia",
  "Auckland, New Zealand"
].concat(TOP_US_CITIES);

// Business categories to search
const BUSINESS_CATEGORIES = [
  { query: "restaurant", category: "restaurant" },
  { query: "clinic", category: "clinic" },
  { query: "hospital", category: "hospital" },
  { query: "salon", category: "salon" },
  { query: "gym fitness", category: "gym" },
  { query: "coaching center", category: "education" },
  { query: "hotel", category: "hotel" },
  { query: "real estate agent", category: "real_estate" },
  { query: "retail shop", category: "retail" },
  { query: "dentist", category: "clinic" },
  { query: "pharmacy", category: "pharmacy" },
  { query: "car dealer", category: "automobile" },
  { query: "clothing store", category: "retail" },
  { query: "electronics store", category: "retail" },
  { query: "wedding planner", category: "events" },
  { query: "photography studio", category: "services" },
  { query: "travel agency", category: "travel" },
  { query: "pet shop", category: "retail" },
  { query: "bakery", category: "restaurant" },
  { query: "cafe", category: "restaurant" },
];

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Make an HTTPS GET request and return parsed JSON.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a clean Indian phone number from Google's formatted number.
 */
function cleanPhone(phone) {
  if (!phone) return "";
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, "");
  // Normalize to +91 format
  if (cleaned.startsWith("+91")) return cleaned;
  if (cleaned.startsWith("91") && cleaned.length === 12) return "+" + cleaned;
  if (cleaned.startsWith("0") && cleaned.length === 11) return "+91" + cleaned.substring(1);
  if (cleaned.length === 10) return "+91" + cleaned;
  return phone; // Return original if we can't normalize
}

/**
 * Try to extract Instagram handle from a website URL.
 */
function extractInstagram(html, website) {
  if (!html && !website) return "";
  let textToSearch = (html || "") + " " + (website || "");
  const match = textToSearch.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?/i);
  if (match && !["p", "explore", "reel", "reels", "stories", "accounts", "direct", "tv"].includes(match[1].toLowerCase())) {
    return `@${match[1]}`;
  }
  return "";
}

function extractSocialLinks(html) {
  if (!html) return { facebook: "", twitter: "", youtube: "", linkedin: "" };
  
  const extractMatch = (regex) => {
    const match = html.match(regex);
    return match ? match[1] : "";
  };

  return {
    facebook: extractMatch(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/([a-zA-Z0-9_.]{1,50})\/?/i) || "",
    twitter: extractMatch(/(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_.]{1,50})\/?/i) || "",
    youtube: extractMatch(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:c\/|channel\/|user\/|@)?([a-zA-Z0-9_.]{1,50})\/?/i) || "",
    linkedin: extractMatch(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_.]{1,50})\/?/i) || ""
  };
}

function extractEmails(html) {
  if (!html) return "";
  const emails = new Set();
  const mailto = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  let m;
  while ((m = mailto.exec(html)) !== null) emails.add(m[1].toLowerCase());

  const plain = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  while ((m = plain.exec(html)) !== null) {
    const e = m[0].toLowerCase();
    if (!e.endsWith(".png") && !e.endsWith(".jpg") && !e.includes("example.com") && !e.includes("w3.org") && e.length < 60) {
      emails.add(e);
    }
  }
  return Array.from(emails).join(", ");
}

/**
 * Fetch HTML of a website with timeout
 */
function fetchWebsite(url) {
  return new Promise((resolve) => {
    if (!url || !url.startsWith("http")) { resolve(""); return; }
    try {
      const client = url.startsWith("https") ? require("https") : require("http");
      const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          let rUrl = res.headers.location;
          if (rUrl.startsWith("/")) rUrl = new URL(url).origin + rUrl;
          resolve(fetchWebsite(rUrl));
          return;
        }
        let data = "";
        let isResolved = false;
        
        const finish = (result) => {
          if (!isResolved) {
            isResolved = true;
            resolve(result);
          }
        };

        res.on("data", (c) => { 
          data += c; 
          if (data.length > 500000) {
            res.destroy(); // Abort downloading huge files
            finish(data); 
          }
        });
        res.on("end", () => finish(data));
        res.on("error", () => finish(""));
        res.on("close", () => finish(data));
      });
      req.on("error", () => resolve(""));
      req.on("timeout", () => { req.destroy(); resolve(""); });
    } catch (e) {
      resolve("");
    }
  });
}

// ─── Google Maps API Functions ───────────────────────────────────────

/**
 * Search for businesses using Google Places Text Search API.
 * @param {string} query - Search query (e.g., "restaurant")
 * @param {string} location - Target location (e.g., "Mumbai, India")
 * @returns {Promise<Array>} Array of place results
 */
async function searchPlaces(query, location) {
  const encodedQuery = encodeURIComponent(`${query} in ${location}`);
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodedQuery}` +
    `&key=${API_KEY}`;

  const results = [];
  let response = await httpGet(url);

  if (response.status === "REQUEST_DENIED") {
    throw new Error(`API Error: ${response.error_message || "Request denied. Check your API key."}`);
  }

  if (response.results) {
    results.push(...response.results);
  }

  // Follow pagination (up to 3 pages = ~60 results per query)
  let pageToken = response.next_page_token;
  let pages = 1;

  while (pageToken && pages < 3) {
    // Google requires a short delay before using next_page_token
    await sleep(2000);

    const nextUrl =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?pagetoken=${pageToken}` +
      `&key=${API_KEY}`;

    response = await httpGet(nextUrl);

    if (response.results) {
      results.push(...response.results);
    }

    pageToken = response.next_page_token;
    pages++;
  }

  return results;
}

/**
 * Get detailed info for a place (phone, website, etc.).
 * @param {string} placeId - Google Place ID
 * @returns {Promise<Object>} Place details
 */
async function getPlaceDetails(placeId) {
  const fields = "name,formatted_phone_number,international_phone_number,website,url,formatted_address,types,business_status,rating,user_ratings_total";
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${placeId}` +
    `&fields=${fields}` +
    `&key=${API_KEY}`;

  const response = await httpGet(url);

  if (response.status !== "OK") {
    return null;
  }

  return response.result;
}

// ─── Main Scraper ────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(
    chalk.bold.cyan(
      "╔══════════════════════════════════════════════════════╗"
    )
  );
  console.log(
    chalk.bold.cyan(
      "║     🔍 SutraWeave - Patna Business Scraper          ║"
    )
  );
  console.log(
    chalk.bold.cyan(
      "╚══════════════════════════════════════════════════════╝"
    )
  );
  console.log();

  if (!API_KEY || API_KEY === "YOUR_API_KEY_HERE") {
    console.error(
      chalk.red.bold("❌ Missing Google Maps API Key!\n")
    );
    console.log(chalk.yellow("  1. Open .env file"));
    console.log(chalk.yellow("  2. Set GOOGLE_MAPS_API_KEY=your_actual_key"));
    console.log(chalk.yellow("  3. Make sure 'Places API' is enabled in Google Cloud Console\n"));
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(chalk.yellow.bold("  ⚠️  DRY RUN — Will search but not save\n"));
  }

  // Filter categories if --category flag is provided
  const categoryArg = process.argv.find((a) => a.startsWith("--category="));
  let categories = BUSINESS_CATEGORIES;
  if (categoryArg) {
    const filterCat = categoryArg.split("=")[1].toLowerCase();
    categories = BUSINESS_CATEGORIES.filter(
      (c) => c.category === filterCat || c.query.includes(filterCat)
    );
    if (categories.length === 0) {
      console.error(chalk.red(`No category found matching: ${filterCat}`));
      console.log(chalk.gray("Available: " + [...new Set(BUSINESS_CATEGORIES.map((c) => c.category))].join(", ")));
      process.exit(1);
    }
  }

  // Handle location selection
  const cityArg = process.argv.find((a) => a.startsWith("--city="));
  const isIndia = process.argv.includes("--india");
  const isUS = process.argv.includes("--us");
  const isGlobal = process.argv.includes("--global");
  
  let targetLocations = ["Patna, India"];
  if (isIndia) {
    targetLocations = TOP_INDIA_CITIES.map(c => `${c}, India`);
    console.log(chalk.magenta(`🇮🇳 PAN-INDIA MODE ENABLED: Will search ${targetLocations.length} cities!`));
  } else if (isUS) {
    targetLocations = TOP_US_CITIES;
    console.log(chalk.magenta(`🇺🇸 USA MODE ENABLED: Will search ${targetLocations.length} cities!`));
  } else if (isGlobal) {
    targetLocations = TOP_GLOBAL_CITIES;
    console.log(chalk.magenta(`🌍 GLOBAL MODE ENABLED: Will search ${targetLocations.length} international cities!`));
  } else if (cityArg) {
    targetLocations = [cityArg.split("=")[1]];
  }

  console.log(chalk.white(`📍 Target Cities: ${chalk.bold(targetLocations.length)} (${targetLocations.slice(0, 3).join(", ")}${targetLocations.length > 3 ? "..." : ""})`));
  console.log(chalk.white(`📂 Categories: ${chalk.bold(categories.length)}\n`));

  const allBusinesses = new Set(); // Use Set to dedup by place_id
  let totalApiCalls = 0;
  let savedCount = 0;

  console.log(chalk.cyan.bold("━━━ Searching & Scraping (Live Stream) ━━━\n"));

  const CSV_HEADER = "phone,business_name,category,city,template,website,email,instagram,facebook,twitter,linkedin,rating,address,google_maps_url\n";
  const dataDir = path.dirname(CONTACTS_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (!DRY_RUN && !fs.existsSync(CONTACTS_FILE)) {
    fs.writeFileSync(CONTACTS_FILE, CSV_HEADER);
  } else if (!DRY_RUN) {
    // Overwrite if restarting (since you asked to start fresh)
    fs.writeFileSync(CONTACTS_FILE, CSV_HEADER);
  }

  for (let c = 0; c < targetLocations.length; c++) {
    const location = targetLocations[c];
    if (targetLocations.length > 1) {
      console.log(chalk.magenta.bold(`\n🏙️  Location [${c+1}/${targetLocations.length}]: ${location}`));
    }

    for (let i = 0; i < categories.length; i++) {
      const { query, category } = categories[i];
      const progress = chalk.gray(`[${i + 1}/${categories.length}]`);

      console.log(`${progress} 🔍 Searching "${chalk.bold(query)}" in ${location}...`);

      try {
        const results = await searchPlaces(query, location);
        totalApiCalls++;

        for (const place of results) {
          if (!allBusinesses.has(place.place_id)) {
            allBusinesses.add(place.place_id);
            
            process.stdout.write(`    ↳ 📞 ${place.name.substring(0, 35).padEnd(35)}...`);

            // Fetch details & deep scrape immediately
            const details = await getPlaceDetails(place.place_id);
            totalApiCalls++;

            if (details) {
              const biz = {
                name: place.name,
                category: category,
                city: location,
                rating: place.rating || 0,
                address: details.formatted_address || place.formatted_address || "",
                phone: cleanPhone(details.international_phone_number || details.formatted_phone_number || ""),
                website: details.website || "",
                googleMapsUrl: details.url || "",
                email: "",
                instagram: "",
                facebook: "",
                twitter: "",
                linkedin: ""
              };

              let html = "";
              if (biz.website) {
                 html = await fetchWebsite(biz.website);
                 biz.email = extractEmails(html);
                 const socials = extractSocialLinks(html);
                 biz.facebook = socials.facebook ? `fb.com/${socials.facebook}` : "";
                 biz.twitter = socials.twitter ? `@${socials.twitter}` : "";
                 biz.linkedin = socials.linkedin ? `linkedin.com/company/${socials.linkedin}` : "";
                 biz.instagram = extractInstagram(html, biz.website);

                 // Fallback to root homepage if booking link lacked socials
                 if (!biz.instagram || !biz.email) {
                    try {
                      const rootUrl = new URL(biz.website).origin;
                      // Only fetch if root is different from the provided link
                      if (rootUrl !== biz.website && rootUrl + "/" !== biz.website) {
                        const rootHtml = await fetchWebsite(rootUrl);
                        if (!biz.email) biz.email = extractEmails(rootHtml);
                        if (!biz.instagram) biz.instagram = extractInstagram(rootHtml, rootUrl);
                        
                        const rootSocials = extractSocialLinks(rootHtml);
                        if (!biz.facebook && rootSocials.facebook) biz.facebook = `fb.com/${rootSocials.facebook}`;
                        if (!biz.twitter && rootSocials.twitter) biz.twitter = `@${rootSocials.twitter}`;
                        if (!biz.linkedin && rootSocials.linkedin) biz.linkedin = `linkedin.com/company/${rootSocials.linkedin}`;
                      }
                    } catch (e) {} // ignore url parsing errors
                 }
              }

              // Live append to CSV immediately
              if (!DRY_RUN && biz.phone && biz.phone.length >= 7) {
                fs.appendFileSync(CONTACTS_FILE, formatCsvRow(biz));
                savedCount++;
              }

              const phoneIcon = biz.phone ? chalk.green("📱") : chalk.gray("—");
              const webIcon = biz.website ? chalk.blue("🌐") : chalk.gray("—");
              const emailIcon = biz.email ? chalk.yellow("📧") : chalk.gray("—");
              const instaIcon = biz.instagram ? chalk.magenta("📸") : chalk.gray("—");

              console.log(` ${phoneIcon} ${webIcon} ${emailIcon} ${instaIcon} ${biz.phone || "no phone"}`);
            } else {
              console.log(chalk.gray(" no details"));
            }
            // Small delay to prevent rate limits
            await sleep(200);
          }
        }
      } catch (err) {
        console.log(chalk.red(` ERROR: ${err.message}`));
        if (err.message.includes("REQUEST_DENIED") || err.message.includes("API key")) {
          console.error(chalk.red.bold("\n💥 API key issue. Stopping.\n"));
          process.exit(1);
        }
      }
    }
  }

  // ─── Summary ───
  console.log(chalk.cyan("\n═══════════════════════════════════════"));
  console.log(chalk.cyan.bold("  📊 Scraper Summary"));
  console.log(chalk.cyan("═══════════════════════════════════════"));
  console.log(chalk.white(`  🏢 Total businesses searched:  ${allBusinesses.size}`));
  console.log(chalk.white(`  📋 Saved to CSV:               ${savedCount}`));
  console.log(chalk.gray(`  🔑 Total API calls:            ${totalApiCalls}`));
  console.log(chalk.cyan("═══════════════════════════════════════\n"));
}

function formatCsvRow(b) {
  const escapeName = `"${(b.name || "").replace(/"/g, '""')}"`;
  const escapeCity = `"${(b.city || "").replace(/"/g, '""')}"`;
  const escapeAddr = `"${(b.address || "").replace(/"/g, '""')}"`;
  const escapeWeb = `"${(b.website || "").replace(/"/g, '""')}"`;
  const escapeMaps = `"${(b.googleMapsUrl || "").replace(/"/g, '""')}"`;
  const escapeEmail = `"${(b.email || "").replace(/"/g, '""')}"`;

  return [
    b.phone,
    escapeName,
    b.category,
    escapeCity,
    1,
    escapeWeb,
    escapeEmail,
    b.instagram || "",
    b.facebook || "",
    b.twitter || "",
    b.linkedin || "",
    b.rating || "",
    escapeAddr,
    escapeMaps,
  ].join(",") + "\n";
}



main().catch((err) => {
  console.error(chalk.red(`\n💥 Fatal error: ${err.message}`));
  console.error(err);
  process.exit(1);
});
