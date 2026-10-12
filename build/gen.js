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

  // Cue cards: the same script on 5 × 3 in cards (landscape index cards), one Word page per card.
  // Each Rundown line (a "head" cue) starts a new card; a long part runs on to further cards, broken
  // between paragraphs, a stage direction kept with what follows it. Every card repeats its Rundown
  // line and the MC's name at the top, so a card read on its own still says where it is and who speaks.
  var CARD = { w: 7200, h: 4320, m: 432, text: 28, line: 400, cue: 20, cueLine: 300, head: 18, headLine: 240, after: 160, tight: 60, cls: 900 };
  CARD.W = CARD.w - 2 * CARD.m;
  CARD.room = CARD.h - 2 * CARD.m - CARD.headLine - 120 - 80; // the head row and the gap under it
  function cardLines(s, sz) {
    var w = 0;
    for (var ch of String(s)) w += isWide(ch) ? sz * 10 : sz * 4.9;
    return Math.max(1, Math.ceil(w / (CARD.W * 0.96)));
  }
  // A paragraph too long for one card is cut at sentence ends, then by length.
  function cutText(s, room, sz, label) {
    var parts = String(s).match(/[^。！？!?.]+[。！？!?.]*[」』"']*\s*/g) || [s], out = [], cur = "";
    var fits = function (x, first) { return cardLines((first ? label : "") + x, sz) * CARD.line <= room; };
    parts.forEach(function (p) {
      if (fits(cur + p, !out.length)) { cur += p; return; }
      if (cur) { out.push(cur); cur = ""; }
      while (!fits(p, !out.length)) { var n = Math.floor(p.length * 0.6); out.push(p.slice(0, n)); p = p.slice(n); }
      cur = p;
    });
    if (cur) out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function cards(state) {
    var d = describe(state), sp = d.speakers, segs = [], seg = null;
    state.blocks.forEach(function (b, i) {
      var ls = lines(b.text);
      if (!ls.length) return;
      if (b.head || !seg) { seg = { head: b.head ? ls.join("　") : "", items: [] }; segs.push(seg); if (b.head) return; }
      var mc = b.type === "line" && sp[i] && d.byId[sp[i].mc];
      if (b.type === "line") ls.forEach(function (l, j) {
        seg.items.push({ kind: "line", mc: mc ? mcLabel(mc) + d.colon + (d.en ? " " : "") : "", show: j === 0 && !!(sp[i] && sp[i].show), text: l, last: j === ls.length - 1 });
      });
      else if (b.type === "cue") ls.forEach(function (l, j) { seg.items.push({ kind: "cue", text: l, last: j === ls.length - 1 }); });
      else {
        // An award list carries the stage direction just before it (its award), to print again on a card it runs on to
        var prev = seg.items[seg.items.length - 1], title = prev && prev.kind === "cue" ? prev.text : "";
        awardRows(b.text).forEach(function (r, j, all) { seg.items.push({ kind: "award", cls: r.cls, name: r.name, title: title, last: j === all.length - 1 }); });
      }
    });
    var out = [];
    segs.forEach(function (sg) {
      var card = null, used = 0;
      function open() { card = { head: sg.head, paras: [] }; out.push(card); used = 0; }
      function height(it, top) {
        if (it.kind === "cue") return cardLines(it.text, CARD.cue) * CARD.cueLine + (it.last ? CARD.after : CARD.tight);
        if (it.kind === "award") return CARD.line + (it.last ? CARD.after : 0);
        return cardLines((it.show || top ? it.mc : "") + it.text, CARD.text) * CARD.line + (it.last ? CARD.after : CARD.tight);
      }
      open();
      sg.items.forEach(function (it) {
        var top = !card.paras.length;
        // A line too long for any card is cut, each piece placed as its own line
        if (it.kind === "line" && height(it, true) - CARD.after > CARD.room) {
          var bits = cutText(it.text, CARD.room - CARD.after, CARD.text, it.mc);
          bits.forEach(function (t, k) { place({ kind: "line", mc: it.mc, show: it.show && k === 0, text: t, last: it.last && k === bits.length - 1 }); });
          return;
        }
        place(it);
      });
      function place(it) {
        var h = height(it, !card.paras.length);
        if (card.paras.length && used + h > CARD.room) {
          // Stage directions at the foot of a full card go over with the line they lead to
          var carry = [];
          while (card.paras.length > carry.length + 1 && card.paras[card.paras.length - 1 - carry.length].kind === "cue") carry.unshift(card.paras[card.paras.length - 1 - carry.length]);
          card.paras.length -= carry.length;
          open();
          if (!carry.length && it.kind === "award" && it.title) carry.push({ kind: "cue", text: it.title, last: true });
          carry.forEach(function (c) { card.paras.push(c); used += height(c, false); });
          h = height(it, !card.paras.length);
        }
        // The MC's name is printed on the first line of each card
        var p = Object.assign({}, it);
        if (p.kind === "line" && !card.paras.some(function (x) { return x.kind === "line"; })) p.show = true;
        card.paras.push(p); used += h;
      }
    });
    return { d: d, cards: out.filter(function (c) { return c.paras.length || c.head; }) };
  }

  function cardsXml(state) {
    var C = cards(state), n = C.cards.length, x = "";
    var none = "<w:tblBorders><w:top w:val=\"nil\"/><w:left w:val=\"nil\"/><w:bottom w:val=\"nil\"/><w:right w:val=\"nil\"/><w:insideH w:val=\"nil\"/><w:insideV w:val=\"nil\"/></w:tblBorders>";
    var mar = "<w:tblCellMar><w:top w:w=\"0\" w:type=\"dxa\"/><w:left w:w=\"0\" w:type=\"dxa\"/><w:bottom w:w=\"0\" w:type=\"dxa\"/><w:right w:w=\"0\" w:type=\"dxa\"/></w:tblCellMar>";
    function table(cols, rows) {
      return "<w:tbl><w:tblPr><w:tblW w:w=\"" + CARD.W + "\" w:type=\"dxa\"/>" + none + "<w:tblLayout w:type=\"fixed\"/>" + mar +
        "<w:tblLook w:val=\"0000\" w:firstRow=\"0\" w:lastRow=\"0\" w:firstColumn=\"0\" w:lastColumn=\"0\" w:noHBand=\"1\" w:noVBand=\"1\"/></w:tblPr><w:tblGrid>" +
        cols.map(function (w) { return "<w:gridCol w:w=\"" + w + "\"/>"; }).join("") + "</w:tblGrid>" + rows + "</w:tbl>";
    }
    function cell(w, inner) { return "<w:tc><w:tcPr><w:tcW w:w=\"" + w + "\" w:type=\"dxa\"/></w:tcPr>" + inner + "</w:tc>"; }
    function sz(v) { return "<w:sz w:val=\"" + v + "\"/><w:szCs w:val=\"" + v + "\"/>"; }
    function ppr(style, line, after, extra) {
      return "<w:pPr>" + (style ? "<w:pStyle w:val=\"" + style + "\"/>" : "") + (extra || "") + "<w:spacing w:before=\"0\" w:after=\"" + after + "\" w:line=\"" + line + "\" w:lineRule=\"exact\"/></w:pPr>";
    }
    var LBL = "<w:rPr><w:rFonts w:ascii=\"Anthropic Serif Display Medium\" w:hAnsi=\"Anthropic Serif Display Medium\" w:eastAsia=\"Noto Serif TC SemiBold\"/>" + sz(CARD.text) + "</w:rPr>";
    var TXT = "<w:rPr>" + sz(CARD.text) + "</w:rPr>", CUE = "<w:rPr>" + sz(CARD.cue) + "</w:rPr>", HD = "<w:rPr>" + sz(CARD.head) + "</w:rPr>";
    var sect = "<w:pgSz w:w=\"" + CARD.w + "\" w:h=\"" + CARD.h + "\" w:orient=\"landscape\"/><w:pgMar w:top=\"" + CARD.m + "\" w:right=\"" + CARD.m + "\" w:bottom=\"" + CARD.m +
      "\" w:left=\"" + CARD.m + "\" w:header=\"0\" w:footer=\"0\" w:gutter=\"0\"/><w:cols w:space=\"720\"/><w:docGrid w:linePitch=\"360\"/>";
    C.cards.forEach(function (c, k) {
      var hl = CARD.W - 1200;
      x += table([hl, 1200], "<w:tr>" + cell(hl, "<w:p>" + ppr("Caption", CARD.headLine, 0) + "<w:r>" + HD + t(c.head) + "</w:r></w:p>") +
        cell(1200, "<w:p>" + ppr("Caption", CARD.headLine, 0, "<w:jc w:val=\"right\"/>") + "<w:r>" + HD + t((k + 1) + " / " + n) + "</w:r></w:p>") + "</w:tr>");
      x += "<w:p>" + ppr(null, 120, 80) + "</w:p>";
      var rows = "";
      function flush() { if (rows) { x += table([CARD.cls, CARD.W - CARD.cls], rows); rows = ""; } }
      c.paras.forEach(function (p) {
        if (p.kind === "award") {
          rows += "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + cell(CARD.cls, "<w:p>" + ppr(null, CARD.line, 0) + (p.cls ? "<w:r>" + TXT + t(p.cls) + "</w:r>" : "") + "</w:p>") +
            cell(CARD.W - CARD.cls, "<w:p>" + ppr(null, CARD.line, p.last ? CARD.after : 0) + "<w:r>" + TXT + t(p.name) + "</w:r></w:p>") + "</w:tr>";
          return;
        }
        flush();
        if (p.kind === "cue") x += "<w:p>" + ppr("Caption", CARD.cueLine, p.last ? CARD.after : CARD.tight) + "<w:r>" + CUE + t(p.text) + "</w:r></w:p>";
        else x += "<w:p>" + ppr(null, CARD.line, p.last ? CARD.after : CARD.tight) + (p.show && p.mc ? "<w:r>" + LBL + t(p.mc) + "</w:r>" : "") + "<w:r>" + TXT + t(p.text) + "</w:r></w:p>";
      });
      flush();
      // Each card ends its own section, so the next card starts on a new page without an empty line at its top
      if (k < n - 1) x += "<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"20\" w:lineRule=\"exact\"/><w:rPr>" + sz(2) + "</w:rPr><w:sectPr><w:type w:val=\"nextPage\"/>" + sect + "</w:sectPr></w:pPr></w:p>";
    });
    return { body: x || "<w:p/>", sect: "<w:sectPr>" + sect + "</w:sectPr>" };
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
