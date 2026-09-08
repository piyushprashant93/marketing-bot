require("dotenv").config();

/**
 * WhatsApp Marketing Bot - Message Templates
 *
 * Category-specific, personalized marketing messages.
 * Each business gets a message tailored to their industry.
 */

const SENDER_NAME = process.env.SENDER_NAME || "Piyush";
const COMPANY_NAME = process.env.COMPANY_NAME || "SutraCode";

// ─── Category-specific value propositions ────────────────────────────
const categoryHooks = {
  restaurant: {
    emoji: "🍽️",
    pain: "paying huge commissions to food delivery apps",
    benefits: [
      "🌐 Your own custom website with a direct ordering system",
      "📱 A dedicated mobile app for your regular customers",
      "💰 Zero commission on orders",
    ],
    cta: "Imagine keeping 100% of your profits while building your own brand online!",
  },
  clinic: {
    emoji: "🏥",
    pain: "managing patient records on paper and losing track of appointments",
    benefits: [
      "💻 A custom clinic management system",
      "📅 Online appointment booking via your own website",
      "📈 Automated patient reminders",
    ],
    cta: "Your patients expect a modern, digital experience. We can build it for you!",
  },
  hospital: {
    emoji: "🏥",
    pain: "using outdated, clunky software that slows down your staff",
    benefits: [
      "🏥 Custom Hospital Management System (HMS)",
      "📱 A professional website to build patient trust",
      "⚡ Fast, secure, and modern cloud architecture",
    ],
    cta: "We build systems that reduce admin workload so your doctors can focus on patients.",
  },
  salon: {
    emoji: "💇",
    pain: "losing bookings because you don't have a strong online presence",
    benefits: [
      "💅 A stunning website to showcase your portfolio",
      "📅 24/7 automated online booking system",
      "📈 Better Google rankings so locals find you first",
    ],
    cta: "Clients could be booking appointments at 2 AM — if you had the right website!",
  },
  gym: {
    emoji: "💪",
    pain: "struggling to manage memberships and track attendance",
    benefits: [
      "🏋️ A professional website to capture leads",
      "📱 A custom app for members to track workouts",
      "📅 Automated membership renewal reminders",
    ],
    cta: "Upgrade your gym's tech to match your state-of-the-art equipment!",
  },
  education: {
    emoji: "📚",
    pain: "managing attendance on paper and losing track of fee leakages",
    benefits: [
      "✅ Automate attendance & generate conflict-free timetables",
      "💰 Stop 100% of fee leakage with real-time reconciliation",
      "📱 Give parents a transparent, real-time portal",
    ],
    cta: "Start your 14-Day Free Trial of Vidyantra today!",
  },
  retail: {
    emoji: "🛍️",
    pain: "losing sales to Amazon and Flipkart",
    benefits: [
      "🛒 Your own powerful E-commerce website",
      "📦 Custom inventory & billing software",
      "💳 Seamless payment gateway integration",
    ],
    cta: "Take your physical store online and sell 24/7 to the whole city!",
  },
};

// Default fallback for unknown categories
const defaultHook = {
  emoji: "🚀",
  pain: "relying entirely on word-of-mouth instead of a strong digital presence",
  benefits: [
    "🌐 A blazing-fast, modern website",
    "💻 Custom software to automate your daily tasks",
    "📱 Mobile apps built for your specific needs",
  ],
  cta: "Your business deserves world-class software engineered specifically for you.",
};

// ─── Helpers ───────────────────────────────────────────────────────────

function spintax(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Message Generators ──────────────────────────────────────────────

/**
 * Generate a cold outreach message customized to the business category.
 */
function coldOutreach(businessName, category) {
  const hook = categoryHooks[category] || defaultHook;
  const greetings = ["Namaste", "Hi", "Hello", "Hey"];
  const introHooks = ["Quick question:", "I was wondering...", "Just curious,"];
  
  return `${hook.emoji} ${spintax(greetings)} *${businessName}*!

I'm ${SENDER_NAME} from ${COMPANY_NAME}. We are a leading IT company, and I noticed you're a highly-rated ${category.replace(/_/g, " ")} business! 👏

${spintax(introHooks)} Are you tired of ${hook.pain}?

At ${COMPANY_NAME}, we build world-class software specifically for businesses like yours:

${hook.benefits.join("\n")}

${hook.cta}

✅ Custom Websites & Mobile Apps
✅ ERP & SaaS Solutions
✅ Local team, production-ready engineering

Would love to show you some of our live client work! 
🌐 *Check out our website:* https://vidyantra.tech/
👉 *Reply "YES" to book a quick demo!* 🙌`;
}

/**
 * Generate a follow-up message customized to the business category.
 */
function followUp(businessName, category) {
  const hook = categoryHooks[category] || defaultHook;
  const greetings = ["Hi", "Hello", "Hey there"];

  return `${spintax(greetings)} *${businessName}* 👋

Following up — other ${category.replace(/_/g, " ")} businesses are already upgrading their tech with us to:
${hook.benefits.join("\n")}

A strong digital presence is no longer optional.

Happy to hop on a quick 5-min call to discuss your ideas! 
👉 *Reply "DEMO" and I'll send you our website link to check out our work.* 🙌`;
}

/**
 * Generate a quick pitch customized to the business category.
 */
function quickPitch(businessName, category) {
  const hook = categoryHooks[category] || defaultHook;
  const greetings = ["Hey", "Hi", "Hello"];

  return `${spintax(greetings)} *${businessName}*! ${hook.emoji}

Quick question — would upgrading to ${hook.benefits[0].replace(/^[^\s]+ /, "").toLowerCase()} help your business grow?

We build world-class web & mobile apps at ${COMPANY_NAME}.

👉 *Reply "YES" to see our portfolio!*`;
}

// ─── Template Map ────────────────────────────────────────────────────

/**
 * Generate a Janmashtami wish.
 */
function janmashtamiWish(businessName, category) {
  return `Hare Krishna *${businessName}*! 🦚

Wishing you and your team a very Happy Janmashtami! May Lord Krishna's blessings bring joy, prosperity, and immense success to your business.

From all of us at ${COMPANY_NAME}. ✨`;
}

const templates = {
  1: coldOutreach,
  2: followUp,
  3: quickPitch,
  4: janmashtamiWish,
};

/**
 * Get a formatted marketing message for a business.
 * @param {number} templateId - Template number (1, 2, or 3)
 * @param {string} businessName - Name of the business
 * @param {string} [category] - Business category for customization
 * @returns {string} Formatted message
 */
function getMessage(templateId, businessName, category) {
  const template = templates[templateId];
  if (!template) {
    throw new Error(
      `Invalid template ID: ${templateId}. Use 1, 2, 3, or 4.`
    );
  }
  return template(businessName || "there", category || "general");
}

/**
 * Get all available template IDs.
 * @returns {number[]}
 */
function getTemplateIds() {
  return Object.keys(templates).map(Number);
}

module.exports = { getMessage, getTemplateIds };
