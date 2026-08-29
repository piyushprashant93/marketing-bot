# WhatsApp Marketing Bot 🚀

A QR-based Node.js script that sends customized marketing messages via your personal WhatsApp to businesses.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Add your business contacts
#    Edit data/contacts.csv with real phone numbers

# 3. Do a dry run first (no messages sent)
npm run dry-run

# 4. Test by sending to yourself
npm run test-msg

# 5. Run the campaign
npm start
```

## How It Works

This bot includes multiple tools that can be run independently or together to create a full-scale marketing campaign.

### 📱 WhatsApp Marketing
1. **Run the script** → A QR code appears in your terminal.
2. **Scan with WhatsApp** → Open WhatsApp → Settings → Linked Devices → Link a Device.
3. **Messages are sent** → Bot sends personalized messages with random delays (30-90s).
4. **Session persists** → You only need to scan the QR once; subsequent runs reconnect automatically.

### 📍 Marketing Scraper (Google Maps)
The scraper uses the Google Maps API to find businesses in your target area based on a keyword.
- Run `npm run scrape` to fetch leads.
- It automatically pulls business names, phone numbers, and categories.

### 📧 Email Marketing
The bot can send personalized cold emails using Mailtrap or any standard SMTP server.
- Ensure your SMTP credentials are set in `.env`.
- Run `npm run email` to parse your contact list and dispatch HTML emails with natural delays.

### 📸 Instagram Marketing
The bot automates Instagram Direct Messages via Puppeteer (browser automation).
- **⚠️ Important:** You must use an **Instagram Business Account** for this feature.
- When you first run `npm run insta`, a browser window will open. **You must log in manually** in the browser.
- Once logged in, cookies are saved so subsequent runs work automatically. The bot navigates to user profiles and types messages natively.

## Contact File Format

Edit `data/contacts.csv`:

| Column | Description | Example |
|--------|-------------|---------|
| `phone` | Indian mobile number | `+919876543210` |
| `business_name` | Business name (used in message) | `Sharma Restaurant` |
| `category` | Business type | `restaurant`, `clinic`, `retail` |
| `city` | City | `Patna` |
| `template` | Message template (1, 2, or 3) | `1` |

### Templates

- **Template 1** — Cold outreach (detailed, for first contact)
- **Template 2** — Follow-up (for businesses already contacted)
- **Template 3** — Quick pitch (short and casual)

## Configuration

Edit `.env` to adjust:

```env
MIN_DELAY=30        # Min seconds between messages
MAX_DELAY=90        # Max seconds between messages
MAX_MESSAGES=50     # Max messages per run
DEFAULT_TEMPLATE=1  # Default template ID
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Send messages to contacts |
| `npm run dry-run` | Preview messages without sending |
| `npm run test-msg` | Send a test message to your own number |

## Safety Features

- ⏱️ **Random delays** (30-90s) between messages to avoid detection
- 🚫 **Duplicate prevention** — tracks sent numbers in `data/sent.json`
- 📋 **Logging** — all sends logged to `logs/send-log-YYYY-MM-DD.csv`
- 🔒 **Max cap** — limits messages per run (default: 50)
- 👀 **Dry run** — preview everything without actually sending

## ⚠️ Important Notes

- This uses an **unofficial** WhatsApp library. Use at your own risk.
- Sending too many messages can get your number **banned**.
- Start with small batches (10-20) and increase gradually.
- Use a **secondary WhatsApp number** if possible.
- Always do a `--dry-run` before the real run.
