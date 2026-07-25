/**
 * Evidence Generation — builds the human-readable report the PRD calls for
 * (exact timestamp, requested URL, injected script/tracker, contradicting
 * policy clause). Built as a .docx via the `docx` package (already a
 * dependency for the tracked-changes feature) then rendered to PDF through
 * the same LibreOffice pipeline used for document uploads, so no new
 * PDF-writing dependency is needed.
 */

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    AlignmentType,
} from "docx";
import { docxToPdf } from "../convert";
import type { Severity } from "./discrepancyEngine";

export interface ReportCommitment {
    clause_type: string;
    extracted_text: string;
    rule_key: string;
    machine_rule: boolean;
    source_url: string | null;
}

export interface ReportEvidence {
    consent_state: string;
    tracker_domain: string;
    tracker_owner: string | null;
    tracker_category: string;
    payload_type: string;
    data_transmitted: string | null;
    request_url: string | null;
    occurred_at: string;
}

export interface ReportFlag {
    severity: Severity;
    regulatory_flags: string[];
    violation_summary: string;
    potential_claim_value: number | null;
}

export interface ReportInput {
    domain: string;
    scannedAt: string;
    privacyPolicyUrl: string | null;
    commitments: ReportCommitment[];
    evidence: ReportEvidence[];
    flags: ReportFlag[];
}

const CELL_MARGIN = { top: 80, bottom: 80, left: 100, right: 100 };
const noBorder = { style: BorderStyle.SINGLE, size: 2, color: "D0D0D0" };
const cellBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function headerCell(text: string, widthPct: number): TableCell {
    return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        borders: cellBorders,
        shading: { fill: "1F2937" },
        children: [
            new Paragraph({
                children: [new TextRun({ text, bold: true, color: "FFFFFF", size: 18 })],
            }),
        ],
    });
}

function bodyCell(text: string, widthPct: number): TableCell {
    return new TableCell({
        width: { size: widthPct, type: WidthType.PERCENTAGE },
        margins: CELL_MARGIN,
        borders: cellBorders,
        children: [new Paragraph({ children: [new TextRun({ text: text || "—", size: 18 })] })],
    });
}

function severityLabel(s: Severity): string {
    return s === "HIGH" ? "HIGH" : s === "MEDIUM" ? "MEDIUM" : "LOW";
}

export async function buildEvidenceReportPdf(input: ReportInput): Promise<Buffer> {
    const totalClaimValue = input.flags.reduce((sum, f) => sum + (f.potential_claim_value ?? 0), 0);
    const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of input.flags) bySeverity[f.severity]++;

    const children: (Paragraph | Table)[] = [
        new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: "PrivacyDrift Analyzer — Evidence Report" })],
        }),
        new Paragraph({
            spacing: { after: 200 },
            children: [
                new TextRun({ text: `Domain: `, bold: true }),
                new TextRun({ text: input.domain }),
            ],
        }),
        new Paragraph({
            children: [
                new TextRun({ text: `Scanned: `, bold: true }),
                new TextRun({ text: new Date(input.scannedAt).toISOString() }),
            ],
        }),
        new Paragraph({
            spacing: { after: 200 },
            children: [
                new TextRun({ text: `Privacy policy source: `, bold: true }),
                new TextRun({ text: input.privacyPolicyUrl ?? "not located" }),
            ],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Executive Summary" }),
        new Paragraph({
            spacing: { after: 200 },
            children: [
                new TextRun({
                    text: `${input.flags.length} discrepancy flag(s) — ${bySeverity.HIGH} HIGH, ${bySeverity.MEDIUM} MEDIUM, ${bySeverity.LOW} LOW. Estimated aggregate potential claim value: £${totalClaimValue.toLocaleString()} (rough statutory-damages triage figure — not legal advice; verify against current case law before relying on it).`,
                }),
            ],
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Discrepancy Flags" }),
    ];

    if (input.flags.length === 0) {
        children.push(new Paragraph({ text: "No discrepancies detected between the stated policy and observed technical behavior." }));
    } else {
        const rows = [
            new TableRow({
                tableHeader: true,
                children: [
                    headerCell("Severity", 10),
                    headerCell("Summary", 50),
                    headerCell("Regulatory flags", 25),
                    headerCell("Est. value", 15),
                ],
            }),
            ...input.flags.map(
                (f) =>
                    new TableRow({
                        children: [
                            bodyCell(severityLabel(f.severity), 10),
                            bodyCell(f.violation_summary, 50),
                            bodyCell(f.regulatory_flags.join(", "), 25),
                            bodyCell(f.potential_claim_value ? `£${f.potential_claim_value}` : "—", 15),
                        ],
                    }),
            ),
        ];
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    }

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Extracted Policy Commitments", spacing: { before: 300 } }));
    if (input.commitments.length === 0) {
        children.push(new Paragraph({ text: "No machine-readable commitments could be extracted from the located policy text." }));
    } else {
        const rows = [
            new TableRow({
                tableHeader: true,
                children: [headerCell("Clause", 20), headerCell("Claim", 55), headerCell("Quoted text", 25)],
            }),
            ...input.commitments.map(
                (c) =>
                    new TableRow({
                        children: [
                            bodyCell(c.clause_type, 20),
                            bodyCell(`${c.rule_key} = ${c.machine_rule ? "true (does happen)" : "false (does not happen)"}`, 55),
                            bodyCell(c.extracted_text, 25),
                        ],
                    }),
            ),
        ];
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    }

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: "Technical Evidence Log", spacing: { before: 300 } }));
    if (input.evidence.length === 0) {
        children.push(new Paragraph({ text: "No third-party trackers were captured during the scan." }));
    } else {
        const rows = [
            new TableRow({
                tableHeader: true,
                children: [
                    headerCell("Consent state", 12),
                    headerCell("Tracker", 22),
                    headerCell("Type", 12),
                    headerCell("Data indicators", 24),
                    headerCell("Request URL", 30),
                ],
            }),
            ...input.evidence.map(
                (e) =>
                    new TableRow({
                        children: [
                            bodyCell(e.consent_state, 12),
                            bodyCell(`${e.tracker_owner ?? e.tracker_domain} (${e.tracker_category})`, 22),
                            bodyCell(e.payload_type, 12),
                            bodyCell(e.data_transmitted ?? "", 24),
                            bodyCell(e.request_url ?? "", 30),
                        ],
                    }),
            ),
        ];
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    }

    children.push(
        new Paragraph({
            spacing: { before: 400 },
            alignment: AlignmentType.LEFT,
            children: [
                new TextRun({
                    italics: true,
                    size: 16,
                    color: "666666",
                    text: "Generated automatically by PrivacyDrift Analyzer by observing publicly-served network traffic from a normal browser visit. This report documents technical findings for investigative purposes and is not a substitute for independent legal advice.",
                }),
            ],
        }),
    );

    const doc = new Document({ sections: [{ children }] });
    const docxBuffer = await Packer.toBuffer(doc);
    return docxToPdf(docxBuffer);
}
