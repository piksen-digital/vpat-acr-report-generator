# VPAT/ACR Report Generator

Generates an evidence-backed draft ACR (Accessibility Conformance Report) from
axe-core scans of your website, mapped to WCAG 2.2 A/AA, EN 301 549 clauses and
VPAT 2.5Rev criterion rows. Input: your URLs. Output: Markdown + DOCX draft
report, per-criterion dataset, and page screenshots as evidence.

**This is a draft, not a certification.** Automated testing detects roughly
30–57% of WCAG issues. Criteria without automated coverage are marked
*Not Evaluated*; partially automatable criteria are never marked *Supports*
without human review. Finalize the report with an accessibility expert and
transfer the results table into the official ITI VPAT® 2.5Rev template.

## Pricing (pay-per-event)

| Event | Price | Charged when |
|---|---|---|
| report-generated | $0.75 | once per report (primary event) |
| page-scanned | $0.01 | per page scanned, including pages that fail navigation (they consumed resources and are recorded as error items) |

Users can cap spend per run; when the cap is reached the Actor stops scanning
and produces the report from the pages collected so far.

## Input

| Field | Default | Description |
|---|---|---|
| startUrls | — | Pages to scan (required) |
| maxPages | 10 | Hard cap on scanned pages |
| edition | EU | VPAT 2.5Rev edition: 508 / EU / INT / WCAG |
| conformanceLevel | AA | WCAG 2.2 level |
| includeScreenshots | true | Evidence screenshots in Key-Value Store |
| reportFormat | [docx, md] | Output formats |
| reportMetadata | — | Company/product details for the ACR header |

## Output

- Key-Value Store: `acr-report-YYYY-MM-DD.md` / `.docx` + per-page screenshots
- Dataset: one structured item per criterion (SC, name, level, EN 301 549 clause,
  verdict, findings) — directly consumable by AI agents via Apify MCP.

## Development

    npm install
    npx playwright install chromium
    npm test                      # honesty rules unit tests
    apify run --purge             # local run; use file:// fixture URLs first:
    #   file:///abs/path/fixtures/site/index.html
    #   file:///abs/path/fixtures/site/clean.html

## Legal notes

VPAT® and "Voluntary Product Accessibility Template" are registered service
marks of the Information Technology Industry Council (ITI). This tool is not
affiliated with or endorsed by ITI; buyers license and use the official VPAT
templates from ITI directly.
