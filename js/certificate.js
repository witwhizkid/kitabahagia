// Draws a Kita Bahagia volunteer certificate (A4 landscape, 2000×1414) on a canvas.
// admin → Sertifikat uses it for the live preview; issuing will reuse it.
// Layout and colours follow the approved mockup (see CLAUDE.md, "Sertifikat relawan").
(() => {
  const WIDTH = 2000;
  const HEIGHT = 1414;
  const GOLD = "#efb635";
  const MAROON = "#780c06";
  const INK = "#0d0a0a";
  const TEXT = "#1c1717";
  const PAPER = "#fdfbfb";
  // Temporary fonts until Desain hands over Garet (self-hosted later).
  const DISPLAY = '"Plus Jakarta Sans", sans-serif';
  const BODY = '"Lexend", sans-serif';
  const FONT_FACES = [
    `800 172px ${DISPLAY}`, `700 118px ${DISPLAY}`, `600 30px ${DISPLAY}`, `italic 500 33px ${DISPLAY}`,
    `300 92px ${BODY}`, `400 30px ${BODY}`, `600 30px ${BODY}`,
  ];
  const palettes = {
    maroon: { deep: "#8a150e", mid: "#e2635b", light: "#ffd2cc", tint: "#b8746e" },
    emas: { deep: "#8f5d00", mid: "#efb635", light: "#fff0c7", tint: "#c9a24a" },
    hijau: { deep: "#1d5236", mid: "#5aa376", light: "#d8f0e1", tint: "#6f9c80" },
    biru: { deep: "#153e68", mid: "#4d8cc7", light: "#d8e8f7", tint: "#6c8fb3" },
  };
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  const loadFonts = () => Promise.all(FONT_FACES.map((font) => document.fonts.load(font))).catch(() => undefined);

  // Colour between a and b (hex), with optional alpha.
  const mix = (a, b, t, alpha = 1) => {
    const channel = (hex, index) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
    const value = [0, 1, 2].map((index) => Math.round(channel(a, index) * (1 - t) + channel(b, index) * t));
    return `rgba(${value.join(",")},${alpha})`;
  };

  const gradient = (context, [x0, y0, x1, y1], stops) => {
    const result = context.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([offset, color]) => result.addColorStop(offset, color));
    return result;
  };

  const fillPath = (context, path, style, bounds) => {
    context.fillStyle = typeof style === "function" ? style(bounds) : style;
    context.fill(new Path2D(path));
  };

  const drawBackground = (context, { preset, color, image }) => {
    const palette = palettes[color] || palettes.maroon;
    context.fillStyle = PAPER;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    if (image) {
      // Custom ornament from Desain: right-hand panel, full height, anchored right.
      const width = image.width * (HEIGHT / image.height);
      context.drawImage(image, WIDTH - width, 0, width, HEIGHT);
      return;
    }
    if (preset === "balok") {
      context.fillStyle = gradient(context, [0, 0, WIDTH, 0], [[0, mix(palette.light, PAPER, 0.55)], [0.45, mix(palette.light, PAPER, 0.85)], [0.7, PAPER]]);
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = gradient(context, [1440, 0, 2000, 0], [[0, mix(palette.light, PAPER, 0.3, 0)], [1, mix(palette.tint, PAPER, 0, 0.75)]]);
      context.fillRect(1440, 0, 560, HEIGHT);
      const down = (top, bottom) => gradient(context, [0, top, 0, bottom], [[0, palette.light], [0.55, palette.mid], [1, palette.deep]]);
      const up = (top, bottom) => gradient(context, [0, top, 0, bottom], [[0, palette.deep], [0.45, palette.mid], [1, palette.light]]);
      [[1465, 200, 517], [1665, 200, 367], [1865, 135, 216]].forEach(([x, width, height]) => {
        context.fillStyle = down(0, height);
        context.fillRect(x, 0, width, height);
      });
      [[1465, 200, 217], [1665, 200, 367], [1865, 135, 517]].forEach(([x, width, height]) => {
        context.fillStyle = up(HEIGHT - height, HEIGHT);
        context.fillRect(x, HEIGHT - height, width, height);
      });
      return;
    }
    // "kelopak": soft petals top right and bottom right.
    const horizontal = gradient(context, [1300, 0, 1650, 0], [[0, mix(palette.tint, PAPER, 0.3, 0)], [0.55, mix(palette.tint, PAPER, 0.1)], [1, mix(palette.tint, palette.deep, 0.35)]]);
    const horizontalSoft = gradient(context, [1000, 0, 1650, 0], [[0, mix(palette.tint, PAPER, 0.8, 0)], [1, mix(palette.tint, PAPER, 0.45)]]);
    const verticalTop = (top, bottom) => gradient(context, [0, top, 0, bottom], [[0, mix(palette.tint, PAPER, 0.08)], [1, mix(palette.tint, PAPER, 0.8, 0)]]);
    const verticalRight = gradient(context, [0, 0, 0, 640], [[0, mix(palette.tint, PAPER, 0.85)], [1, mix(palette.tint, PAPER, 0.12)]]);
    fillPath(context, "M1000,0 H1300 A350,350 0 0 1 1300,300 C1180,300 1060,200 1000,0 Z", horizontalSoft);
    fillPath(context, "M1000,640 C1040,440 1160,300 1300,300 A350,350 0 0 1 1300,640 Z", horizontalSoft);
    fillPath(context, "M1300,-50 A350,350 0 0 1 1300,640 Z", horizontal);
    fillPath(context, "M1680,640 V300 A300,300 0 0 1 1980,0 H2000 V640 Z", verticalRight);
    fillPath(context, "M1680,300 A300,300 0 0 0 1980,0 H1680 Z", PAPER);
    fillPath(context, "M1400,1414 V1080 A325,325 0 0 1 1725,735 V1414 Z", verticalTop(735, HEIGHT));
    context.globalAlpha = 0.8;
    fillPath(context, "M1725,735 A325,325 0 0 1 2000,900 V1414 H1725 Z", verticalTop(735, HEIGHT));
    context.globalAlpha = 0.75;
    fillPath(context, "M1400,1414 A325,325 0 0 1 1725,1085 V1414 Z", PAPER);
    fillPath(context, "M1725,1085 A325,325 0 0 1 2000,1360 V1414 H1725 Z", PAPER);
    context.globalAlpha = 1;
  };

  const setFont = (context, font, spacing = 0) => {
    context.font = font;
    if ("letterSpacing" in context) context.letterSpacing = `${spacing}px`;
  };

  const drawContained = (context, image, x, y, width, height, align = "center") => {
    if (!image) return;
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const left = align === "right" ? x + width - drawWidth : x + (width - drawWidth) / 2;
    context.drawImage(image, left, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  };

  // Long names shrink from 118px to 84px; if still too wide, two balanced lines.
  const layoutName = (context, name, maxWidth) => {
    const widthAt = (text, size) => {
      setFont(context, `700 ${size}px ${DISPLAY}`, size * 0.005);
      return context.measureText(text).width;
    };
    for (let size = 118; size >= 84; size -= 2) {
      if (widthAt(name, size) <= maxWidth) return { size, lines: [name] };
    }
    const words = name.split(" ");
    if (words.length < 2) return { size: 84, lines: [name] };
    let best = null;
    for (let index = 1; index < words.length; index += 1) {
      const lines = [words.slice(0, index).join(" "), words.slice(index).join(" ")];
      const widest = Math.max(...lines.map((line) => widthAt(line, 84)));
      if (!best || widest < best.widest) best = { lines, widest };
    }
    let size = 84;
    while (size > 56 && Math.max(...best.lines.map((line) => widthAt(line, size))) > maxWidth) size -= 2;
    return { size, lines: best.lines };
  };

  // Justified paragraph made of {text, bold} runs; shrinks until it fits the height.
  const layoutParagraph = (context, runs, maxWidth, maxHeight) => {
    const words = [];
    let previous = " ";
    runs.forEach(({ text, bold }) => {
      text.split(/\s+/).filter(Boolean).forEach((word, index) => {
        // Runs that touch without a space (e.g. "Bahagia”.") stay glued together.
        const glue = index === 0 && words.length > 0 && !/^\s/.test(text) && !/\s$/.test(previous);
        words.push({ word, bold, glue });
      });
      previous = text;
    });
    const fontFor = (bold, size) => `${bold ? 600 : 400} ${size}px ${BODY}`;
    for (let size = 30; size >= 22; size -= 1) {
      const spacing = size * 0.03;
      const measured = words.map((item) => {
        setFont(context, fontFor(item.bold, size), spacing);
        return { ...item, width: context.measureText(item.word).width };
      });
      setFont(context, fontFor(false, size), spacing);
      const space = context.measureText(" ").width;
      const lines = [];
      let line = [];
      let lineWidth = 0;
      measured.forEach((item) => {
        const gap = line.length && !item.glue ? space : 0;
        if (line.length && !item.glue && lineWidth + gap + item.width > maxWidth) {
          lines.push(line);
          line = [];
          lineWidth = 0;
        }
        line.push(item);
        lineWidth += (line.length > 1 && !item.glue ? space : 0) + item.width;
      });
      if (line.length) lines.push(line);
      const lineHeight = Math.round(size * 1.3);
      if (lines.length * lineHeight <= maxHeight || size === 22) {
        return { size, spacing, space, lines, lineHeight, overflow: lines.length * lineHeight > maxHeight };
      }
    }
    return null;
  };

  const drawParagraph = (context, layout, x, y, maxWidth) => {
    layout.lines.forEach((line, lineIndex) => {
      const gaps = line.filter((item, index) => index > 0 && !item.glue).length;
      const used = line.reduce((sum, item) => sum + item.width, 0);
      const last = lineIndex === layout.lines.length - 1;
      const gapWidth = !last && gaps ? (maxWidth - used) / gaps : layout.space;
      let cursor = x;
      line.forEach((item, index) => {
        if (index > 0 && !item.glue) cursor += gapWidth;
        setFont(context, `${item.bold ? 600 : 400} ${layout.size}px ${BODY}`, layout.spacing);
        context.fillText(item.word, cursor, y + lineIndex * layout.lineHeight);
        cursor += item.width;
      });
    });
  };

  const drawQr = (context, url, x, y, size) => {
    if (typeof window.qrcode !== "function") return;
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.floor(size / (count + 6));
    const offset = (size - cell * count) / 2;
    context.fillStyle = "#fff";
    context.beginPath();
    context.roundRect(x, y, size, size, 8);
    context.fill();
    context.fillStyle = INK;
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) context.fillRect(x + offset + column * cell, y + offset + row * cell, cell, cell);
      }
    }
    setFont(context, `400 17px ${BODY}`);
    context.fillStyle = "#6b6164";
    context.textAlign = "center";
    context.fillText("Pindai untuk cek", x + size / 2, y + size + 10);
    context.fillText("keaslian sertifikat", x + size / 2, y + size + 32);
    context.textAlign = "left";
  };

  const drawSigners = (context, signers) => {
    const three = signers.length === 3;
    const centers = three ? [290, 680, 1070] : [390, 933];
    const width = three ? 360 : 420;
    const inkWidth = three ? 270 : 300;
    const fontSize = three ? 27 : 30;
    context.textAlign = "center";
    signers.forEach((signer, index) => {
      const center = centers[index];
      context.fillStyle = MAROON;
      setFont(context, `600 ${fontSize}px ${DISPLAY}`);
      context.fillText(signer.title || "", center, 1106, width);
      if (signer.stamp) drawContained(context, signer.stamp, center - inkWidth / 2 - 40, 1150, inkWidth * 0.75, 170);
      if (signer.signature) {
        drawContained(context, signer.signature, center - inkWidth / 2, 1150, inkWidth, 170);
      } else {
        context.save();
        context.strokeStyle = "#d4bcbc";
        context.setLineDash([10, 8]);
        context.lineWidth = 3;
        context.strokeRect(center - inkWidth / 2, 1156, inkWidth, 158);
        context.restore();
        context.fillStyle = "#b59a9a";
        setFont(context, `400 22px ${BODY}`);
        context.fillText("belum dipilih", center, 1222);
      }
      context.fillStyle = MAROON;
      setFont(context, `600 ${fontSize}px ${DISPLAY}`);
      context.fillText(signer.name || "", center, 1340, width);
    });
    context.textAlign = "left";
    return three ? { qrX: 1250, qrSize: 160 } : { qrX: 1175, qrSize: 180 };
  };

  // "12 Oktober 2026", "24–25 Oktober 2026", "31 Oktober – 1 November 2026".
  const formatDateRange = (eventDate, endAt) => {
    const [year, month, day] = String(eventDate || "").split("-").map(Number);
    if (!year) return "";
    let end = null;
    if (endAt) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(endAt)).split("-").map(Number);
      if (parts[0] && `${parts.join("-")}` !== `${year}-${month}-${day}`) end = parts;
    }
    if (!end) return `${day} ${months[month - 1]} ${year}`;
    const [endYear, endMonth, endDay] = end;
    if (endYear !== year) return `${day} ${months[month - 1]} ${year} – ${endDay} ${months[endMonth - 1]} ${endYear}`;
    if (endMonth !== month) return `${day} ${months[month - 1]} – ${endDay} ${months[endMonth - 1]} ${year}`;
    return `${day}–${endDay} ${months[month - 1]} ${year}`;
  };

  // First sentence, written from the event; the admin's own sentences follow it.
  const openingRuns = ({ category, title, eventDate, endAt, location, partner }) => {
    const clean = (value) => String(value || "").trim().replace(/\s+/g, " ");
    const kind = clean(category);
    const place = clean(location).replace(/[.\s]+$/, "");
    return [
      { text: `Dalam kegiatan ${kind ? `${kind} ` : ""}`, bold: false },
      { text: `“${clean(title).replace(/^["“”']+|["“”']+$/g, "")}”`, bold: true },
      { text: ` yang diselenggarakan oleh Kita Bahagia${partner ? ` berkolaborasi dengan ${clean(partner)}` : ""} pada ${formatDateRange(eventDate, endAt)}${place ? ` di ${place}` : ""}.`, bold: false },
    ];
  };

  const render = (canvas, spec) => {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");
    context.textBaseline = "top";
    drawBackground(context, spec.ornament || {});

    const logo = spec.logos?.[spec.logoVariant === "white" ? "white" : "color"];
    drawContained(context, logo, 1680, 70, 215, 170);
    if (spec.partnerLogo) drawContained(context, spec.partnerLogo, 1440, 85, 200, 140, "right");

    context.fillStyle = TEXT;
    setFont(context, `400 38px ${BODY}`, 0.76);
    context.fillText(spec.number || "", 140, 96);
    context.fillStyle = GOLD;
    setFont(context, `800 172px ${DISPLAY}`, 0.86);
    context.fillText("SERTIFIKAT", 124, 200);
    context.fillStyle = INK;
    setFont(context, `300 92px ${BODY}`, 2.76);
    context.fillText("PENGHARGAAN", 130, 378);
    context.fillStyle = TEXT;
    setFont(context, `400 34px ${BODY}`);
    context.fillText("diberikan kepada:", 137, 568);

    const name = layoutName(context, String(spec.name || "").trim().replace(/\s+/g, " "), 1250);
    context.fillStyle = MAROON;
    setFont(context, `700 ${name.size}px ${DISPLAY}`, name.size * 0.005);
    const nameLine = Math.round(name.size * 1.1);
    name.lines.forEach((line, index) => context.fillText(line, 128, 610 + index * nameLine, 1300));
    const roleTop = Math.max(782, 610 + name.lines.length * nameLine + 42);

    context.fillStyle = TEXT;
    setFont(context, `italic 500 33px ${DISPLAY}`);
    context.fillText("Sebagai Relawan Tingkat Nasional", 130, roleTop);

    const descriptionTop = roleTop + 68;
    const runs = [...spec.opening, ...(spec.description ? [{ text: ` ${spec.description.replace(/\s+/g, " ").trim()}`, bold: false }] : [])];
    const paragraph = layoutParagraph(context, runs, 1250, 1084 - descriptionTop);
    context.fillStyle = TEXT;
    drawParagraph(context, paragraph, 130, descriptionTop, 1250);

    const { qrX, qrSize } = drawSigners(context, spec.signers || []);
    drawQr(context, spec.qrUrl || "https://kitabahagia.id/sertifikat", qrX, 1150, qrSize);
    return { nameSize: name.size, nameLines: name.lines.length, descriptionSize: paragraph.size, overflow: paragraph.overflow };
  };

  // One-page A4 landscape PDF holding the canvas as a JPEG (no PDF library needed).
  const toPdf = async (canvas, quality = 0.92) => {
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!jpegBlob) throw new Error("Sertifikat tidak dapat diubah menjadi gambar.");
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = (chunk) => {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      parts.push(bytes);
      length += bytes.length;
    };
    const object = (number, dictionary, stream) => {
      offsets[number] = length;
      push(`${number} 0 obj\n${dictionary}\n`);
      if (stream) {
        push("stream\n");
        push(stream);
        push("\nendstream\n");
      }
      push("endobj\n");
    };
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const content = encoder.encode(`q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`);
    push("%PDF-1.4\n");
    push(new Uint8Array([37, 226, 227, 207, 211, 10]));
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    object(4, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    object(5, `<< /Length ${content.length} >>`, content);
    object(6, "<< /Title (Sertifikat Kita Bahagia) /Producer (kitabahagia.id) >>");
    const xref = length;
    push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`);
    push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: "application/pdf" });
  };

  window.KBCertificate = { WIDTH, HEIGHT, loadFonts, render, openingRuns, formatDateRange, toPdf };
})();
