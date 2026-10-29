/**
 * PPTX (Microsoft PowerPoint) export, written by hand as OOXML in a zip
 * (fflate). Each page becomes a slide at the design's aspect ratio. Text
 * boxes that PowerPoint can show as they are (no effect, curve or gradient)
 * stay editable text with their font, size, colour, alignment, bold, italic,
 * underline, strikethrough, letter spacing and lists; every other element,
 * and a non-solid background, becomes a positioned picture drawn by the
 * renderer. Page notes become speaker notes.
 *
 * `buildPptx` is the pure writer (a slide model in, zip bytes out);
 * `exportPptx` maps a Doc onto that model with the renderer.
 */
import { zipSync, strToU8 } from 'fflate';
import type { Doc, Element, ImageElement, TextElement, TextStyle, VideoElement } from '@digital-canvas/scene';
import type { Renderer } from './renderer.ts';
import { loadPicture, textNeedsRaster, type VectorExportOptions } from './svgexport.ts';

// ---- the model ----

export interface PptxRun {
  text: string;
  font: string;
  /** Points. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** `#rrggbb` or `#rrggbbaa`. */
  color: string;
  /** Extra opacity on top of the colour's alpha, 0..1. */
  opacity?: number;
  /** Letter spacing, points. */
  spacing?: number;
  caps?: boolean;
}

export interface PptxParagraph {
  align: 'left' | 'center' | 'right' | 'justify';
  /** Multiple of the font size between baselines (our line height). */
  lineHeight?: number;
  bullet?: 'bullet' | 'number';
  runs: PptxRun[];
  /** Size (pt) of an empty paragraph. */
  size?: number;
}

/** Boxes are in design px (96 per inch); the writer scales them to the slide. */
export interface PptxBox { x: number; y: number; w: number; h: number; rotation?: number; flipH?: boolean; flipV?: boolean }

export type PptxItem =
  | ({ kind: 'picture'; png: Uint8Array; name?: string } & PptxBox)
  | ({ kind: 'text'; paragraphs: PptxParagraph[]; name?: string } & PptxBox);

export interface PptxSlide {
  /** Solid background colour (`#rrggbb`). */
  background?: string;
  items: PptxItem[];
  notes?: string;
}

export interface PptxDeck {
  /** Design size, px. */
  width: number;
  height: number;
  title?: string;
  slides: PptxSlide[];
}

// ---- the writer ----

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** PowerPoint's slide size limits: 1 in to 56 in. */
const EMU_PX = 9525;
const MAX_EMU = 51206400, MIN_EMU = 914400;

export const xmlEscape = (s: string): string =>
  s.replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hexColor(c: string): { hex: string; alpha: number } {
  let h = c.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  const hex = (h.slice(0, 6) || '000000').toUpperCase().padEnd(6, '0');
  const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { hex, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

function rels(list: { id: string; type: string; target: string }[]): string {
  return `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : `${REL}/${r.type}`}" Target="${xmlEscape(r.target)}"/>`).join('')}</Relationships>`;
}

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

function theme(name: string): string {
  const sys = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const fonts = '<a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/>';
  return `${HEAD}<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements>`
    + `<a:clrScheme name="Office">${sys('dk1', '000000')}${sys('lt1', 'FFFFFF')}${sys('dk2', '44546A')}${sys('lt2', 'E7E6E6')}${sys('accent1', '4472C4')}${sys('accent2', 'ED7D31')}${sys('accent3', 'A5A5A5')}${sys('accent4', 'FFC000')}${sys('accent5', '5B9BD5')}${sys('accent6', '70AD47')}${sys('hlink', '0563C1')}${sys('folHlink', '954F72')}</a:clrScheme>`
    + `<a:fontScheme name="Office"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Office"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>`
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

/** Build the .pptx file. */
export function buildPptx(deck: PptxDeck): Uint8Array {
  // EMU per design px, shrunk (never stretched) to PowerPoint's limits
  const big = Math.max(deck.width, deck.height) * EMU_PX, small = Math.min(deck.width, deck.height) * EMU_PX;
  const k = EMU_PX * (big > MAX_EMU ? MAX_EMU / big : small < MIN_EMU ? Math.min(MIN_EMU / small, MAX_EMU / big) : 1);
  const emu = (v: number) => Math.round(v * k);
  /** Design pt (0.75 per px) to slide pt. */
  const pt = (v: number) => (v * k) / EMU_PX;
  const cx = emu(deck.width), cy = emu(deck.height);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {};
  const put = (name: string, xml: string) => (files[name] = [strToU8(xml), { level: 6 }]);
  const hasNotes = deck.slides.some((s) => s.notes?.trim());
  const overrides: string[] = [];
  const over = (part: string, type: string) => overrides.push(`<Override PartName="/${part}" ContentType="${type}"/>`);

  const xfrm = (b: PptxBox) => `<a:xfrm${b.rotation ? ` rot="${Math.round((((b.rotation % 360) + 360) % 360) * 60000)}"` : ''}${b.flipH ? ' flipH="1"' : ''}${b.flipV ? ' flipV="1"' : ''}><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${Math.max(1, emu(b.w))}" cy="${Math.max(1, emu(b.h))}"/></a:xfrm>`;
  const runXml = (r: PptxRun) => {
    const { hex, alpha } = hexColor(r.color);
    const a = Math.max(0, Math.min(1, alpha * (r.opacity ?? 1)));
    const attrs = [`lang="en-US"`, `sz="${Math.max(100, Math.round(pt(r.size) * 100))}"`, r.bold ? 'b="1"' : 'b="0"', r.italic ? 'i="1"' : 'i="0"',
      r.underline ? 'u="sng"' : '', r.strike ? 'strike="sngStrike"' : '', r.spacing ? `spc="${Math.round(pt(r.spacing) * 100)}"` : '', r.caps ? 'cap="all"' : '', 'dirty="0"'].filter(Boolean).join(' ');
    const font = xmlEscape(r.font);
    return `<a:r><a:rPr ${attrs}><a:solidFill>${a < 0.999 ? `<a:srgbClr val="${hex}"><a:alpha val="${Math.round(a * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${hex}"/>`}</a:solidFill><a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${xmlEscape(r.text)}</a:t></a:r>`;
  };
  const paraXml = (p: PptxParagraph) => {
    const algn = p.align === 'center' ? 'ctr' : p.align === 'right' ? 'r' : p.align === 'justify' ? 'just' : 'l';
    const first = p.runs[0]?.size ?? p.size ?? 12;
    // PowerPoint's 100 % is about 1.2 × the font size
    const ln = p.lineHeight ? `<a:lnSpc><a:spcPct val="${Math.round((p.lineHeight / 1.2) * 100000)}"/></a:lnSpc>` : '';
    const ind = p.bullet ? ` marL="${emu(first * 1.6 / 0.75)}" indent="-${emu(first * 1.6 / 0.75)}"` : '';
    const bu = p.bullet === 'bullet' ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : p.bullet === 'number' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : '<a:buNone/>';
    const end = `<a:endParaRPr lang="en-US" sz="${Math.max(100, Math.round(pt(p.size ?? first) * 100))}" dirty="0"/>`;
    return `<a:p><a:pPr algn="${algn}"${ind}>${ln}${bu}</a:pPr>${p.runs.filter((r) => r.text).map(runXml).join('')}${end}</a:p>`;
  };

  const slideIds: string[] = [];
  const presRels = [
    { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
    { id: 'rId3', type: 'presProps', target: 'presProps.xml' },
    { id: 'rId4', type: 'viewProps', target: 'viewProps.xml' },
    { id: 'rId5', type: 'tableStyles', target: 'tableStyles.xml' },
  ];
  if (hasNotes) presRels.push({ id: 'rId6', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
  let media = 0;
  deck.slides.forEach((slide, i) => {
    const n = i + 1;
    const srels: { id: string; type: string; target: string }[] = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    let shapeId = 2;
    const body = slide.items.map((it) => {
      const id = shapeId++;
      const name = xmlEscape(it.name ?? (it.kind === 'text' ? `Text ${id}` : `Picture ${id}`));
      if (it.kind === 'picture') {
        const rid = `rId${srels.length + 1}`;
        const file = `image${++media}.png`;
        files[`ppt/media/${file}`] = [it.png, { level: 0 }];
        srels.push({ id: rid, type: 'image', target: `../media/${file}` });
        return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      }
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(it)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
        + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${(it.paragraphs.length ? it.paragraphs : [{ align: 'left', runs: [] } as PptxParagraph]).map(paraXml).join('')}</p:txBody></p:sp>`;
    }).join('');
    const bg = slide.background ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hexColor(slide.background).hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : '';
    put(`ppt/slides/slide${n}.xml`, `${HEAD}<p:sld ${NS}><p:cSld>${bg}<p:spTree>${GROUP}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    over(`ppt/slides/slide${n}.xml`, `${CT}.slide+xml`);
    const notes = slide.notes?.trim();
    if (notes) {
      srels.push({ id: `rId${srels.length + 1}`, type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` });
      const paras = notes.split(/\r?\n/).map((l) => `<a:p>${l ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(l)}</a:t></a:r>` : ''}</a:p>`).join('');
      put(`ppt/notesSlides/notesSlide${n}.xml`, `${HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}`
        + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
        + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`
        + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>');
      put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, rels([
        { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
        { id: 'rId2', type: 'slide', target: `../slides/slide${n}.xml` },
      ]));
      over(`ppt/notesSlides/notesSlide${n}.xml`, `${CT}.notesSlide+xml`);
    }
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(srels));
    const rid = `rId${100 + n}`;
    presRels.push({ id: rid, type: 'slide', target: `slides/slide${n}.xml` });
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
  });

  put('ppt/presentation.xml', `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst>' : ''}<p:sldIdLst>${slideIds.join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
  put('ppt/_rels/presentation.xml.rels', rels(presRels));
  put('ppt/slideMasters/slideMaster1.xml', `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>`
    + `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([
    { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
  ]));
  put('ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
  put('ppt/theme/theme1.xml', theme('Digital Canvas'));
  if (hasNotes) {
    put('ppt/notesMasters/notesMaster1.xml', `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}`
      + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>'
      + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>'
      + `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/></p:notesMaster>`);
    put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]));
    put('ppt/theme/theme2.xml', theme('Notes'));
    over('ppt/notesMasters/notesMaster1.xml', `${CT}.notesMaster+xml`);
    over('ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
  }
  put('ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`);
  put('ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  put('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  put('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${xmlEscape(deck.title ?? '')}</dc:title><dc:creator>Digital Canvas</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  put('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Digital Canvas</Application><PresentationFormat>Custom</PresentationFormat><Slides>${deck.slides.length}</Slides></Properties>`);
  put('_rels/.rels', rels([
    { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
    { id: 'rId3', type: 'extended-properties', target: 'docProps/app.xml' },
  ]));
  over('ppt/presentation.xml', `${CT}.presentation.main+xml`);
  over('ppt/slideMasters/slideMaster1.xml', `${CT}.slideMaster+xml`);
  over('ppt/slideLayouts/slideLayout1.xml', `${CT}.slideLayout+xml`);
  over('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml');
  over('ppt/presProps.xml', `${CT}.presProps+xml`);
  over('ppt/viewProps.xml', `${CT}.viewProps+xml`);
  over('ppt/tableStyles.xml', `${CT}.tableStyles+xml`);
  over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml');
  over('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
  // [Content_Types].xml first, like Office writes it
  const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join('')}</Types>`;
  return zipSync({ '[Content_Types].xml': [strToU8(types), { level: 6 }], ...files });
}

// ---- from a Doc ----

export interface PptxOptions extends VectorExportOptions {
  /** Page ids, in order (default: all visible pages). */
  pages?: string[];
  /** Page notes as speaker notes (default true). */
  notes?: boolean;
}

/** True when PowerPoint can show this text box as editable text. */
export const textMapsToPptx = (el: TextElement): boolean => !textNeedsRaster(el) && !el.gradient;

/** A text box as PowerPoint paragraphs (runs split at line breaks). */
export function textParagraphs(el: TextElement): PptxParagraph[] {
  const base = el.style;
  const runs = el.runs?.length ? el.runs : [{ text: el.text }];
  const paras: PptxParagraph[] = [];
  const para = (): PptxParagraph => ({ align: base.align, lineHeight: base.lineHeight || undefined, bullet: el.list, runs: [], size: base.fontSize * 0.75 });
  let cur = para();
  for (const r of runs) {
    const st: TextStyle = { ...base, ...(r.style ?? {}) };
    const lines = r.text.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) { paras.push(cur); cur = para(); }
      if (line) cur.runs.push({
        text: line, font: st.fontFamily, size: st.fontSize * 0.75, bold: st.bold, italic: st.italic, underline: st.underline, strike: st.strike,
        color: st.color, opacity: el.opacity < 1 ? el.opacity : undefined, spacing: st.letterSpacing ? st.letterSpacing * 0.75 : undefined, caps: st.uppercase || undefined,
      });
    });
  }
  paras.push(cur);
  return paras;
}

/** Groups keep their children in page coordinates: export the children (the group's opacity carried down). */
function ungroup(els: readonly Element[]): Exclude<Element, { type: 'group' }>[] {
  return els.flatMap((e) => (e.type === 'group'
    ? ungroup(e.children.map((c) => ({ ...c, opacity: c.opacity * e.opacity, hidden: c.hidden || e.hidden })))
    : [e as Exclude<Element, { type: 'group' }>]));
}

/** The deck model for a design (each non-text element drawn as a picture by the renderer). */
export function pptxDeck(renderer: Renderer, doc: Doc, opts: PptxOptions): PptxDeck {
  const pages = opts.pages ? opts.pages.map((id) => doc.pages.find((p) => p.id === id)!).filter(Boolean) : doc.pages.filter((p) => !p.hidden);
  const slides: PptxSlide[] = pages.map((page) => {
    const items: PptxItem[] = [];
    let background: string | undefined;
    if (page.background.type === 'solid') background = page.background.color;
    else {
      const s = Math.min(2, 3000 / Math.max(doc.width, doc.height));
      items.push({ kind: 'picture', name: 'Background', png: renderer.exportPage(doc, { ...page, elements: [] }, { format: 'png', scale: s }), x: 0, y: 0, w: doc.width, h: doc.height });
    }
    for (const el of ungroup(page.elements)) {
      if (el.hidden || el.opacity <= 0) continue;
      if (el.type === 'text' && textMapsToPptx(el)) {
        items.push({ kind: 'text', name: el.name, x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation, flipH: el.flipX, flipV: el.flipY, paragraphs: textParagraphs(el) });
        continue;
      }
      if (el.type === 'image' || el.type === 'video') loadPicture(renderer, el as ImageElement | VideoElement, opts.assets);
      const r = renderer.rasterElement(el, Math.max(1, Math.min(2, 3000 / Math.max(el.w, el.h, 1))));
      if (r) items.push({ kind: 'picture', name: el.name, png: r.png, x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return { background, items, notes: opts.notes === false ? undefined : page.notes };
  });
  return { width: doc.width, height: doc.height, title: doc.title, slides };
}

export function exportPptx(renderer: Renderer, doc: Doc, opts: PptxOptions): Uint8Array {
  return buildPptx(pptxDeck(renderer, doc, opts));
}
