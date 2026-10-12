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
    var title = [date || "YY/MM/DD", state.event.trim() || (en ? "Event" : "活動名稱"), (en ? "Script" : "講稿")].join(en ? " | " : "｜");
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

  // Cue cards: the A4 Script on 5 × 3 in cards (landscape), one Word page per card, in the same styles and the same
  // borderless table (MC name | class | text), with the title card first and {End of Script} at the foot of the last,
  // and its type scaled from 11 pt to 14 pt to be read at arm's length. What a card needs on top of the A4 layout:
  // each Rundown line starts a card; a paragraph is cut only when it alone is longer than a card; a stage direction
  // goes over with the line it leads to; every card repeats its Rundown line, shows its number and names the MC on
  // its first line; an award list run on to a new card repeats its award.
  var K = 14 / 11;
  var CARD = { w: 7200, h: 4320, m: 432, sz: 28, line: 380, cue: 20, cueLine: 300, block: 220, tight: 100, top: 150, cls: 1100, num: 900, end: 420 };
  CARD.W = CARD.w - 2 * CARD.m;
  CARD.room = CARD.h - 2 * CARD.m - CARD.cueLine - CARD.top; // under the Rundown line at the top
  // Lines a paragraph takes: words wrapped greedily, a CJK character about 1 em, other letters about half, a space a quarter
  function cardLines(s, sz, width) {
    var n = 1, x = 0, em = sz * 10, max = width * 0.97;
    (String(s).match(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60]|[^\s\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60]+|\s+/g) || []).forEach(function (w) {
      var ww = /^\s/.test(w) ? em / 4 : isWide(w) ? em * 1.06 : w.length * em * 0.52; // 1.06: punctuation that may not start a line pushes characters down
      if (x + ww > max && x > 0 && !/^\s/.test(w)) { n++; x = 0; }
      x += /^\s/.test(w) && x === 0 ? 0 : ww;
      while (x > max) { n++; x -= max; }
    });
    return n;
  }
  // A paragraph too long for one card is cut at sentence ends, then at commas, and only then by length.
  function cutText(s, room, width) {
    var fits = function (x) { return cardLines(x, CARD.sz, width) * CARD.line <= room; };
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
  function cards(state) {
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
      if (it.kind === "cue") return cardLines(it.text, CARD.cue, textW) * CARD.cueLine + (it.last ? CARD.block : CARD.tight);
      if (it.kind === "award") return CARD.line + (it.last ? CARD.block : 0);
      return cardLines(it.text, CARD.sz, textW) * CARD.line + (it.last ? CARD.block : CARD.tight);
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
          var bits = cutText(it.text, CARD.room - CARD.block, textW);
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

  function cardsXml(state) {
    var C = cards(state), d = C.d, n = C.cards.length, ind = C.ind, rest = CARD.W - ind - CARD.cls;
    var cols = [ind, CARD.cls, rest - CARD.num, CARD.num];
    function sz(v) { return "<w:sz w:val=\"" + v + "\"/><w:szCs w:val=\"" + v + "\"/>"; }
    var TXT = "<w:rPr>" + sz(CARD.sz) + "</w:rPr>", CUE = "<w:rPr>" + sz(CARD.cue) + "</w:rPr>";
    var LBL = "<w:rPr><w:rFonts w:ascii=\"Anthropic Serif Text Medium\" w:hAnsi=\"Anthropic Serif Text Medium\"/>" + sz(CARD.sz) + "</w:rPr>";
    function para(style, line, after, runs, jc) {
      return "<w:p><w:pPr>" + (style ? "<w:pStyle w:val=\"" + style + "\"/>" : "") + "<w:spacing w:after=\"" + after + "\" w:line=\"" + line + "\" w:lineRule=\"exact\"/>" +
        (jc ? "<w:jc w:val=\"" + jc + "\"/>" : "") + "</w:pPr>" + runs + "</w:p>";
    }
    function run(rpr, text) { return text ? "<w:r>" + rpr + t(text) + "</w:r>" : ""; }
    function cell(from, span, inner) {
      var w = 0; for (var i = from; i < from + span; i++) w += cols[i];
      return "<w:tc><w:tcPr><w:tcW w:w=\"" + w + "\" w:type=\"dxa\"/>" + (span > 1 ? "<w:gridSpan w:val=\"" + span + "\"/>" : "") + "</w:tcPr>" + inner + "</w:tc>";
    }
    var none = "<w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/>";
    function table(rows) {
      return "<w:tbl><w:tblPr><w:tblW w:w=\"" + CARD.W + "\" w:type=\"dxa\"/><w:tblBorders>" + none + "</w:tblBorders><w:tblLayout w:type=\"fixed\"/>" +
        "<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"0\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"0\" w:type=\"dxa\"/></w:tblCellMar>" +
        "<w:tblLook w:val=\"0000\" w:firstRow=\"0\" w:lastRow=\"0\" w:firstColumn=\"0\" w:lastColumn=\"0\" w:noHBand=\"1\" w:noVBand=\"1\"/></w:tblPr><w:tblGrid>" +
        cols.map(function (w) { return "<w:gridCol w:w=\"" + w + "\"/>"; }).join("") + "</w:tblGrid>" + rows + "</w:tbl>";
    }
    function sect() {
      return "<w:sectPr><w:type w:val=\"nextPage\"/><w:pgSz w:w=\"" + CARD.w + "\" w:h=\"" + CARD.h + "\" w:orient=\"landscape\"/><w:pgMar w:top=\"" + CARD.m + "\" w:right=\"" + CARD.m +
        "\" w:bottom=\"" + CARD.m + "\" w:left=\"" + CARD.m + "\" w:header=\"0\" w:footer=\"0\" w:gutter=\"0\"/><w:cols w:space=\"720\"/>" + "<w:docGrid w:linePitch=\"360\"/></w:sectPr>";
    }
    // Each card ends its own section, so the next starts on a new page with no empty line at its top
    function endCard() { return "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr>" + sz(2) + "</w:rPr>" + sect() + "</w:pPr></w:p>"; }
    // The title card: the A4 Script's first lines, the title and the MCs
    var x = "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/><w:spacing w:before=\"0\"/><w:rPr><w:sz w:val=\"48\"/><w:szCs w:val=\"48\"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val=\"48\"/><w:szCs w:val=\"48\"/></w:rPr>" + t(d.title) + "</w:r></w:p>";
    x += "<w:p><w:pPr><w:pStyle w:val=\"Heading3\"/><w:spacing w:after=\"0\"/></w:pPr><w:r>" + t(d.heading) + "</w:r></w:p>";
    if (n) x += endCard();
    C.cards.forEach(function (c, k) {
      var rows = "<w:tr>" + cell(0, 1, para("Caption", CARD.cueLine, CARD.top, "")) + cell(1, 2, para("Caption", CARD.cueLine, CARD.top, run(CUE, c.head))) +
        cell(3, 1, para("Caption", CARD.cueLine, CARD.top, run(CUE, (k + 1) + " / " + n), "right")) + "</w:tr>";
      c.paras.forEach(function (p) {
        var after = p.last ? CARD.block : p.kind === "award" ? 0 : CARD.tight;
        if (p.kind === "line") rows += "<w:tr>" + cell(0, 1, para(null, CARD.line, after, p.show ? run(LBL, p.mc) : "")) + cell(1, 3, para(null, CARD.line, after, run(TXT, p.text))) + "</w:tr>";
        else if (p.kind === "cue") rows += "<w:tr>" + cell(0, 1, para("Caption", CARD.cueLine, after, "")) + cell(1, 3, para("Caption", CARD.cueLine, after, run(CUE, p.text))) + "</w:tr>";
        else rows += "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + cell(0, 1, para(null, CARD.line, after, "")) + cell(1, 1, para(null, CARD.line, after, run(TXT, p.cls))) +
          cell(2, 2, para(null, CARD.line, after, run(TXT, p.name))) + "</w:tr>";
      });
      x += table(rows);
      if (k < n - 1) x += endCard();
    });
    // {End of Script} at the foot of the last card, as at the foot of the A4 Script's last page
    var em = "<w:rPr><w:rStyle w:val=\"Emphasis\"/><w:sz w:val=\"28\"/><w:szCs w:val=\"28\"/></w:rPr>";
    if (n) x += "<w:p><w:pPr><w:framePr w:wrap=\"around\" w:vAnchor=\"margin\" w:hAnchor=\"margin\" w:xAlign=\"center\" w:yAlign=\"bottom\"/><w:jc w:val=\"center\"/>" + em + "</w:pPr><w:r>" + em + t("{End of Script}") + "</w:r></w:p>";
    return { body: x, sect: sect().replace("<w:type w:val=\"nextPage\"/>", "") };
  }

  async function buildCards(JSZipLib, templateBase64, state) {
    var zip = await JSZipLib.loadAsync(templateBase64, { base64: true });
    var tpl = await zip.file("word/document.xml").async("string"), c = cardsXml(state);
    var start = tpl.indexOf("<w:body>") + "<w:body>".length, end = tpl.lastIndexOf("</w:body>");
    zip.file("word/document.xml", tpl.slice(0, start) + c.body + c.sect + tpl.slice(end));
    return zip.generateAsync({ type: "uint8array", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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
    mcLabel: mcLabel, cls: cls, named: named, buildDocx: buildDocx, buildCards: buildCards, cards: cards, embedFonts: embedFonts, FACES: FACES, yymmdd: yymmdd };
})();
if (typeof module !== "undefined") module.exports = ScriptGen;
