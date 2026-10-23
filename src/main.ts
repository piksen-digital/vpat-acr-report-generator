/**
 * VPAT/ACR Report Generator — Apify Actor (starter implementation)
 *
 * Scans pages with axe-core (injected into Playwright), maps every finding to
 * WCAG 2.2 A/AA success criteria, EN 301 549 clauses and VPAT 2.5Rev rows, and
 * emits an evidence-backed DRAFT ACR (Markdown + DOCX) plus one structured
 * dataset item per criterion so agents can consume the results directly.
 *
 * Honesty rules baked in (do not remove):
 *  - Automated tools detect only ~30-57% of WCAG issues. Criteria without
 *    automated coverage ALWAYS render as "Not Evaluated".
 *  - Partially automatable criteria NEVER render as "Supports" — at best they
 *    render "No Violations Detected" with a manual-review recommendation.
 *  - A failed page is recorded as an error item, never silently skipped.
 */

import { Actor, log, KeyValueStore } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import {
    Document, HeadingLevel, Packer, Paragraph, Table, TableCell,
    TableRow, TextRun, WidthType,
} from 'docx';
import mapping from '../mapping/wcag22-aa-mapping.json';

// ---------------------------------------------------------------- types ----

export interface Criterion {
    sc: string;
    name: string;
    level: 'A' | 'AA';
    en301549: string;
    axeTag: string | null;
    automated: 'full' | 'partial' | 'none';
    notes: string;
}

export interface AxeFinding {
    id: string;
    help: string;
    impact: string | null;
    tags: string[];
    nodeCount: number;
}

export interface PageScan {
    url: string;
    violations: AxeFinding[];
    passes: AxeFinding[];
    incomplete: AxeFinding[];
    screenshotKey?: string;
    error?: string;
}

export interface Input {
    startUrls: { url: string }[];
    maxPages?: number;
    edition?: '508' | 'EU' | 'INT' | 'WCAG';
    conformanceLevel?: 'A' | 'AA';
    includeScreenshots?: boolean;
    reportFormat?: ('docx' | 'md')[];
    reportMetadata?: {
        companyName?: string;
        productName?: string;
        productVersion?: string;
        contactEmail?: string;
    };
}

type Verdict =
    | 'Supports'
    | 'No Violations Detected'
    | 'Does Not Support'
    | 'Requires Manual Assessment'
    | 'Not Evaluated';

interface CriterionResult {
    criterion: Criterion;
    verdict: Verdict;
    violationCount: number;
    incompleteCount: number;
    passCount: number;
    findings: (AxeFinding & { pageUrl: string })[];
}

const CRITERIA = (mapping as { criteria: Criterion[] }).criteria;

// axe-core is a plain script: resolve its minified bundle and inject it.
// Under vitest's ESM transform `require` is undefined — the unit tests import
// this module for aggregate()/buildMarkdown() and never need the path, so
// fall back to the relative location there.
const AXE_PATH: string = typeof require !== 'undefined'
    ? require.resolve('axe-core/axe.min.js')
    : 'node_modules/axe-core/axe.min.js';

// ------------------------------------------------------------ aggregation ----

/**
 * Conservative verdict per criterion. Pure function — unit-tested in
 * tests/aggregate.test.ts. NEVER let a coding agent loosen these rules.
 */
export function aggregate(c: Criterion, pages: PageScan[]): CriterionResult {
    const none: CriterionResult = {
        criterion: c, verdict: 'Not Evaluated',
        violationCount: 0, incompleteCount: 0, passCount: 0, findings: [],
    };
    if (c.automated === 'none' || !c.axeTag) return none;

    const tag = c.axeTag;
    const findings: (AxeFinding & { pageUrl: string })[] = [];
    let passCount = 0;
    let incompleteCount = 0;

    for (const page of pages) {
        for (const v of page.violations) {
            if (v.tags.includes(tag)) findings.push({ ...v, pageUrl: page.url });
        }
        passCount += page.passes.filter((p) => p.tags.includes(tag)).length;
        incompleteCount += page.incomplete.filter((p) => p.tags.includes(tag)).length;
    }

    if (findings.length > 0) {
        return {
            criterion: c, verdict: 'Does Not Support',
            violationCount: findings.length, incompleteCount, passCount, findings,
        };
    }
    if (incompleteCount > 0) {
        return {
            criterion: c, verdict: 'Requires Manual Assessment',
            violationCount: 0, incompleteCount, passCount, findings: [],
        };
    }
    if (passCount > 0) {
        return {
            criterion: c,
            // Fully automatable criteria may claim Supports on clean passes.
            // Partially automatable ones never may — see honesty rules above.
            verdict: c.automated === 'full' ? 'Supports' : 'No Violations Detected',
            violationCount: 0, incompleteCount, passCount, findings: [],
        };
    }
    // Automated coverage exists but these pages produced no evidence for it.
    return {
        criterion: c, verdict: 'Requires Manual Assessment',
        violationCount: 0, incompleteCount, passCount, findings: [],
    };
}

// ----------------------------------------------------------------- report ----

export function buildMarkdown(
    input: Input, edition: string, level: 'A' | 'AA', scans: PageScan[], rows: CriterionResult[],
): string {
    const today = new Date().toISOString().slice(0, 10);
    const meta = input.reportMetadata ?? {};
    const counts = (v: Verdict) => rows.filter((r) => r.verdict === v).length;

    const lines: string[] = [];
    lines.push('# Accessibility Conformance Report (Draft)', '');
    lines.push(
        `**Draft ACR generated from automated evidence (axe-core) on ${today}.**`,
        'Automated testing detects roughly 30–57% of WCAG issues. Criteria marked',
        '*Not Evaluated* or *Requires Manual Assessment* require expert judgment before',
        'this report is signed. **This document is not a certification of conformance.**',
        'Paste the results table into the official ITI VPAT® 2.5Rev template to finalize.',
        '',
    );
    lines.push('## Product under evaluation', '');
    lines.push(`- Company: ${meta.companyName ?? 'Not provided'}`);
    lines.push(`- Product: ${meta.productName ?? 'Not provided'} ${meta.productVersion ? `(${meta.productVersion})` : ''}`);
    lines.push(`- Contact: ${meta.contactEmail ?? 'Not provided'}`);
    lines.push(`- Target: VPAT 2.5Rev (${edition} edition) · WCAG 2.2 Level ${level} · EN 301 549 clause mapping`);
    lines.push('', '## Pages scanned', '');
    lines.push('| URL | Violations (all rules) | Incomplete checks | Error |');
    lines.push('|---|---|---|---|');
    for (const s of scans) {
        lines.push(`| ${s.url} | ${s.violations.length} | ${s.incomplete.length} | ${s.error ? '⚠ ' + s.error.slice(0, 80) : '—'} |`);
    }
    lines.push('', '## Summary', '');
    lines.push('| Result | Criteria |');
    lines.push('|---|---|');
    for (const v of ['Supports', 'No Violations Detected', 'Does Not Support', 'Requires Manual Assessment', 'Not Evaluated'] as Verdict[]) {
        lines.push(`| ${v} | ${counts(v)} |`);
    }
    for (const lvl of (level === 'AA' ? ['A', 'AA'] : ['A'])) {
        lines.push('', `## Results — Level ${lvl}`, '');
        lines.push('| SC | Criterion | EN 301 549 | Result | Automated evidence |');
        lines.push('|---|---|---|---|---|');
        for (const r of rows.filter((x) => x.criterion.level === lvl)) {
            const evidence = r.findings.length
                ? `${r.violationCount} finding(s) across ${new Set(r.findings.map((f) => f.pageUrl)).size} page(s)`
                : r.passCount > 0 ? `${r.passCount} passed check(s)` : '—';
            lines.push(`| ${r.criterion.sc} | ${r.criterion.name} | ${r.criterion.en301549} | ${r.verdict} | ${evidence} |`);
        }
    }
    const failed = rows.filter((r) => r.findings.length > 0);
    if (failed.length) {
        lines.push('', '## Evidence appendix (violations)', '');
        for (const r of failed) {
            lines.push(`### ${r.criterion.sc} ${r.criterion.name} — ${r.verdict}`, '');
            for (const f of r.findings) {
                lines.push(`- **[${f.impact ?? 'unknown'}]** \`${f.id}\` ${f.help} — ${f.nodeCount} node(s) on ${f.pageUrl}`);
            }
            lines.push('');
        }
    }
    lines.push('## How to use this draft', '');
    lines.push(
        '1. Replace "Not provided" fields with vendor details.',
        '2. Have an accessibility expert assess every *Requires Manual Assessment* and *Not Evaluated* criterion.',
        '3. Transfer the results table into the official ITI VPAT® 2.5Rev template for your edition, then sign as ACR.',
    );
    return lines.join('\n');
}

async function buildDocx(
    input: Input, edition: string, level: 'A' | 'AA', rows: CriterionResult[],
): Promise<Buffer> {
    const meta = input.reportMetadata ?? {};
    const cell = (text: string, bold = false) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
    const tableRows = [
        new TableRow({
            tableHeader: true,
            children: ['SC', 'Criterion', 'Level', 'EN 301 549', 'Result'].map((h) => cell(h, true)),
        }),
        ...rows.map((r) => new TableRow({
            children: [
                cell(r.criterion.sc), cell(r.criterion.name), cell(r.criterion.level),
                cell(r.criterion.en301549), cell(r.verdict),
            ],
        })),
    ];
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ text: 'Accessibility Conformance Report (Draft)', heading: HeadingLevel.HEADING_1 }),
                new Paragraph({
                    children: [new TextRun({
                        text: 'Draft generated from automated evidence (axe-core). Automated testing detects roughly 30–57% of WCAG issues; criteria marked Not Evaluated or Requires Manual Assessment need expert judgment. This document is not a certification of conformance.',
                        italics: true,
                    })],
                }),
                new Paragraph({ text: `Company: ${meta.companyName ?? 'Not provided'}` }),
                new Paragraph({ text: `Product: ${meta.productName ?? 'Not provided'}` }),
                new Paragraph({ text: `Target: VPAT 2.5Rev (${edition}) — WCAG 2.2 Level ${level} — EN 301 549 clause mapping` }),
                new Paragraph({ text: `Generated: ${new Date().toISOString().slice(0, 10)}` }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: tableRows,
                }),
            ],
        }],
    });
    return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}

// ------------------------------------------------------------------- run ----

async function run(): Promise<void> {
    const input = (await Actor.getInput<Input>())!;
    const maxPages = input.maxPages ?? 10;
    const edition = input.edition ?? 'EU';
    const level = input.conformanceLevel ?? 'AA';
    const includeScreenshots = input.includeScreenshots ?? true;
    const formats = input.reportFormat ?? ['docx', 'md'];
    const startUrls = input.startUrls ?? [];

    if (startUrls.length === 0) {
        log.error('No startUrls provided — nothing to scan. Exiting without charging.');
        return;
    }

    const scans: PageScan[] = [];
    let limitHit = false;

    const crawler = new PlaywrightCrawler({
        maxConcurrency: 3,
        maxRequestsPerCrawl: maxPages,
        requestHandlerTimeoutSecs: 120,

        async requestHandler({ page, request, enqueueLinks }) {
            if (limitHit) return;
            const url = request.loadedUrl ?? request.url;
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

            // Inject axe-core and run it in the page. Map to plain objects so the
            // result serializes cleanly across the Playwright boundary.
            await page.addScriptTag({ path: AXE_PATH });
            const results = await page.evaluate(async () => {
                const axe = (window as unknown as { axe: { run: (n: unknown, o: unknown) => Promise<unknown> } }).axe;
                const r = (await axe.run(document, { resultTypes: ['violations', 'passes', 'incomplete'] })) as {
                    violations: any[]; passes: any[]; incomplete: any[];
                };
                const slim = (arr: any[]) => arr.map((x: any) => ({
                    id: x.id, help: x.help, impact: x.impact ?? null,
                    tags: x.tags as string[], nodeCount: x.nodes?.length ?? 0,
                }));
                return {
                    violations: slim(r.violations ?? []),
                    passes: slim(r.passes ?? []),
                    incomplete: slim(r.incomplete ?? []),
                };
            });

            const scan: PageScan = { url, ...results };
            if (includeScreenshots) {
                const shot = await page.screenshot({ fullPage: true });
                const key = `screenshot-${scans.length + 1}.png`;
                await KeyValueStore.setValue(key, shot, { contentType: 'image/png' });
                scan.screenshotKey = key;
            }
            scans.push(scan);
            log.info(`Scanned ${url}: ${results.violations.length} violations, ${results.incomplete.length} incomplete.`);

            // Crawl more same-hostname pages up to the maxPages cap.
            await enqueueLinks({ strategy: 'same-hostname' }).catch(() => undefined);

            // CHARGING — hand-written, never delegate the policy:
            // one "page-scanned" event per scanned page. Check the returned
            // limit flag; when the user's spend cap is hit, stop scanning and
            // finish the report with what we have instead of dying mid-run.
            // (Verify the result field name against your apify SDK version.)
            const charge = await Actor.charge('page-scanned');
            if ((charge as unknown as { isLimitReached?: boolean })?.isLimitReached) {
                limitHit = true;
                log.warning('Spend cap reached — no more pages will be scanned.');
            }
        },

        // Charge-on-partial-failure policy (owner's decision, documented in README):
        // a page that fails navigation still consumed resources, so it is charged
        // and recorded as an error item; the run continues.
        async failedRequestHandler({ request }, error) {
            scans.push({
                url: request.url, violations: [], passes: [], incomplete: [],
                error: `Navigation failed: ${String(error).slice(0, 200)}`,
            });
            await Actor.charge('page-scanned').catch(() => undefined);
        },
    });

    await crawler.run(startUrls);

    if (scans.length === 0) {
        log.error('No pages were scanned successfully — no report generated, no report event charged.');
        return;
    }

    // Aggregate against the mapping table (the moat — verify every row first).
    const relevant = level === 'AA' ? CRITERIA : CRITERIA.filter((c) => c.level === 'A');
    const rows = relevant.map((c) => aggregate(c, scans));

    // Primary value event — one report generated.
    await Actor.charge('report-generated');

    const kv = await KeyValueStore.open();
    const base = `acr-report-${new Date().toISOString().slice(0, 10)}`;
    const md = buildMarkdown(input, edition, level, scans, rows);

    if (formats.includes('md')) {
        await kv.setValue(`${base}.md`, md, { contentType: 'text/markdown' });
    }
    if (formats.includes('docx')) {
        const docx = await buildDocx(input, edition, level, rows);
        await kv.setValue(`${base}.docx`, docx, {
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
    }

    // Structured output for agents: one item per criterion.
    await Actor.pushData(rows.map((r) => ({
        sc: r.criterion.sc,
        criterion: r.criterion.name,
        level: r.criterion.level,
        en301549Clause: r.criterion.en301549,
        verdict: r.verdict,
        violations: r.violationCount,
        incompleteChecks: r.incompleteCount,
        notes: r.findings.length ? r.findings.map((f) => `${f.id}: ${f.help} (${f.pageUrl})`) : [],
    })));

    const failed = rows.filter((r) => r.verdict === 'Does Not Support').length;
    const notEvaluated = rows.filter((r) => r.verdict === 'Not Evaluated').length;
    log.info(
        `Draft ACR ready: ${base}.md/.docx — ${rows.length} criteria, ` +
        `${failed} not supported (automated), ${notEvaluated} requiring full manual assessment.`,
    );
}

// Don't start the Actor when imported by the vitest suite.
if (!process.env.VITEST) {
    void Actor.main(run);
}
