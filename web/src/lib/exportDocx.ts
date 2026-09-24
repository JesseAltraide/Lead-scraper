import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
} from "docx";
import { LEAD_TABS, TAB_LABEL, VERDICT_LABEL, type FilterResult } from "./leadDisplay";
import { PIECE_KEYS, PIECE_LABELS, type PieceKey } from "./drafts";
import type { DraftPiece, DraftVersion } from "./drafts";

/**
 * Builds the exported Word document, pure and I/O-free — no Supabase client,
 * no request/response, so it can be tested (or reused for a different export
 * trigger later) without standing up a route.
 *
 * Mirrors the leads page's own three-tab structure (Qualified / Not sure /
 * Not qualified) rather than inventing a different grouping, since that is
 * already the shape the reviewer is used to looking at.
 */

type Lead = {
  id: string;
  company_name: string;
  domain: string;
  status: string;
  confidence: number;
  confidence_basis: string;
  fit_reasons: string[];
  concerns: string[];
  source_urls: string[];
  source_summary: string;
};

export type ExportData = {
  runLabel: string;
  leads: Lead[];
  filtersByLead: Map<string, FilterResult[]>;
  piecesByLead: Map<string, DraftPiece[]>;
  versionsByPiece: Map<string, DraftVersion[]>;
};

const HEADING_COLOR = "1A1A1A";
const MUTED_COLOR = "555555";

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level, spacing: { before: 320, after: 160 } });
}

function muted(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, color: MUTED_COLOR, size: 18 })],
    spacing: { after: 120 },
  });
}

function body(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text })], spacing: { after: 120 } });
}

function labeledLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun({ text: value })],
    spacing: { after: 80 },
  });
}

function chosenVersion(versions: DraftVersion[]): DraftVersion | undefined {
  return versions.find((v) => v.is_chosen);
}

function draftSection(pieces: DraftPiece[], versionsByPiece: Map<string, DraftVersion[]>): Paragraph[] {
  const paras: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "Outreach drafts", bold: true, size: 20 })],
      spacing: { before: 120, after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } },
    }),
  ];

  for (const key of PIECE_KEYS) {
    const piece = pieces.find((p) => p.piece_key === key);
    if (!piece) continue;
    const versions = versionsByPiece.get(piece.id) ?? [];
    const chosen = chosenVersion(versions);
    if (!chosen) continue;

    paras.push(
      new Paragraph({
        children: [new TextRun({ text: PIECE_LABELS[key as PieceKey], bold: true, size: 19 })],
        spacing: { before: 140, after: 60 },
      }),
    );
    if (chosen.subject) paras.push(labeledLine("Subject", chosen.subject));
    paras.push(body(chosen.body));
    paras.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Personalization: ${chosen.personalization_note}${
              chosen.citation_source_url ? ` — ${chosen.citation_source_url}` : ""
            }`,
            italics: true,
            color: MUTED_COLOR,
            size: 17,
          }),
        ],
        spacing: { after: 100 },
      }),
    );
  }

  return paras;
}

function leadSection(
  lead: Lead,
  filters: FilterResult[],
  pieces: DraftPiece[],
  versionsByPiece: Map<string, DraftVersion[]>,
): Paragraph[] {
  const paras: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: lead.company_name, bold: true, size: 24, color: HEADING_COLOR }),
        new TextRun({ text: `  (${lead.domain})`, color: MUTED_COLOR, size: 18 }),
      ],
      spacing: { before: 280, after: 60 },
    }),
    labeledLine("Confidence", `${lead.confidence}/100 — ${lead.confidence_basis}`),
  ];

  if (lead.source_summary) paras.push(muted(lead.source_summary));

  if (filters.length > 0) {
    paras.push(
      new Paragraph({
        children: [new TextRun({ text: "Hard filters", bold: true, size: 19 })],
        spacing: { before: 100, after: 60 },
      }),
    );
    for (const f of filters) {
      paras.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({ text: `${VERDICT_LABEL[f.verdict]}: `, bold: true }),
            new TextRun({ text: f.filter_text }),
            ...(f.evidence ? [new TextRun({ text: ` — ${f.evidence}`, color: MUTED_COLOR })] : []),
          ],
        }),
      );
    }
  }

  if (lead.fit_reasons.length) paras.push(labeledLine("Fit", lead.fit_reasons.join("; ")));
  if (lead.concerns.length) paras.push(labeledLine("Concerns", lead.concerns.join("; ")));

  if (lead.status === "qualified") {
    paras.push(...draftSection(pieces, versionsByPiece));
  }

  return paras;
}

export function buildLeadsDocument(data: ExportData): Document {
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: data.runLabel, bold: true, size: 32 })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported ${new Date().toLocaleDateString()} — drafts are for review, nothing here has been sent.`,
          italics: true,
          color: MUTED_COLOR,
          size: 18,
        }),
      ],
      spacing: { after: 200 },
      alignment: AlignmentType.LEFT,
    }),
  ];

  for (const tab of LEAD_TABS) {
    const tabLeads = data.leads.filter((l) => l.status === tab);
    children.push(heading(`${TAB_LABEL[tab]} (${tabLeads.length})`, HeadingLevel.HEADING_1));
    if (tabLeads.length === 0) {
      children.push(muted("None."));
      continue;
    }
    for (const lead of tabLeads) {
      children.push(
        ...leadSection(
          lead,
          data.filtersByLead.get(lead.id) ?? [],
          data.piecesByLead.get(lead.id) ?? [],
          data.versionsByPiece,
        ),
      );
    }
  }

  return new Document({ sections: [{ children }] });
}

export async function renderLeadsDocx(data: ExportData): Promise<Buffer> {
  const doc = buildLeadsDocument(data);
  return Packer.toBuffer(doc);
}
