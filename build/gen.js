/* MC Scripts: state -> one layout -> Word document.xml and the on-screen preview.
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

  return { isEnglish: isEnglish, describe: describe, layout: layout, speakers: speakers, bodyXml: bodyXml, awardRows: awardRows, lines: lines,
    mcLabel: mcLabel, cls: cls, named: named, buildDocx: buildDocx, yymmdd: yymmdd };
})();
if (typeof module !== "undefined") module.exports = ScriptGen;
