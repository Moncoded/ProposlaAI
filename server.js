// ============================================================
// ProposalAI - Server
// Handles API requests and calls Claude to generate proposals
// ============================================================

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { chromium } = require("playwright");
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

RULE 12 — PRICING MUST MATCH NARRATIVE WEIGHT
The fee assigned to each deliverable must be proportionate to how it is described in the proposal. If a phase is framed as "the foundation everything else is built on" or "the most critical step," it cannot also be the lowest-priced line item. Before finalising the pricing table, check every deliverable: if the narrative frames it as high-stakes or foundational, its price must reflect that. A mismatch between what you say a phase is worth and what you charge for it signals either inflated writing or underpriced work — both undermine trust.

RULE 13 — NAME CONSISTENCY THROUGHOUT
If a studio or business name is used anywhere in the proposal, it must be introduced naturally in the executive summary or opening — before it appears anywhere else. Never let a name surface for the first time mid-document (e.g. in a "How I Work" section) without prior context. If the freelancer has not provided a studio name, write the entire proposal in first person. Do not switch between "I" and a studio name. Pick one voice and hold it from the first word to the last.

RULE 14 — NEXT STEPS: NO HEDGING
The next steps section is one sentence and one action. It must signal that you are ready to begin — not that you are waiting to find out if the client approves. Never use conditional openers like "If this reads right..." or "If you're happy with this..." or "Feel free to reach out." State the action directly: what happens next, who does it, and when. The client should feel pulled forward, not asked for permission.

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

// ============================================================
// POST /export-pdf
// Receives the rendered proposal HTML from the browser,
// uses Puppeteer to print it to PDF on the server, and
// sends back a downloadable file with a ProposalAI footer.
// ============================================================
app.post("/export-pdf", async (req, res) => {
  const { html, clientName } = req.body;

  if (!html) {
    return res.status(400).json({ error: "No HTML content provided." });
  }

  // Wrap the proposal HTML in a complete document with print-ready styles.
  // These mirror the display styles in index.html so the PDF matches the screen.
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.75;
      color: #222;
    }
    h1, h2, h3 {
      color: #2d3a8c;
      font-weight: 700;
      line-height: 1.3;
      margin: 1.4rem 0 0.45rem;
    }
    h1 { font-size: 1.3rem; }
    h2 {
      font-size: 1.1rem;
      border-bottom: 2px solid #e8eaf6;
      padding-bottom: 0.3rem;
    }
    h3 { font-size: 1rem; }
    p { margin-bottom: 0.8rem; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    ol, ul { margin: 0.4rem 0 0.9rem 1.5rem; padding: 0; }
    li { display: list-item; margin-bottom: 0.3rem; padding-left: 0.2rem; }
    ol li { list-style-type: decimal; }
    ul li { list-style-type: disc; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.9rem 0 1.1rem;
      font-size: 0.88rem;
    }
    th, td {
      border: 1px solid #c5cae9;
      padding: 0.5rem 0.75rem;
      text-align: left;
      word-break: break-word;
    }
    th {
      background: #eef0fb;
      font-weight: 700;
      color: #2d3a8c;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tr:nth-child(even) td {
      background: #f9fafe;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    hr {
      border: none;
      border-top: 2px solid #e8eaf6;
      margin: 1.4rem 0;
    }
  </style>
</head>
<body>${html}</body>
</html>`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      // These args are required when running inside a Linux container (Railway, Docker, etc.)
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    // Load the full HTML and wait for any fonts/layout to settle.
    // Playwright uses "networkidle" (no number suffix) instead of Puppeteer's "networkidle0".
    await page.setContent(fullHtml, { waitUntil: "networkidle" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: {
        top: "18mm",
        right: "18mm",
        bottom: "24mm", // extra bottom space to seat the footer
        left: "18mm",
      },
      // displayHeaderFooter injects the footer HTML on every page.
      // The footer template runs in its own isolated context so all styles must be inline.
      displayHeaderFooter: true,
      headerTemplate: "<div></div>", // required placeholder — keeps header area blank
      footerTemplate: `
        <div style="
          font-family: 'Segoe UI', Arial, sans-serif;
          font-size: 9px;
          color: #aaa;
          text-align: center;
          width: 100%;
          padding: 0 18mm;
          box-sizing: border-box;
        ">
          Generated with ProposalAI — proposalai-production.up.railway.app
        </div>`,
      printBackground: true, // needed to render coloured table headers
    });

    const filename = clientName ? `Proposal — ${clientName}.pdf` : "Proposal.pdf";

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);

  } catch (error) {
    console.error("PDF generation error:", error.message);
    res.status(500).json({ error: "Failed to generate PDF. Please try again." });
  } finally {
    // Always close the browser to free memory, even if an error occurred
    if (browser) await browser.close();
  }
});

// --- Start the server ---
app.listen(PORT, () => {
  console.log(`\nProposalAI is running!`);
  console.log(`Open your browser and go to: http://localhost:${PORT}\n`);
});
