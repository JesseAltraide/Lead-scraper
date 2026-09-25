import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
} from "docx";
import { LEAD_TABS, TAB_LABEL } from "./leadDisplay";
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
};

export type ExportData = {
  runLabel: string;
  leads: Lead[];
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

// Only a REVIEWED chosen version is exported — an unreviewed draft is still
// an unverified AI first pass, not something ready to leave this app. Matches
// the same reviewed gate the leads page and export route use to decide
// whether exporting is available at all, applied here per piece.
function chosenReviewedVersion(versions: DraftVersion[]): DraftVersion | undefined {
  return versions.find((v) => v.is_chosen && v.reviewed);
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
    const chosen = chosenReviewedVersion(versions);
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
              chosen.citation_source_url ? ` (${chosen.citation_source_url})` : ""
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

// The export is deliberately just a name and the drafts to send — not the
// full review evidence (confidence, hard filters, fit/concerns, sources),
// which stays on the leads page for the person deciding whether to act.
function leadSection(
  lead: Lead,
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
  ];

  paras.push(...draftSection(pieces, versionsByPiece));

  return paras;
}

// A piece row can exist without a chosen version yet (claimed, or the write
// failed), and a chosen version can still be unreviewed — only a REVIEWED
// chosen version is actually a draft worth exporting.
function hasReviewedDraft(pieces: DraftPiece[], versionsByPiece: Map<string, DraftVersion[]>): boolean {
  return pieces.some((p) => (versionsByPiece.get(p.id) ?? []).some((v) => v.is_chosen && v.reviewed));
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
          text: `Exported ${new Date().toLocaleDateString()}. Drafts are for review, nothing here has been sent.`,
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
    // Only a lead with at least one REVIEWED chosen draft version is worth
    // exporting — the file is meant to be handed to someone as ready-to-send
    // copy someone has actually looked at, not a database dump of whatever
    // the agent wrote, so a lead with no reviewed draft yet has nothing to
    // show here.
    const tabLeads = data.leads.filter(
      (l) => l.status === tab && hasReviewedDraft(data.piecesByLead.get(l.id) ?? [], data.versionsByPiece),
    );
    children.push(heading(`${TAB_LABEL[tab]} (${tabLeads.length})`, HeadingLevel.HEADING_1));
    if (tabLeads.length === 0) {
      children.push(muted("None."));
      continue;
    }
    for (const lead of tabLeads) {
      children.push(
        ...leadSection(lead, data.piecesByLead.get(lead.id) ?? [], data.versionsByPiece),
      );
    }
  }

  return new Document({ sections: [{ children }] });
}

export async function renderLeadsDocx(data: ExportData): Promise<Buffer> {
  const doc = buildLeadsDocument(data);
  return Packer.toBuffer(doc);
}
