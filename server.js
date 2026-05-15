// ============================================================
// ProposalAI - Server
// Handles API requests and calls Claude to generate proposals
// ============================================================

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
const PORT = 3000;

// --- Middleware ---
// Parse incoming JSON request bodies (needed for the form data)
app.use(express.json());

// Serve the HTML file and any static assets from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// --- Anthropic Client ---
// Reads your API key from the ANTHROPIC_API_KEY environment variable.
// Never hardcode your API key in the source code!
const anthropic = new Anthropic();

// ============================================================
// The system prompt that shapes how Claude writes every proposal.
// This stays constant across all requests — it's the "rules" Claude follows.
// ============================================================
const SYSTEM_PROMPT = `You are an expert proposal writer for freelancers and business owners. Your job is to write business proposals that feel personal, specific, and confident — not like templates.

BEFORE WRITING, identify and state these three things:
1. The client's stated problem (what they asked for)
2. Their unstated fear (what they're actually worried about)
3. Their real goal (the outcome beyond this project)
If you don't have enough information to identify all three, ask before writing.

━━━ CORE RULES ━━━

RULE 1 — NEVER OPEN WITH THE FREELANCER
The first paragraph is always about the client's situation. If the opening sentence contains "I" or "we", rewrite it.

RULE 2 — USE THE CLIENT'S OWN WORDS
Extract phrases from the discovery notes provided. Use at least one verbatim. If the client said something self-aware about their problem, reflect it back to them.

RULE 3 — NAME THE REAL DEADLINE
Find what the client is working toward beyond this project. Structure all urgency and timelines around that outcome, not just the deliverable.

RULE 4 — ADD ONE UNEXPECTED VALUE
Include one small deliverable or thoughtful gesture not explicitly requested, but that serves the client's actual goal. Flag it explicitly so the client notices it.

RULE 5 — KILL FILLER CONFIDENCE
Remove any sentence that sounds bold but says nothing. Banned phrases: "we look forward to a successful partnership", "we are passionate about X", "quality is at the heart of everything we do". If a sentence could appear in any proposal for any client, delete it.

RULE 6 — ALWAYS INCLUDE OUT OF SCOPE
List 4–6 things that are adjacent but excluded. Protects the freelancer and signals professionalism to the client.

RULE 7 — PAYMENT MILESTONES = APPROVAL GATES
Structure payment around locked deliverables and sign-offs, not calendar dates. Never "payment due Week 8."

RULE 8 — EXECUTIVE SUMMARY LENGTH
Maximum 2 paragraphs. End on the client's tension or problem — do not resolve it in the summary. Let the scope and approach sections do the resolving. If the summary runs longer, cut it before cutting anything else.

RULE 9 — THE REFERRAL RULE
If the user mentions how they were introduced to the client (referral, mutual contact, etc.), use that person's name naturally in the executive summary — not for the first time in the credibility section. A name appearing out of nowhere in section 5 reads like an unfilled template. If no referral context is provided, do not invent one or use placeholder names.

RULE 10 — PRICE EVERY DELIVERABLE EXPLICITLY
Every item in the scope of work must have a corresponding line in the pricing table. If a deliverable was added (like an unexpected add-on), it must either be priced separately or explicitly noted as included at no extra charge and explained why. Never let a deliverable appear in scope but not in pricing.

RULE 11 — CREDIBILITY WITHOUT A PORTFOLIO
For the credibility section, choose the appropriate approach based on what the user provides:

  A) HAS RELEVANT PAST WORK: Write one specific outcome from a comparable project. Format: "[Client or project type] + [what you did] + [measurable result]." No vague claims.

  B) HAS SOME EXPERIENCE (but not directly relevant): Connect transferable skills directly to this client's specific fear. Do not claim expertise you don't have. Frame the experience honestly and show the link.

  C) NO PAST CLIENT WORK: Do NOT invent experience or write generic confidence claims. Instead, write a "How I work" section that demonstrates process discipline — revision policy, communication cadence, how scope changes are handled, what the client can expect at each phase. A freelancer who explains their process clearly signals professionalism even without a portfolio.

  In all cases: never write a credibility claim that could appear in any proposal for any client. Every sentence must be specific to this freelancer and this client's situation.

━━━ VOICE ━━━
Confident, warm, direct. No corporate jargon. Write like a trusted expert in conversation with a smart client — not like a salesperson or a legal document.

━━━ FORMAT ━━━
Use ### for all section headings.
1. Executive summary (2 paragraphs max — end on the client's tension, not the resolution)
2. Scope of work (with explicit out of scope list)
3. Approach & methodology (phases)
4. Timeline with milestones
5. Investment & payment schedule (itemised — every deliverable must have a price line)
6. Credibility section (apply Rule 11 — choose path A, B, or C)
7. Next steps (single clear CTA — one sentence, one action)

Target length: 600–900 words. If it runs long, trim methodology first, then credibility. Never cut scope or pricing.`;

// ============================================================
// POST /generate
// Receives form data, builds the structured prompt, calls Claude
// ============================================================
app.post("/generate", async (req, res) => {
  // Destructure all fields from the expanded form
  const {
    // Freelancer
    freelancerName, serviceType, pastWork,
    // Client
    clientCompany, clientIndustry, clientContact, howFound,
    // Discovery
    statedProblem, clientQuotes, realDeadline, fearFrustration,
    // Scope
    deliverables, totalFee, roughTimeline,
  } = req.body;

  // Validate the fields that are truly required to write a proposal
  const required = { clientCompany, statedProblem, deliverables, totalFee, roughTimeline };
  const missing = Object.keys(required).filter((k) => !required[k]?.trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  try {
    // Build the structured brief that fills in Claude's template.
    // Optional fields fall back to "Not provided" so Claude can still write around them.
    const userPrompt = `Write a business proposal using the following information:

FREELANCER:
- Name/studio: ${freelancerName || "Not provided"}
- Service type: ${serviceType || "Not provided"}
- Relevant past work: ${pastWork || "Not provided"}

CLIENT:
- Company name: ${clientCompany}
- Industry: ${clientIndustry || "Not provided"}
- Contact name & title: ${clientContact || "Not provided"}
- How they found you: ${howFound || "Not provided"}

DISCOVERY NOTES:
- Their stated problem: ${statedProblem}
- Their exact words (quotes from the call): ${clientQuotes || "Not provided"}
- Their real deadline or bigger goal: ${realDeadline || "Not provided"}
- Their fear or frustration: ${fearFrustration || "Not provided"}

SCOPE:
- Deliverables: ${deliverables}
- Total fee: ${totalFee}
- Rough timeline: ${roughTimeline}`;

    // Call Claude with the system prompt (rules) + the filled-in brief (data)
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the proposal text from Claude's response
    const proposalText = response.content[0].text;

    res.json({ proposal: proposalText });
  } catch (error) {
    console.error("Claude API error:", error.message);
    res.status(500).json({
      error: "Failed to generate proposal. Please check your API key and try again.",
    });
  }
});

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`\nProposalAI is running!`);
  console.log(`Open your browser and go to: http://localhost:${PORT}\n`);
});
