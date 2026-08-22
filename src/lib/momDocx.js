// Builds the Minutes of the Meeting as a real .docx file, laid out to match
// the MENDORO MOM-Template_MM_DD_YY.docx letterhead (BSU seal + MENDORO logo,
// Date/Time/Venue/Presiding Officer/Attendees block, roman-numeral Agenda and
// Minutes of Proceedings, Committee Assignments, Important Deadlines,
// Adjournment line, and the Prepared by / Reviewed by / Noted by sign-off).
//
// There is no separate "template file" involved at runtime — this generator
// *is* the template, reproduced in code so every field from the New Meeting
// form lands in the same place every time a MOM is created.

import mendoroLogoUrl from '../assets/mom/mendoro-logo.png';
import bsuSealUrl from '../assets/mom/bsu-seal.png';
import { formatMeetingDate, formatTime12h } from './momOps';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const toRomanLabel = (i) => ROMAN[i] || String(i + 1);

async function loadImageBytes(url) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function buildMeetingNoteDocx(note, { adviserName, adviserTitle } = {}) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    AlignmentType,
    Header,
    ImageRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    VerticalAlign
  } = await import('docx');

  const [mendoroLogo, bsuSeal] = await Promise.all([
    loadImageBytes(mendoroLogoUrl),
    loadImageBytes(bsuSealUrl)
  ]);

  const notedByName = (note.noted_by || adviserName || 'NELSON A. POLITCHAY').toUpperCase();
  const notedByTitle = note.noted_by_title || adviserTitle || 'Adviser, MENDORO';

  // Single font/size used for every run in the document — Arial, 11pt.
  // docx sizes are in half-points, so 11pt = 22.
  const FONT = 'Arial';
  const SIZE = 22;
  const baseRun = { font: FONT, size: SIZE };

  // Usable width = page width (12240) minus left/right margins (1440 each).
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cellBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  const logoColWidth = 1400;
  const textColWidth = 9360 - logoColWidth * 2;

  // Circular BSU seal on the left, the MENDORO logo on the right, header
  // text centered between them — all on a single line.
  const headerTable = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [logoColWidth, textColWidth, logoColWidth],
    borders: { ...cellBorders, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: logoColWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: cellBorders,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ type: 'png', data: bsuSeal, transformation: { width: 70, height: 70 } })]
              })
            ]
          }),
          new TableCell({
            width: { size: textColWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: cellBorders,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Benguet State University', bold: true, ...baseRun })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Office of the Student Services', ...baseRun })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'Student Housing Unit', ...baseRun })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "MEN'S DORMITORY ORGANIZATION", bold: true, ...baseRun })]
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '(MENDORO)', bold: true, ...baseRun })]
              })
            ]
          }),
          new TableCell({
            width: { size: logoColWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            borders: cellBorders,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ type: 'png', data: mendoroLogo, transformation: { width: 55, height: 73 } })]
              })
            ]
          })
        ]
      })
    ]
  });

  const header = new Header({ children: [headerTable, new Paragraph({ spacing: { after: 120 }, children: [] })] });

  function labeledLine(label, value) {
    return new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `${label}: `, bold: true, ...baseRun }),
        new TextRun({ text: value || '', ...baseRun })
      ]
    });
  }

  // A thin rule under a section, used to visually separate every section of
  // the document (Attendees, Agenda, Minutes of Proceedings, Committee
  // Assignments, Important Deadlines, Adjournment).
  function divider() {
    return new Paragraph({
      spacing: { before: 120, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: 'B0895A' } },
      children: []
    });
  }

  const body = [];

  body.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'MINUTES OF THE MEETING', bold: true, ...baseRun })]
    })
  );

  body.push(labeledLine('Date', formatMeetingDate(note.meeting_date)));
  body.push(labeledLine('Time', formatTime12h(note.meeting_time)));
  body.push(labeledLine('Venue', note.venue));
  body.push(labeledLine('Presiding Officer', note.presiding_officer));
  body.push(
    labeledLine(
      'Attendees',
      `${note.attendees_count ?? 0} MENDORO Officers (refer to attendance sheet)`
    )
  );
  body.push(divider());

  body.push(
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'AGENDA', bold: true, ...baseRun })] })
  );
  (note.agenda || []).forEach((item, i) => {
    body.push(
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `${toRomanLabel(i)}.  ${item}`, ...baseRun })] })
    );
  });
  body.push(divider());

  body.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: 'MINUTES OF PROCEEDINGS', bold: true, ...baseRun })]
    })
  );
  (note.minutes || []).forEach((section) => {
    body.push(
      new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new TextRun({ text: `${section.roman}. ${section.title}`, bold: true, ...baseRun })]
      })
    );
    body.push(
      new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: section.content || '(no notes recorded)', ...baseRun })] })
    );
  });
  body.push(divider());

  const activeCommittees = Object.entries(note.committee_assignments || {}).filter(([, v]) => v?.selected);
  if (activeCommittees.length) {
    body.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: 'COMMITTEE ASSIGNMENTS', bold: true, ...baseRun })]
      })
    );
    activeCommittees.forEach(([committee, v]) => {
      body.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: `${committee.toUpperCase()}: `, bold: true, ...baseRun }),
            new TextRun({ text: v.instructions || '', ...baseRun })
          ]
        })
      );
    });
    body.push(divider());
  }

  const deadlines = (note.deadlines || []).filter((d) => d.text?.trim());
  if (deadlines.length) {
    body.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: 'IMPORTANT DEADLINES', bold: true, ...baseRun })]
      })
    );
    deadlines.forEach((d) => {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [
            new TextRun({ text: d.text, ...baseRun }),
            new TextRun({ text: d.date ? `  —  ${formatMeetingDate(d.date)}` : '', italics: true, ...baseRun })
          ]
        })
      );
    });
    body.push(divider());
  }

  body.push(
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'ADJOURNMENT', bold: true, ...baseRun })] })
  );
  body.push(
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'There being no further business to discuss, the meeting was formally adjourned at ', ...baseRun }),
        new TextRun({ text: formatTime12h(note.adjournment_time) || '____________', bold: true, ...baseRun }),
        new TextRun({
          text: '. All officers were reminded of their respective responsibilities and the tasks agreed upon during the meeting.',
          ...baseRun
        })
      ]
    })
  );
  body.push(divider());

  // Sign-off block: label, then a blank line, then the name and position —
  // matches the "Prepared by: <blank line> NAME / position" layout.
  function signOff(label, name, role) {
    body.push(new Paragraph({ spacing: { before: 300, after: 0 }, children: [new TextRun({ text: `${label}:`, ...baseRun })] }));
    body.push(new Paragraph({ spacing: { after: 0 }, children: [] })); // blank line
    body.push(
      new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({ text: (name || '_______________').toUpperCase(), bold: true, ...baseRun })]
      })
    );
    body.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: role, ...baseRun })] }));
  }

  signOff('Prepared by', note.prepared_by, 'Assistant Secretary, MENDORO');
  signOff('Reviewed by', note.reviewed_by, 'President/Vice President, MENDORO');
  signOff('Noted/Attested by', notedByName, notedByTitle);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 20160 }, // 8.5" x 14" (long bond paper), matches the template
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 706 }
          }
        },
        headers: { default: header },
        children: body
      }
    ]
  });

  return Packer.toBlob(doc);
}
