/* Scripts: state -> one layout -> Word document.xml and the on-screen preview.
   Word package and styles come from the CA Cantonese Script Template. */
var ScriptGen = (function () {
  var GAP_BLOCK = 240, GAP_TIGHT = 120, GAP_NONE = 0; // twips after a paragraph

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isWide(ch) {
    var c = ch.codePointAt(0);
    return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x20000);
  }
  // Rough width in twips at 11 pt: full-width 220, others about 125.
  function twips(s) {
    var w = 0;
    for (var ch of String(s)) w += isWide(ch) ? 220 : 125;
    return w;
  }
  function yymmdd(d, sep) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
    return m ? m[1].slice(2) + sep + m[2] + sep + m[3] : "";
  }
  function lines(text) {
    return String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  }
  function cls(s) { return String(s || "").trim().toUpperCase(); }
  // English scripts label an MC by first name ("Tai Man Chan" -> "Tai"), as in the English template.
  function mcLabel(mc) {
    var n = (mc.name || "").trim();
    if (mc.label && mc.label.trim()) return mc.label.trim();
    return /^[A-Za-z][A-Za-z.'-]*\s+\S/.test(n) ? n.split(/\s+/)[0] : n;
  }
  // The script's language follows its content: mostly Latin letters means an English script.
  function isEnglish(state) {
    var s = [state.event].concat(state.blocks.map(function (b) { return b.text; })).join("");
    var cjk = 0, latin = 0;
    for (var ch of s) { if (isWide(ch)) cjk++; else if (/[A-Za-z]/.test(ch)) latin++; }
    return latin > 0 && latin > cjk * 3;
  }
  function named(state) { return state.mcs.filter(function (m) { return (m.name || "").trim(); }); }

  // The name is printed unless the same MC spoke last and no stage direction came between
  // (an award list does not break the run), as in the CA Script Template.
  function speakers(state) {
    var ids = named(state).map(function (m) { return m.id; });
    var out = [], last = null, broken = true;
    state.blocks.forEach(function (b) {
      if (!lines(b.text).length) { out.push(null); return; }
      if (b.type === "line") {
        var id = ids.indexOf(b.mc) >= 0 ? b.mc : (ids.length === 1 ? ids[0] : (b.mc === "cont" ? last : null));
        out.push({ mc: id, show: !(id && !broken && last === id) });
        last = id; broken = false;
      } else {
        out.push(null);
        if (b.type === "cue") broken = true;
      }
    });
    return out;
  }

  function awardRows(text) {
    var out = [], last = null;
    lines(text).forEach(function (l) {
      var m = /^(\S+)\s+(.+)$/.exec(l);
      var c = m ? cls(m[1]) : "", name = m ? m[2].trim() : l;
      out.push({ cls: c === last ? "" : c, name: name });
      last = c;
    });
    return out;
  }

  function describe(state) {
    var en = isEnglish(state);
    var colon = en ? ":" : "：";
    var mcs = named(state);
    var byId = {};
    state.mcs.forEach(function (m) { byId[m.id] = m; });
    var date = yymmdd(state.date, "/");
    var title = [state.titleDate || date || "YY/MM/DD", state.event.trim() || (en ? "Event" : "活動名稱"), (en ? "Script" : "講稿")].join(en ? " | " : "｜");
    var heading = mcs.map(function (m) { return (cls(m.cls) + " " + m.name.trim()).trim(); }).join("．");
    var labelWidth = 0;
    mcs.forEach(function (m) { labelWidth = Math.max(labelWidth, twips(mcLabel(m) + colon)); });
    var indent = Math.max(1200, Math.ceil((labelWidth + 200) / 100) * 100);
    var filename = [state.event.trim() || "未命名活動", yymmdd(state.date, "") || "YYMMDD", "講稿"].join(" ") + ".docx";

    var sp = speakers(state);
    var problems = [];
    if (!state.event.trim()) problems.push({ msg: "未填寫活動名稱", target: "event" });
    if (!date) problems.push({ msg: "未選擇日期", target: "date" });
    if (!mcs.length) problems.push({ msg: "未填寫司儀姓名", target: "mc" });
    if (!state.blocks.length) problems.push({ msg: "未有內容", target: "blocks" });
    state.blocks.forEach(function (b, i) {
      if (!lines(b.text).length) problems.push({ msg: "有段落未有內容", target: "block:" + b.id });
      else if (b.type === "line" && sp[i] && !sp[i].mc) problems.push({ msg: "有段落未選擇司儀", target: "block:" + b.id });
    });
    return { en: en, colon: colon, byId: byId, speakers: sp, title: title, heading: heading, indent: indent, filename: filename, problems: problems };
  }

  // One layout for both outputs: a list of paragraphs with their spacing already decided.
  function layout(state) {
    var d = describe(state);
    var paras = [];
    var blocks = [];
    state.blocks.forEach(function (b, i) { if (lines(b.text).length) blocks.push({ b: b, s: d.speakers[i] }); });
    blocks.forEach(function (item, k) {
      var b = item.b, next = blocks[k + 1];
      // Tight gap when the next block continues the same thought: an award list after its lead-in,
      // or the same MC carrying on without a new name.
      var joins = next && (next.b.type === "award" && b.type === "line" || next.b.type === "line" && next.s && !next.s.show && b.type === "line");
      var endGap = !next ? GAP_BLOCK : joins ? GAP_TIGHT : GAP_BLOCK;
      var keepEnd = !!(next && next.b.type === "award" && b.type === "line");
      var ls = lines(b.text);
      if (b.type === "line") {
        var mc = item.s && d.byId[item.s.mc];
        ls.forEach(function (l, j) {
          var last = j === ls.length - 1;
          paras.push({ kind: "line", label: j === 0 && item.s && item.s.show && mc ? mcLabel(mc) + d.colon : "", text: l,
            after: last ? endGap : GAP_TIGHT, keepNext: last && keepEnd, blockId: b.id });
        });
      } else if (b.type === "cue") {
        ls.forEach(function (l, j) {
          var last = j === ls.length - 1;
          paras.push({ kind: "cue", text: l, after: last ? endGap : GAP_TIGHT, keepNext: !last, blockId: b.id });
        });
      } else {
        var rows = awardRows(b.text);
        rows.forEach(function (r, j) {
          var last = j === rows.length - 1;
          paras.push({ kind: "award", cls: r.cls, name: r.name, after: last ? endGap : GAP_NONE, keepNext: !last && rows.length <= 15, blockId: b.id });
        });
      }
    });
    var gaps = {};
    paras.forEach(function (p) { gaps[p.blockId] = p.after; });
    return { d: d, paras: paras, gaps: gaps };
  }

  function t(text) { return '<w:t xml:space="preserve">' + esc(text) + "</w:t>"; }
  var LABEL_RPR = '<w:rPr><w:rFonts w:ascii="Anthropic Serif Text Medium" w:hAnsi="Anthropic Serif Text Medium"/></w:rPr>';

  function bodyXml(state) {
    var L = layout(state), d = L.d, ind = d.indent, awardTab = ind + 1600;
    function ppr(p, extra) {
      return "<w:pPr>" + (extra.style ? '<w:pStyle w:val="' + extra.style + '"/>' : "") + (p.keepNext ? "<w:keepNext/>" : "") +
        (extra.tabs ? '<w:tabs><w:tab w:val="left" w:pos="' + extra.tabs + '"/></w:tabs>' : "") +
        '<w:spacing w:after="' + p.after + '"/>' + extra.ind + "</w:pPr>";
    }
    var x = "";
    x += '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr>' + t(d.title) + "</w:r></w:p>";
    x += '<w:p><w:pPr><w:pStyle w:val="Heading3"/><w:spacing w:after="480"/></w:pPr><w:r>' + t(d.heading) + "</w:r></w:p>";
    // The script body is one borderless table, like the Script Template: MC name | class | text.
    // Tab stops were dropped because viewers other than Word (the iPad preview, Pages) ignore them.
    var TEXT_W = 9026, CLS_W = awardTab - ind, REST_W = TEXT_W - awardTab;
    function cell(w, span, inner) {
      return "<w:tc><w:tcPr><w:tcW w:w=\"" + w + "\" w:type=\"dxa\"/>" + (span > 1 ? "<w:gridSpan w:val=\"" + span + "\"/>" : "") + "</w:tcPr>" + inner + "</w:tc>";
    }
    function para(p, style, runs) { return "<w:p>" + ppr(p, { style: style, ind: "" }) + runs + "</w:p>"; }
    var rows = "";
    L.paras.forEach(function (p) {
      if (p.kind === "line") {
        rows += "<w:tr>" + cell(ind, 1, para(p, null, p.label ? "<w:r>" + LABEL_RPR + t(p.label) + "</w:r>" : "")) +
          cell(TEXT_W - ind, 2, para(p, null, "<w:r>" + t(p.text) + "</w:r>")) + "</w:tr>";
      } else if (p.kind === "cue") {
        rows += "<w:tr>" + cell(ind, 1, para(p, "Caption", "")) + cell(TEXT_W - ind, 2, para(p, "Caption", "<w:r>" + t(p.text) + "</w:r>")) + "</w:tr>";
      } else {
        rows += "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + cell(ind, 1, para(p, null, "")) + cell(CLS_W, 1, para(p, null, p.cls ? "<w:r>" + t(p.cls) + "</w:r>" : "")) +
          cell(REST_W, 1, para(p, null, "<w:r>" + t(p.name) + "</w:r>")) + "</w:tr>";
      }
    });
    var none = "<w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/>";
    if (rows) x += "<w:tbl><w:tblPr><w:tblW w:w=\"" + TEXT_W + "\" w:type=\"dxa\"/><w:tblBorders>" + none + "</w:tblBorders><w:tblLayout w:type=\"fixed\"/>" +
      "<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"0\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"0\" w:type=\"dxa\"/></w:tblCellMar>" +
      "<w:tblLook w:val=\"0000\" w:firstRow=\"0\" w:lastRow=\"0\" w:firstColumn=\"0\" w:lastColumn=\"0\" w:noHBand=\"1\" w:noVBand=\"1\"/></w:tblPr>" +
      "<w:tblGrid><w:gridCol w:w=\"" + ind + "\"/><w:gridCol w:w=\"" + CLS_W + "\"/><w:gridCol w:w=\"" + REST_W + "\"/></w:tblGrid>" + rows + "</w:tbl>";
    var em = '<w:rPr><w:rStyle w:val="Emphasis"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
    // {End of Script} sits at the foot of the last page: a frame anchored to the bottom margin.
    x += '<w:p><w:pPr><w:framePr w:wrap="around" w:vAnchor="margin" w:hAnchor="margin" w:xAlign="center" w:yAlign="bottom"/><w:jc w:val="center"/>' + em + "</w:pPr><w:r>" + em + t("{End of Script}") + "</w:r></w:p>";
    return x;
  }

  function composeDocumentXml(templateXml, body) {
    var start = templateXml.indexOf("<w:body>") + "<w:body>".length;
    var sect = templateXml.lastIndexOf("<w:sectPr");
    return templateXml.slice(0, start) + body + templateXml.slice(sect);
  }

  async function buildDocx(JSZipLib, templateBase64, state) {
    var zip = await JSZipLib.loadAsync(templateBase64, { base64: true });
    var tpl = await zip.file("word/document.xml").async("string");
    zip.file("word/document.xml", composeDocumentXml(tpl, bodyXml(state)));
    return zip.generateAsync({ type: "uint8array", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // Cue cards: the A4 Script on 5 × 3 in cards (landscape), in the same styles and the same layout
  // (MC name | class | text), with the title card first and {End of Script} at the foot of the last,
  // and its type scaled from 11 pt to 14 pt to be read at arm's length. What a card needs on top of the A4 layout:
  // each Rundown line starts a card; a paragraph is cut only when it alone is longer than a card; a stage direction
  // goes over with the line it leads to; every card shows its Rundown line and number in its top right corner and names the MC on
  // its first line; an award list run on to a new card repeats its award.
  var K = 14 / 11;
  var CARD = { w: 7200, h: 4320, m: 432, sz: 28, line: 380, cue: 20, cueLine: 300, block: 220, tight: 100, top: 150, cls: 1100, num: 900, end: 420 };
  CARD.W = CARD.w - 2 * CARD.m;
  CARD.room = CARD.h - 2 * CARD.m - CARD.cueLine - CARD.top; // under the Rundown line at the top
  // A paragraph too long for one card is cut at sentence ends, then at commas, and only then by length.
  function cutText(s, room, width, count) {
    var fits = function (x) { return count(x, CARD.sz, width) * CARD.line <= room; };
    function pieces(x, re) { return x.match(re) || [x]; }
    var out = [], cur = "";
    function add(p, level) {
      if (fits(cur + p)) { cur += p; return; }
      if (cur) { out.push(cur); cur = ""; }
      if (fits(p)) { cur = p; return; }
      if (level === 0) return pieces(p, /[^，,、；;：:]+[，,、；;：:]*\s*/g).forEach(function (q) { add(q, 1); });
      while (!fits(p)) { var n = Math.floor(p.length * 0.6); out.push(p.slice(0, n)); p = p.slice(n); }
      cur = p;
    }
    pieces(String(s), /[^。！？!?.]+[。！？!?.]*[」』"']*\s*/g).forEach(function (p) { add(p, 0); });
    if (cur) out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  // count(text, size in half points, width in twips) gives the lines a paragraph takes, as the PDF sets them
  function cards(state, count) {
    var d = describe(state), sp = d.speakers, segs = [], seg = null, lw = 0;
    named(state).forEach(function (m) { lw = Math.max(lw, twips(mcLabel(m) + d.colon)); });
    var ind = Math.max(1000, Math.ceil((lw * K + 200) / 100) * 100), textW = CARD.W - ind;
    state.blocks.forEach(function (b, i) {
      var ls = lines(b.text);
      if (!ls.length) return;
      if (b.head || !seg) { seg = { head: b.head ? ls.join("　") : "", items: [] }; segs.push(seg); if (b.head) return; }
      var mc = b.type === "line" && sp[i] && d.byId[sp[i].mc];
      if (b.type === "line") ls.forEach(function (l, j) {
        seg.items.push({ kind: "line", mc: mc ? mcLabel(mc) + d.colon : "", show: j === 0 && !!(sp[i] && sp[i].show), text: l, last: j === ls.length - 1 });
      });
      else if (b.type === "cue") ls.forEach(function (l, j) { seg.items.push({ kind: "cue", text: l, last: j === ls.length - 1 }); });
      else {
        // An award list carries the stage direction just before it (its award), to print again on a card it runs on to
        var prev = seg.items[seg.items.length - 1], title = prev && prev.kind === "cue" ? prev.text : "";
        awardRows(b.text).forEach(function (r, j, all) { seg.items.push({ kind: "award", cls: r.cls, name: r.name, title: title, last: j === all.length - 1 }); });
      }
    });
    function height(it) {
      if (it.kind === "cue") return count(it.text, CARD.cue, textW) * CARD.cueLine + (it.last ? CARD.block : CARD.tight);
      if (it.kind === "award") return CARD.line + (it.last ? CARD.block : 0);
      return count(it.text, CARD.sz, textW) * CARD.line + (it.last ? CARD.block : CARD.tight);
    }
    var out = [], card = null, used = 0;
    segs.forEach(function (sg) {
      function open() { card = { head: sg.head, paras: [] }; out.push(card); used = 0; }
      function place(it) {
        var h = height(it);
        if (card.paras.length && used + h > CARD.room) {
          // Stage directions at the foot of a full card go over with the line they lead to
          var carry = [];
          while (card.paras.length > carry.length + 1 && card.paras[card.paras.length - 1 - carry.length].kind === "cue") carry.unshift(card.paras[card.paras.length - 1 - carry.length]);
          card.paras.length -= carry.length;
          open();
          if (!carry.length && it.kind === "award" && it.title) carry.push({ kind: "cue", text: it.title, last: true });
          carry.forEach(function (c) { card.paras.push(c); used += height(c); });
        }
        // The MC's name is printed on the first line of each card
        var p = Object.assign({}, it);
        if (p.kind === "line" && !card.paras.some(function (x) { return x.kind === "line"; })) p.show = true;
        card.paras.push(p); used += h;
      }
      open();
      sg.items.forEach(function (it) {
        if (it.kind === "line" && height(it) - CARD.block > CARD.room) {
          var bits = cutText(it.text, CARD.room - CARD.block, textW, count);
          bits.forEach(function (t, k) { place({ kind: "line", mc: it.mc, show: it.show && k === 0, text: t, last: it.last && k === bits.length - 1 }); });
          return;
        }
        place(it);
      });
    });
    // {End of Script} needs room at the foot of the last card
    if (card && used + CARD.end > CARD.room) out.push({ head: card.head, paras: [] });
    return { d: d, ind: ind, cards: out };
  }

  // getFont(src, text) resolves to the font cut down to text, or null (Anthropic Serif without its key: Noto Serif TC
  // then sets the Latin text too).
  // What both PDFs share: the fonts, cut down to the script's text, the Word template's styles, line breaking and drawing.
  async function pdfKit(PDFLib, fontkit, getFont, state) {
    var P = PDFLib, pdf = await P.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    var d = describe(state), all = [d.title, d.title.toUpperCase(), d.heading, d.heading.toUpperCase(), "0123456789 /{End of Script}　"];
    state.mcs.forEach(function (m) { all.push(mcLabel(m) + d.colon); });
    state.blocks.forEach(function (b) { all.push(b.text); });
    var text = all.join("");
    async function face(src) { var b = await Promise.resolve(getFont(src, text)).catch(function () { return null; }); return b ? pdf.embedFont(b, { subset: false }) : null; }
    var f = {};
    var got = await Promise.all(["NotoSerifTC-Regular", "NotoSerifTC-SemiBold", "NotoSerifTC-Bold", "AnthropicSerif-Text-Medium", "AnthropicSerif-Display-Medium", "AnthropicSerif-Display-MediumItalic"].map(face));
    f.cjk = got[0]; f.cjkSemi = got[1] || f.cjk; f.cjkBold = got[2] || f.cjk;
    f.lat = got[3] || f.cjk; f.disp = got[4] || f.lat; f.dispI = got[5] || f.disp;
    if (!f.cjk) throw new Error("font");
    // The styles of the Word template: Normal, Caption (grey), Heading 1 (bold, capitals), Heading 3 (capitals), Emphasis
    var grey = P.rgb(0.498, 0.498, 0.498), black = P.rgb(0, 0, 0);
    var ST = { text: { lat: f.lat, cjk: f.cjk, color: black }, cue: { lat: f.lat, cjk: f.cjk, color: grey },
      h1: { lat: f.lat, cjk: f.cjkBold, color: black, bold: true, caps: true }, h3: { lat: f.disp, cjk: f.cjkSemi, color: black, caps: true },
      em: { lat: f.dispI, cjk: f.cjk, color: black } };
    var has = {};
    function covers(font, ch) {
      if (!has[font.name]) has[font.name] = new Set(font.getCharacterSet());
      return has[font.name].has(ch.codePointAt(0));
    }
    // A run of text split by font: CJK characters, and anything the Latin font lacks, in Noto Serif TC
    function runs(t, st) {
      var out = [];
      for (var ch of String(t)) {
        var font = !isWide(ch) && covers(st.lat, ch) ? st.lat : st.cjk, last = out[out.length - 1];
        if (last && last.font === font) last.t += ch; else out.push({ t: ch, font: font });
      }
      return out;
    }
    // Widths character by character, and drawn so: a PDF viewer otherwise takes some glyphs' widths (Noto Serif TC's
    // digits) from the font's width table, where pdf-lib leaves them out, and leaves gaps after them
    var adv = {};
    function cw(font, ch) { var k = font.name + ch; return k in adv ? adv[k] : (adv[k] = font.widthOfTextAtSize(ch, 1)); }
    function width(t, st, size) { var w = 0; runs(st.caps ? t.toUpperCase() : t, st).forEach(function (r) { for (var ch of r.t) w += cw(r.font, ch) * size; }); return w; }
    // Line breaking: at spaces and between CJK characters, never before closing punctuation or after opening punctuation
    var CLOSE = "，。、；：！？）」』〉》〕】…,.;:!?)]", OPEN = "（「『〈《〔【([";
    function wrap(t, st, size, max) {
      var toks = String(t).match(/\s+|[^\sᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠]+|[\s\S]/g) || [], words = [];
      toks.forEach(function (w) {
        var prev = words[words.length - 1];
        if (prev && !/^\s/.test(w) && !/\s$/.test(prev) && (CLOSE.indexOf(w[0]) >= 0 || OPEN.indexOf(prev[prev.length - 1]) >= 0 ||
          (!isWide(w[0]) && !isWide(prev[prev.length - 1])))) words[words.length - 1] += w;
        else words.push(w);
      });
      var lines = [], cur = "";
      words.forEach(function (w) {
        if (cur && !/^\s+$/.test(w) && width((cur + w).trimEnd(), st, size) > max) { lines.push(cur.trimEnd()); cur = ""; }
        if (!cur && /^\s+$/.test(w)) return;
        while (!cur && width(w, st, size) > max && w.length > 1) {  // a word longer than the line
          var n = w.length; while (n > 1 && width(w.slice(0, n), st, size) > max) n--;
          lines.push(w.slice(0, n)); w = w.slice(n);
        }
        cur += w;
      });
      if (cur.trim()) lines.push(cur.trimEnd());
      return lines.length ? lines : [""];
    }
    // Text whose top sits at y (pt from the card's foot), in an exact line height, as Word places it
    function put(page, t, st, size, x, top, lineH, align, boxW) {
      var s = st.caps ? t.toUpperCase() : t, base = top - (lineH + size * 0.7) / 2;
      if (align === "right") x += boxW - width(t, st, size);
      if (align === "center") x += (boxW - width(t, st, size)) / 2;
      if (st.bold) page.pushOperators(P.setTextRenderingMode(P.TextRenderingMode.FillAndOutline), P.setLineWidth(size * 0.025), P.setStrokingColor(st.color));
      runs(s, st).forEach(function (r) { for (var ch of r.t) { if (ch.trim()) page.drawText(ch, { x: x, y: base, size: size, font: r.font, color: st.color }); x += cw(r.font, ch) * size; } });
      if (st.bold) page.pushOperators(P.setTextRenderingMode(P.TextRenderingMode.Fill));
    }
    return { P: P, pdf: pdf, d: d, ST: ST, wrap: wrap, width: width, put: put, black: black };
  }

  // Cue cards on A4 paper, as a PDF: the same cards, five to a sheet so that a card printer is not needed.
  // A 5 × 3 in card is 360 × 216 pt; down the left of the sheet three lie flat, down the right two stand on end, which
  // fills 576 × 720 pt of the sheet's 595 × 842. Each card is outlined in a light hairline and the three straight cuts
  // are marked above and below, so a guillotine cuts them exactly. The text is laid out here with the fonts' own
  // widths, so a card never runs over.
  async function buildCardsPdf(PDFLib, fontkit, getFont, state) {
    var K_ = await pdfKit(PDFLib, fontkit, getFont, state), P = K_.P, pdf = K_.pdf, d = K_.d, ST = K_.ST, wrap = K_.wrap, put = K_.put, black = K_.black;
    function stOf(sz) { return sz === CARD.cue ? ST.cue : ST.text; }
    var C = cards(state, function (t, sz, w) { return wrap(t, stOf(sz), sz / 2, w / 20).length; });
    var n = C.cards.length, ind = C.ind / 20, W = 360, H = 216, M = CARD.m / 20, TW = W - 2 * M;
    function drawCover(page) {
      var t1 = wrap(d.title, ST.h1, 24, TW), t3 = wrap(d.heading, ST.h3, 14, TW), y = (H + t1.length * 30 + 12 + t3.length * 19) / 2;  // left-aligned, centred top to bottom
      t1.forEach(function (l) { put(page, l, ST.h1, 24, M, y, 30); y -= 30; });
      y -= 12;
      t3.forEach(function (l) { put(page, l, ST.h3, 14, M, y, 19); y -= 19; });
    }
    function drawCard(page, c, k) {
      var y = H - M, cueL = CARD.cueLine / 20, L = CARD.line / 20;
      put(page, (c.head ? c.head + "　　" : "") + (k + 1) + " / " + n, ST.cue, CARD.cue / 2, M, y, cueL, "right", TW);
      y -= cueL + CARD.top / 20;
      c.paras.forEach(function (p) {
        var after = (p.last ? CARD.block : p.kind === "award" ? 0 : CARD.tight) / 20;
        if (p.kind === "line") {
          if (p.show && p.mc) put(page, p.mc, ST.text, CARD.sz / 2, M, y, L);
          wrap(p.text, ST.text, CARD.sz / 2, TW - ind).forEach(function (l) { put(page, l, ST.text, CARD.sz / 2, M + ind, y, L); y -= L; });
        } else if (p.kind === "cue") {
          wrap(p.text, ST.cue, CARD.cue / 2, TW - ind).forEach(function (l) { put(page, l, ST.cue, CARD.cue / 2, M + ind, y, cueL); y -= cueL; });
        } else {
          put(page, p.cls, ST.text, CARD.sz / 2, M + ind, y, L);
          put(page, p.name, ST.text, CARD.sz / 2, M + ind + CARD.cls / 20, y, L); y -= L;
        }
        y -= after;
      });
      if (k === n - 1) put(page, "{End of Script}", ST.em, 14, M, M + 19, 19, "center", TW);
    }
    // The sheet: three flat cards down the left, two standing cards down the right, centred on A4
    var PW = 595.28, PH = 841.89, X0 = (PW - 576) / 2, TOP = (PH + 720) / 2;
    var slots = [0, 1, 2].map(function (i) { return { x: X0, y: TOP - H * (i + 1), w: W, h: H, m: [1, 0, 0, 1, X0, TOP - H * (i + 1)] }; })
      .concat([0, 1].map(function (j) { var x = X0 + W, y = TOP - W * (j + 1); return { x: x, y: y, w: H, h: W, m: [0, 1, -1, 0, x + H, y] }; }));
    // Cut and stack: with the sheets printed and cut as one pile, each place on the sheet makes one stack that is already
    // in order. Sheet i, place j holds card j × sheets + i, so the stacks laid one after another, left column top to
    // bottom then right, run from the title card to the last card.
    var items = [null].concat(C.cards), sheets = Math.ceil(items.length / 5);
    for (var i = 0; i < sheets; i++) {
      var page = pdf.addPage([PW, PH]);
      // Cut marks above and below the three vertical cuts
      [X0, X0 + W, X0 + W + H].forEach(function (x) {
        page.drawLine({ start: { x: x, y: TOP + 6 }, end: { x: x, y: TOP + 24 }, thickness: 0.4, color: black });
        page.drawLine({ start: { x: x, y: TOP - 720 - 6 }, end: { x: x, y: TOP - 720 - 24 }, thickness: 0.4, color: black });
      });
      slots.forEach(function (s, j) {
        var k = j * sheets + i;
        page.drawRectangle({ x: s.x, y: s.y, width: s.w, height: s.h, borderColor: P.rgb(0.75, 0.75, 0.75), borderWidth: 0.25 });
        if (k >= items.length) return;
        page.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix.apply(null, s.m));
        if (items[k]) drawCard(page, items[k], k - 1); else drawCover(page);
        page.pushOperators(P.popGraphicsState());
      });
    }
    return pdf.save();
  }

  // The A4 Script as a PDF, laid out as the Word file: the title and MCs, then the MC name | class | text table in
  // the template's styles (11 pt text, 8 pt grey stage directions), with {End of Script} at the foot of the last page.
  async function buildScriptPdf(PDFLib, fontkit, getFont, state) {
    var K_ = await pdfKit(PDFLib, fontkit, getFont, state), pdf = K_.pdf, d = K_.d, ST = K_.ST, wrap = K_.wrap, put = K_.put;
    var PW = 595.28, PH = 841.89, M = 72, TW = PW - 2 * M, ind = d.indent / 20, CLS = 80, L = 15;
    var page = pdf.addPage([PW, PH]), y = PH - M;
    function newPage() { page = pdf.addPage([PW, PH]); y = PH - M; }
    y -= 24;
    wrap(d.title, ST.h1, 24, TW).forEach(function (l) { put(page, l, ST.h1, 24, M, y, 30); y -= 30; });
    y -= 4 + 12;
    wrap(d.heading, ST.h3, 14, TW).forEach(function (l) { put(page, l, ST.h3, 14, M, y, 19); y -= 19; });
    y -= 24;
    var paras = layout(state).paras.map(function (p) {
      var st = p.kind === "cue" ? ST.cue : ST.text, size = p.kind === "cue" ? 8 : 11;
      return { p: p, st: st, size: size, lines: p.kind === "award" ? [p.name] : wrap(p.text, st, size, TW - ind) };
    });
    paras.forEach(function (q, i) {
      var p = q.p, next = paras[i + 1];
      // A paragraph kept with the next (a stage direction, an award list's lead-in) moves on with its first line
      var need = (p.keepNext && next ? q.lines.length + 1 : 1) * L;
      if (y - need < M && y < PH - M) newPage();
      q.lines.forEach(function (l, j) {
        if (y - L < M) newPage();
        if (j === 0 && p.kind === "line" && p.label) put(page, p.label, ST.text, 11, M, y, L);
        if (j === 0 && p.kind === "award" && p.cls) put(page, p.cls, ST.text, 11, M + ind, y, L);
        put(page, l, q.st, q.size, M + ind + (p.kind === "award" ? CLS : 0), y, L);
        y -= L;
      });
      y -= p.after / 20;
    });
    if (y < M + 30) newPage();
    put(page, "{End of Script}", ST.em, 14, M, M + 19, 19, "center", TW);
    return pdf.save();
  }

  // Fonts the Word file carries, so it looks the same on a device without them (iPad Word).
  // Each family matches a font name in the template's styles; faces are listed in the order Word expects.
  var FACES = [
    { family: "Anthropic Serif Text Medium", face: "Regular", src: "AnthropicSerif-Text-Medium" },
    { family: "Anthropic Serif Text Medium", face: "Italic", src: "AnthropicSerif-Text-MediumItalic" },
    { family: "Anthropic Serif Display Medium", face: "Regular", src: "AnthropicSerif-Display-Medium" },
    { family: "Anthropic Serif Display Medium", face: "Italic", src: "AnthropicSerif-Display-MediumItalic" },
    { family: "Noto Serif TC", face: "Regular", src: "NotoSerifTC-Regular" },
    { family: "Noto Serif TC", face: "Bold", src: "NotoSerifTC-Bold" },
    { family: "Noto Serif TC SemiBold", face: "Regular", src: "NotoSerifTC-SemiBold" }
  ];
  function unesc(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
  function newGuid() {
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    var h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("").toUpperCase();
    return "{" + h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20) + "}";
  }
  // Word stores embedded fonts obfuscated: the first 32 bytes XOR the font key, read backwards (ECMA-376 Part 1, 17.8.1).
  function obfuscate(data, guid) {
    var hex = guid.replace(/[{}-]/g, ""), key = [];
    for (var i = 0; i < 16; i++) key.push(parseInt(hex.substr(30 - 2 * i, 2), 16));
    var out = new Uint8Array(data);
    for (var j = 0; j < 32 && j < out.length; j++) out[j] ^= key[j % 16];
    return out;
  }
  // getFont(src, text) resolves to a TrueType font cut down to the characters in text, or null to leave that face out.
  async function embedFonts(JSZipLib, bytes, getFont) {
    var zip = await JSZipLib.loadAsync(bytes);
    var doc = await zip.file("word/document.xml").async("string");
    var text = " {}" + (doc.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map(function (r) { return unesc(r.replace(/<[^>]+>/g, "")); }).join("");
    var got = await Promise.all(FACES.map(function (f) { return Promise.resolve(getFont(f.src, text)).catch(function () { return null; }); }));
    var table = await zip.file("word/fontTable.xml").async("string");
    var rels = [], n = 0;
    FACES.forEach(function (f, i) {
      if (!got[i]) return;
      n++; var guid = newGuid(), id = "rIdFont" + n;
      zip.file("word/fonts/font" + n + ".odttf", obfuscate(got[i], guid));
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font' + n + '.odttf"/>');
      var tag = '<w:embed' + f.face + ' r:id="' + id + '" w:fontKey="' + guid + '"/>';
      var open = '<w:font w:name="' + f.family + '">', at = table.indexOf(open);
      if (at < 0) table = table.replace("</w:fonts>", open + '<w:family w:val="roman"/><w:pitch w:val="variable"/>' + tag + "</w:font></w:fonts>");
      else { var end = table.indexOf("</w:font>", at); table = table.slice(0, end) + tag + table.slice(end); }
    });
    if (!n) return bytes;
    if (!/<w:fonts[^>]*xmlns:r=/.test(table)) table = table.replace("<w:fonts ", '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    zip.file("word/fontTable.xml", table);
    zip.file("word/_rels/fontTable.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join("") + "</Relationships>");
    var types = await zip.file("[Content_Types].xml").async("string");
    if (types.indexOf('Extension="odttf"') < 0) types = types.replace("<Default ", '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default ');
    zip.file("[Content_Types].xml", types);
    var settings = await zip.file("word/settings.xml").async("string");
    if (settings.indexOf("<w:embedTrueTypeFonts") < 0) settings = settings.replace(/(<w:zoom[^>]*\/>)/, "$1<w:embedTrueTypeFonts/><w:saveSubsetFonts/>");
    zip.file("word/settings.xml", settings);
    return zip.generateAsync({ type: "uint8array", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  return { isEnglish: isEnglish, describe: describe, layout: layout, speakers: speakers, bodyXml: bodyXml, awardRows: awardRows, lines: lines,
    mcLabel: mcLabel, cls: cls, named: named, buildDocx: buildDocx, buildCardsPdf: buildCardsPdf, buildScriptPdf: buildScriptPdf, cards: cards, embedFonts: embedFonts, FACES: FACES, yymmdd: yymmdd };
})();
if (typeof module !== "undefined") module.exports = ScriptGen;
