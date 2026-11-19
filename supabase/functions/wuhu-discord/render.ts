// =====================================================================
//  Images pour Discord : pseudo à effet (GIF animé) et vrai arbre (PNG)
//  Texte converti en tracés (opentype.js), rendu SVG → pixels (resvg),
//  GIF encodé avec gifenc. Les polices et emojis viennent de jsDelivr.
// =====================================================================
import opentype from "npm:opentype.js@1.3.4";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import gifenc from "npm:gifenc@1.0.3";
const { GIFEncoder, quantize, applyPalette } = gifenc as any;
import { resolveBracket, roundTitle } from "./bracket.js";

// ---------- Chargement des ressources (mis en cache entre deux appels) ----------
export let loadBytes = async (path: string): Promise<Uint8Array> => {
  const r = await fetch("https://cdn.jsdelivr.net/npm/" + path);
  if (!r.ok) throw new Error("asset " + path + " " + r.status);
  return new Uint8Array(await r.arrayBuffer());
};
export function setLoader(f: (p: string) => Promise<Uint8Array>) { loadBytes = f; }

const FONT_BOLD = "@expo-google-fonts/nunito@0.4.2/800ExtraBold/Nunito_800ExtraBold.ttf";
const FONT_SEMI = "@expo-google-fonts/nunito@0.4.2/700Bold/Nunito_700Bold.ttf";
const FONT_KR = "@expo-google-fonts/noto-sans-kr@0.4.4/700Bold/NotoSansKR_700Bold.ttf";
const FONT_JP = "@expo-google-fonts/m-plus-rounded-1c@0.4.4/800ExtraBold/MPLUSRounded1c_800ExtraBold.ttf";
const WASM = "@resvg/resvg-wasm@2.6.2/index_bg.wasm";

let ready: Promise<void> | null = null;
const fonts: Record<string, any> = {};
async function boot() {
  ready ??= (async () => {
    const [wasm, b, s] = await Promise.all([loadBytes(WASM), loadBytes(FONT_BOLD), loadBytes(FONT_SEMI)]);
    await initWasm(wasm);
    fonts.bold = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    fonts.semi = opentype.parse(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength));
  })();
  return ready;
}
async function fallbackFont(kind: "kr" | "jp") {
  if (!fonts[kind]) {
    const b = await loadBytes(kind === "kr" ? FONT_KR : FONT_JP);
    fonts[kind] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return fonts[kind];
}

const emojiCache = new Map<string, string | null>();
async function emojiData(cluster: string) {
  const cps = [...cluster].map((c) => c.codePointAt(0)!.toString(16));
  const name = (cluster.includes("‍") ? cps : cps.filter((c) => c !== "fe0f")).join("-");
  if (!emojiCache.has(name)) {
    try {
      const svg = await loadBytes(`@twemoji/svg@15.0.0/${name}.svg`);
      emojiCache.set(name, "data:image/svg+xml;base64," + b64(svg));
    } catch { emojiCache.set(name, null); }
  }
  return emojiCache.get(name)!;
}
const avatarCache = new Map<string, string | null>();
async function avatarData(url?: string | null) {
  if (!url) return null;
  const u = url.replace(/\.(webp|gif)(\?|$)/, ".png$2").replace(/size=\d+/, "size=64");
  if (!avatarCache.has(u)) {
    try {
      const r = await fetch(u);
      const type = r.headers.get("content-type") ?? "image/png";
      avatarCache.set(u, r.ok && /png|jpe?g/.test(type) ? `data:${type};base64,${b64(new Uint8Array(await r.arrayBuffer()))}` : null);
    } catch { avatarCache.set(u, null); }
  }
  return avatarCache.get(u)!;
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------- Texte → morceaux (glyphes en tracés + emojis en images) ----------
type Piece = { kind: "glyph"; d: string; x: number; w: number; ch: string } | { kind: "emoji"; href: string | null; x: number; w: number; ch: string };
const isEmoji = (s: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
const seg = new Intl.Segmenter("fr", { granularity: "grapheme" });

async function layout(text: string, size: number, font = fonts.bold) {
  const pieces: Piece[] = [];
  let x = 0;
  for (const { segment: ch } of seg.segment(text)) {
    if (isEmoji(ch)) {
      pieces.push({ kind: "emoji", href: await emojiData(ch), x, w: size * 1.05, ch });
      x += size * 1.12;
      continue;
    }
    let f = font;
    if (f.charToGlyphIndex(ch) === 0 && ch.trim()) {
      const kr = /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch);
      f = await fallbackFont(kr ? "kr" : "jp").catch(() => font);
    }
    const g = f.charToGlyph(ch);
    const w = (g.advanceWidth ?? f.unitsPerEm * 0.5) * (size / f.unitsPerEm);
    pieces.push({ kind: "glyph", d: g.getPath(0, 0, size).toPathData(2), x, w, ch });
    x += w;
  }
  return { pieces, width: x };
}

// Dessine les morceaux à (x0, y0 = ligne de base). paint(i, piece) peut décaler / colorer chaque lettre.
function drawPieces(pieces: Piece[], x0: number, y0: number, size: number, fill: string, extra = "",
  per?: (i: number, p: Piece) => { dy?: number; fill?: string; dx?: number }) {
  return pieces.map((p, i) => {
    const o = per?.(i, p) ?? {};
    const x = x0 + p.x + (o.dx ?? 0), y = y0 + (o.dy ?? 0);
    if (p.kind === "emoji") return p.href ? `<image href="${p.href}" x="${x.toFixed(1)}" y="${(y - size * 0.86).toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.w.toFixed(1)}"/>` : "";
    return `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" d="${p.d}" fill="${o.fill ?? fill}" ${extra}/>`;
  }).join("");
}

function rasterize(svg: string, width: number) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" });
  const img = r.render();
  return { w: img.width, h: img.height, rgba: img.pixels, png: () => img.asPng() };
}

// =====================================================================
//  1. Pseudo à effet : bannière GIF animée
// =====================================================================
const LED = ["#ff3b3b", "#ffb23b", "#fff23b", "#3bff6a", "#3bd8ff", "#c23bff"];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (c1: string, c2: string, t: number) => {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return "#" + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, "0")).join("");
};
const star = (cx: number, cy: number, r: number, fill: string, op = 1) =>
  `<path d="M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${fill}" opacity="${op.toFixed(2)}"/>`;

export async function nameBannerGif(opts: { name: string; effect?: string | null; color?: string | null; avatar?: string | null; subtitle?: string }) {
  await boot();
  const W = 640, H = 168, size = 50;
  const fx = opts.effect ?? "";
  const { pieces, width } = await layout(opts.name, size);
  const sub = opts.subtitle ? await layout(opts.subtitle, 20, fonts.semi) : null;
  const av = await avatarData(opts.avatar);
  // le pseudo est réduit s'il est trop long
  const maxW = W - 190;
  const k = Math.min(1, maxW / Math.max(1, width));
  const x0 = 160, y0 = 92;
  const hearts = fx === "coeurs" ? [await emojiData("💗"), await emojiData("💖")] : [];
  const notes = fx === "musique" ? [await emojiData("🎵"), await emojiData("🎶")] : [];
  const zap = fx === "eclair" ? await emojiData("⚡") : null;
  const flake = fx === "glace" ? await emojiData("❄️") : null;
  const N = fx ? 12 : 1;

  const bgFor: Record<string, [string, string]> = {
    led: ["#1d2030", "#0d0f17"], neon: ["#2a0f35", "#12061c"], galaxie: ["#1b1440", "#0b0a22"], fantome: ["#e9f0f7", "#c9d6e3"],
    feu: ["#3a1206", "#160603"], glace: ["#e6f7ff", "#bfe9ff"], or: ["#3a2a06", "#1d1503"], eclair: ["#0e2240", "#06101f"],
    glitch: ["#f2f5f8", "#d9e1ea"], coeurs: ["#fff0f6", "#ffd6e8"], musique: ["#f5edff", "#e6d6ff"], vague: ["#e8f8ff", "#c8eeff"],
  };
  const [bg1, bg2] = bgFor[fx] ?? ["#eaf7ff", "#cfeeff"];
  const dark = ["led", "neon", "galaxie", "feu", "or", "eclair"].includes(fx);

  const frames: Uint8Array[] = [];
  let dims = { w: W, h: H };
  for (let f = 0; f < N; f++) {
    const t = f / N, TAU = Math.PI * 2;
    let defs = "", body = "", over = "";
    const g = (id: string, stops: [string, number][], x1: number, x2: number, y1 = 0, y2 = 0) =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
    const glow = (id: string, sd: number) => `<filter id="${id}" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
    const text = (fill: string, extra = "", per?: Parameters<typeof drawPieces>[6]) => drawPieces(pieces, 0, 0, size, fill, extra, per);

    switch (fx) {
      case "vague":
        body = text("#1aa3dc", "", (i) => { const s = Math.sin(TAU * (t - i * 0.06)); return { dy: -9 * Math.max(0, s), fill: mix("#1aa3dc", "#3cd2ff", Math.max(0, s)) }; });
        body = `<g transform="translate(0 3)" opacity=".9">${text("#c8f0ff", "", (i) => ({ dy: -9 * Math.max(0, Math.sin(TAU * (t - i * 0.06))) }))}</g>` + body;
        break;
      case "led": {
        const per = (i: number) => ({ fill: LED[(Math.floor(t * 6) + i * 5) % 6] });
        defs += glow("lg", 5);
        body = `<rect x="-16" y="-${size * 0.95}" width="${width + 32}" height="${size * 1.3}" rx="10" fill="#14161c" stroke="#2a2e38" stroke-width="3"/>`
          + `<g filter="url(#lg)">${text("#fff", "", per)}</g>` + text("#fff", "", per);
        break;
      }
      case "glace": {
        const off = lerp(-width, width * 1.5, t);
        defs += g("ice", [["#1f78c8", 0], ["#5cc4ff", .3], ["#e6f8ff", .45], ["#3a9be6", .6], ["#1f78c8", 1]], off - width * .6, off + width * .6);
        body = text("url(#ice)", 'stroke="#ffffff" stroke-width=".6"');
        if (flake) over = `<image href="${flake}" x="${width - 4}" y="${-size - 6 + 4 * Math.sin(TAU * t)}" width="28" height="28" opacity="${(.7 + .3 * Math.sin(TAU * t)).toFixed(2)}"/>`;
        break;
      }
      case "feu": {
        const sh = lerp(0, -size, t);
        defs += g("fire", [["#ffd23f", 0], ["#ff7a00", .45], ["#ff2a00", 1], ["#ffd23f", 1]], 0, 0, -size * 1.2 + sh, size * .5 + sh);
        defs += glow("fg", 4);
        body = `<g filter="url(#fg)" opacity=".8">${text("#ff5a00")}</g>` + text("url(#fire)");
        for (let s = 0; s < 6; s++) {
          const ph = (t + s / 6) % 1, sx = (width / 6) * s + 10 + 6 * Math.sin(TAU * (ph + s));
          over += `<circle cx="${sx.toFixed(1)}" cy="${(-6 - ph * size * 1.4).toFixed(1)}" r="${(3.4 * (1 - ph) + 1).toFixed(1)}" fill="#ffb23b" opacity="${(1 - ph).toFixed(2)}"/>`;
        }
        break;
      }
      case "musique":
        body = text("#8f3fe0");
        notes.forEach((n, j) => {
          if (!n) return;
          const ph = (t + j * .5) % 1;
          over += `<image href="${n}" x="${j ? width + 6 : -40}" y="${-size + 4 - ph * 26}" width="30" height="30" opacity="${Math.sin(Math.PI * ph).toFixed(2)}"/>`;
        });
        break;
      case "coeurs":
        body = text("#ff3d8b");
        hearts.forEach((h, j) => {
          if (!h) return;
          const ph = (t + j * .5) % 1, sc = 1 + .15 * Math.sin(TAU * ph);
          over += `<image href="${h}" x="${j ? width + 6 : -16}" y="${(j ? -size * .75 : -size * 1.25) - 8 * Math.sin(TAU * ph)}" width="${(28 * sc).toFixed(1)}" height="${(28 * sc).toFixed(1)}"/>`;
        });
        break;
      case "neon": {
        const flick = [1, 1, .55, 1, 1, 1, .8, 1, 1, .4, 1, 1, 1, 1, 1, 1][f % 16];
        defs += glow("ng", 7) + glow("ng2", 2.5);
        body = `<g opacity="${flick}"><g filter="url(#ng)">${text("#ff2bd6")}</g><g filter="url(#ng2)">${text("#ff2bd6")}</g>${text("#ffd9f6")}</g>`;
        break;
      }
      case "eclair": {
        const on = f % 6 < 1 || f % 6 === 3;
        defs += glow("eg", on ? 8 : 4);
        body = `<g filter="url(#eg)">${text("#3bb4ff")}</g>` + text(on ? "#fffbd0" : "#ffe600");
        if (zap) over = f % 2 ? `<image href="${zap}" x="${width + 2}" y="${-size - 4}" width="34" height="34"/>` : "";
        break;
      }
      case "glitch": {
        const j = [[3, -2], [-4, 1], [0, 0], [6, 2], [-2, -3], [0, 0], [2, 1], [-5, 2], [0, 0], [4, -1], [-3, 0], [0, 0]][f % 12];
        body = `<g transform="translate(${j[0]} ${j[1]})">${text("#00e5ff")}</g><g transform="translate(${-j[0]} ${-j[1]})">${text("#ff2bd6")}</g>` + text("#1c2b39");
        if (f % 4 === 1) over = `<rect x="-6" y="${-size * .55}" width="${width + 12}" height="7" fill="#00e5ff" opacity=".5"/>`;
        break;
      }
      case "fantome": {
        defs += glow("gh", 6);
        const op = .45 + .5 * (.5 + .5 * Math.sin(TAU * t));
        body = `<g transform="translate(0 ${(-5 * Math.sin(TAU * t)).toFixed(1)})" opacity="${op.toFixed(2)}"><g filter="url(#gh)">${text("#78a0c8")}</g>${text("#5f7a93")}</g>`;
        break;
      }
      case "galaxie": {
        const off = lerp(0, width * 2, t);
        defs += `<linearGradient id="gal" gradientUnits="userSpaceOnUse" spreadMethod="repeat" x1="${off}" y1="0" x2="${off + width * 1.2}" y2="0">${[["#6b4bff", 0], ["#d76d77", .25], ["#3a8dff", .5], ["#b07bff", .75], ["#6b4bff", 1]].map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
        defs += glow("gg", 5);
        body = `<g filter="url(#gg)" opacity=".7">${text("#7b5bff")}</g>` + text("url(#gal)");
        [[-18, -size * .8, 0], [width + 14, -6, .35], [width * .5, -size * 1.05, .7], [width * .2, 10, .5]].forEach(([x, y, p]) => {
          over += star(x, y, 8, "#ffe9a8", .2 + .8 * Math.abs(Math.sin(Math.PI * (t + p))));
        });
        break;
      }
      case "or": {
        const off = lerp(-width, width * 1.6, t);
        defs += g("gold", [["#b8860b", 0], ["#ffd700", .35], ["#fff6c4", .5], ["#ffd700", .65], ["#b8860b", 1]], off - width * .5, off + width * .5);
        defs += glow("og", 4);
        body = `<g filter="url(#og)" opacity=".6">${text("#ffb000")}</g>` + text("url(#gold)");
        over = star(width + 12, -size * .85, 11 * (.6 + .4 * Math.abs(Math.sin(TAU * t))), "#ffd700")
          + star(-14, -6, 7 * (.6 + .4 * Math.abs(Math.cos(TAU * t))), "#fff6c4");
        break;
      }
      default:
        body = text(opts.color || "#23384d");
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>${g("bg", [[bg1, 0], [bg2, 1]], 0, W, 0, H)}<clipPath id="avc"><circle cx="80" cy="84" r="56"/></clipPath>${defs}</defs>
      <rect width="${W}" height="${H}" rx="26" fill="${bg1}"/>
      <circle cx="80" cy="84" r="60" fill="${dark ? "#ffffff22" : "#ffffff"}"/>
      ${av ? `<image href="${av}" x="24" y="28" width="112" height="112" clip-path="url(#avc)" preserveAspectRatio="xMidYMid slice"/>` : `<circle cx="80" cy="84" r="56" fill="#5865f2"/>`}
      <g transform="translate(${x0} ${y0}) scale(${k.toFixed(3)})">${body}${over}</g>
      ${sub ? drawPieces(sub.pieces, x0, 132, 20, dark ? "#c9d3f0" : "#5a7086") : ""}
    </svg>`;
    const img = rasterize(svg, W);
    dims = { w: img.w, h: img.h };
    frames.push(img.rgba);
  }

  // Une seule palette pour toutes les images : moins de scintillement, fichier plus léger
  const sample = new Uint8Array(frames.length > 1 ? frames[0].length * 2 : frames[0].length);
  sample.set(frames[0]);
  if (frames.length > 1) sample.set(frames[Math.floor(frames.length / 2)], frames[0].length);
  const palette = quantize(sample, 256, { format: "rgba4444", oneBitAlpha: true });
  const tIdx = palette.findIndex((c: number[]) => c[3] === 0);
  const gif = GIFEncoder();
  for (const fr of frames) {
    gif.writeFrame(applyPalette(fr, palette, "rgba4444"), dims.w, dims.h, {
      palette, delay: ["led", "glitch", "eclair"].includes(fx) ? 140 : 90, transparent: tIdx >= 0, transparentIndex: Math.max(0, tIdx), dispose: 2,
    });
  }
  gif.finish();
  return gif.bytes();
}

// =====================================================================
//  2. Le vrai arbre du tournoi (PNG)
// =====================================================================
type Person = { id: string; username: string; avatar_url?: string | null; color?: string | null };

export async function bracketPng(t: { name: string; bracket: any }, people: Map<string, Person>, preview = false) {
  await boot();
  const B = t.bracket, res: any = resolveBracket(B);
  const NS = B.format === "ffa4" ? 4 : 2, PLACE = ["1er", "2e", "3e", "4e"];
  const MW = 236, ROW = 32, MH = ROW * NS, GAPX = 56, PAD = 28, HEAD = 74, TITLE = 30;
  const avs = new Map<string, string | null>();
  await Promise.all([...people.values()].map(async (p) => avs.set(p.id, await avatarData(p.avatar_url))));

  const sections = B.format === "double" ? [["W", "Tableau des gagnants"], ["L", "Tableau des perdants"], ["GF", "Grande finale"]] : [["W", ""]];
  let y = HEAD, maxW = 600;
  let out = "", lines = "";
  let clipN = 0;

  for (const [b, label] of sections) {
    const rounds: Record<number, any[]> = {};
    B.matches.filter((m: any) => m.b === b).forEach((m: any) => (rounds[m.r] ||= []).push(m));
    const cols = Object.keys(rounds).map(Number).sort((a, c) => a - c)
      .filter((r) => !(b === "GF" && r === 2 && res.state.GF2.dead))
      .filter((r) => rounds[r].some((m: any) => !res.state[m.id].dead));
    if (!cols.length) continue;
    if (label) { out += await txt(label, PAD, y + 22, 22, "#1a6fa8", fonts.bold); y += 34; }
    // hauteur : le 1er tour dicte l'espacement (arbre classique), sinon empilement simple
    const first = rounds[cols[0]].length;
    const slotH = MH + 22;
    const secH = Math.max(first * slotH, MH + 20) + TITLE;
    const pos = new Map<string, { x: number; y: number }>();
    for (let ci = 0; ci < cols.length; ci++) {
      const r = cols[ci], ms = rounds[r];
      const x = PAD + ci * (MW + GAPX);
      out += await txt(roundTitle(B, b, r).toUpperCase(), x + 4, y + 18, 14, "#7d93a8", fonts.semi);
      const span = (secH - TITLE) / ms.length;
      for (let mi = 0; mi < ms.length; mi++) {
        const m = ms[mi], s = res.state[m.id];
        const my = y + TITLE + span * mi + (span - MH) / 2;
        pos.set(m.id, { x, y: my });
        if (s.dead) continue;
        const live = s.playable && !s.done;
        out += `<rect x="${x}" y="${my}" width="${MW}" height="${MH}" rx="12" fill="#ffffff" stroke="${live ? "#ffd84d" : "#dbe8f2"}" stroke-width="${live ? 3 : 2}"/>`;
        for (let k = 1; k < NS; k++) out += `<line x1="${x + 8}" x2="${x + MW - 8}" y1="${my + k * ROW}" y2="${my + k * ROW}" stroke="#eef3f7" stroke-width="2"/>`;
        for (let k = 0; k < NS; k++) {
          const id = s.players[k], p = id ? people.get(id) : null;
          const ry = my + k * ROW;
          const place = NS === 4 && s.ranking && id ? s.ranking.indexOf(id) : -1;
          const win = NS === 4 ? place >= 0 && place < 2 && !s.bye : s.done && s.winner && s.winner === id;
          const lose = NS === 4 ? place >= 2 : s.done && !s.bye && s.loser === id;
          if (win) out += `<rect x="${x + 2}" y="${ry + 2}" width="${MW - 4}" height="${ROW - 3}" rx="${k ? 4 : 10}" fill="#e3f9ea"/>`;
          if (p) {
            const a = avs.get(p.id);
            const cid = `c${clipN++}`;
            out += a ? `<clipPath id="${cid}"><circle cx="${x + 20}" cy="${ry + ROW / 2}" r="10"/></clipPath><image href="${a}" x="${x + 10}" y="${ry + ROW / 2 - 10}" width="20" height="20" clip-path="url(#${cid})"/>`
              : `<circle cx="${x + 20}" cy="${ry + ROW / 2}" r="10" fill="#5865f2"/>`;
            out += await txt(p.username, x + 36, ry + ROW / 2 + 6, 16, lose ? "#a3b1bf" : p.color || "#23384d", fonts.bold, MW - 80);
          } else {
            out += await txt(s.deadSlot[k] ? (NS === 4 ? "—" : "Exempt") : "En attente…", x + 12, ry + ROW / 2 + 6, 15, "#a3b1bf", fonts.semi);
          }
          const sc = NS === 4 ? (place >= 0 && !s.bye ? PLACE[place] : "") : s.result?.s ? String(s.result.s[k]) : win ? "✓" : "";
          if (sc) out += await txt(sc, x + MW - (NS === 4 ? 34 : 24), ry + ROW / 2 + 6, 17, win ? "#1f9d55" : "#7d93a8", fonts.bold);
        }
      }
      // traits vers le match suivant (tableau principal uniquement : structure en arbre)
      if (b === "W" && ci > 0) {
        for (const m of ms) {
          const s = res.state[m.id]; if (s.dead) continue;
          const to = pos.get(m.id)!;
          for (const sl of m.slots) {
            const from = sl.src && pos.get(sl.src.m);
            if (!from || res.state[sl.src.m].dead) continue;
            const fx = from.x + MW, fy = from.y + MH / 2, tx = to.x, ty = to.y + MH / 2, mx = fx + GAPX / 2;
            lines += `<path d="M${fx} ${fy} H${mx} V${ty} H${tx}" fill="none" stroke="#9cc9e6" stroke-width="3" stroke-linejoin="round"/>`;
          }
        }
      }
      maxW = Math.max(maxW, x + MW + PAD);
    }
    y += secH + 26;
  }

  // champion
  const champ = res.champion ? people.get(res.champion) : null;
  const W = Math.max(maxW, 640), H = y + (champ ? 40 : 0);
  let head = await txt(t.name, PAD, 46, 30, "#ffffff", fonts.bold, W - PAD * 2 - 160);
  if (preview) head += await txt("APERÇU", W - PAD - 92, 44, 16, "#fff6c4", fonts.bold);
  let foot = "";
  if (champ) foot = await txt(`🏆 Champion : ${champ.username}`, PAD, H - 20, 24, "#b8860b", fonts.bold);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3fbff"/><stop offset="1" stop-color="#dff2fd"/></linearGradient>
    <linearGradient id="hd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#29abe2"/><stop offset="1" stop-color="#1a7fc4"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${HEAD - 10}" fill="url(#hd)"/>
    ${head}${lines}${out}${foot}
  </svg>`;
  const scale = Math.min(2, 2400 / W);
  return rasterize(svg, Math.round(W * scale)).png();
}

async function txt(s: string, x: number, y: number, size: number, fill: string, font: any, maxW?: number) {
  let { pieces, width } = await layout(s, size, font);
  if (maxW && width > maxW) {
    while (pieces.length > 1 && width > maxW - size * 0.6) { pieces = pieces.slice(0, -1); width = pieces.at(-1)!.x + pieces.at(-1)!.w; }
    const dot = await layout("…", size, font);
    pieces = [...pieces, ...dot.pieces.map((p) => ({ ...p, x: p.x + width }))];
  }
  return `<g>${drawPieces(pieces, x, y, size, fill)}</g>`;
}
export { esc };

// =====================================================================
//  3. Cartes visuelles pour les commandes (/coffre, /daily, /quiz, /defi)
// =====================================================================
const R_COL: Record<string, string> = { commun: "#9aa8b5", rare: "#2f8fe8", epique: "#9b4de0", legendaire: "#f5b301" };
function chestArt(x: number, y: number, s: number, open = false) {
  const [a, b, c] = ["#ffcf3f", "#c48a00", "#fff3b0"];
  const lid = open
    ? `<g transform="translate(60 46) rotate(-28) translate(-60 -46) translate(-6 -10)"><path d="M14 48 Q14 16 60 16 Q106 16 106 48 Z" fill="${a}" stroke="${b}" stroke-width="4"/><path d="M30 22 Q60 12 90 22" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/></g>`
    : `<path d="M14 48 Q14 16 60 16 Q106 16 106 48 Z" fill="${a}" stroke="${b}" stroke-width="4"/><path d="M30 22 Q60 12 90 22" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="60" cy="94" rx="46" ry="6" fill="rgba(0,0,0,.25)"/>
    ${open ? `<path d="M60 50 L20 -30 L100 -30 Z" fill="#fff6c4" opacity=".55"/>` : ""}
    <rect x="14" y="46" width="92" height="44" rx="8" fill="${a}" stroke="${b}" stroke-width="4"/>
    <rect x="14" y="58" width="92" height="6" fill="${b}" opacity=".5"/>
    ${lid}
    <rect x="50" y="40" width="20" height="22" rx="4" fill="${c}" stroke="${b}" stroke-width="3"/>
    <circle cx="60" cy="50" r="3" fill="${b}"/>
  </g>`;
}
function rays(cx: number, cy: number, r: number, color: string, n = 12) {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a1 = (i / n) * Math.PI * 2, a2 = a1 + Math.PI / n;
    d += `M${cx} ${cy} L${(cx + r * Math.cos(a1)).toFixed(1)} ${(cy + r * Math.sin(a1)).toFixed(1)} L${(cx + r * Math.cos(a2)).toFixed(1)} ${(cy + r * Math.sin(a2)).toFixed(1)}Z`;
  }
  return `<path d="${d}" fill="${color}"/>`;
}
const pill = (x: number, y: number, w: number, h: number, fill: string, op = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="${op}"/>`;
async function avatarCircle(url: string | null | undefined, cx: number, cy: number, r: number, id: string, ring = "#ffffff", ringW = 5) {
  const a = await avatarData(url);
  return `<circle cx="${cx}" cy="${cy}" r="${r + ringW}" fill="${ring}"/>` + (a
    ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image href="${a}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#5865f2"/>`);
}
function frame(W: number, H: number, bg: [string, string], body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" rx="28" fill="url(#cbg)"/>${body}</svg>`;
}
const png = (svg: string, W: number) => rasterize(svg, W * 2).png();

export async function chestCard(o: { name: string; price: number; have: number; weights: Record<string, number> }) {
  await boot();
  const W = 720, H = 260;
  const tot = Object.values(o.weights).reduce((a, b) => a + b, 0) || 1;
  let body = rays(150, 140, 260, "rgba(255,255,255,.07)", 14) + `<circle cx="150" cy="140" r="96" fill="#ffd84d" opacity=".25"/>`;
  body += chestArt(52, 40, 1.65);
  for (const [sx, sy, sr] of [[60, 50, 9], [250, 62, 7], [236, 210, 6], [44, 196, 5]]) body += star(sx, sy, sr, "#fff6c4", .9);
  body += await txt(o.name, 300, 72, 36, "#ffffff", fonts.bold, 400);
  const ok = o.have >= o.price;
  body += pill(300, 92, 150, 38, "#ffffff", .18) + await txt(`${o.price} 💎`, 318, 120, 24, "#fff6c4", fonts.bold);
  body += pill(462, 92, 220, 38, ok ? "#3ddc84" : "#ff6b6b", .9) + await txt(ok ? `Tu as ${o.have} 💎` : `Il manque ${o.price - o.have} 💎`, 480, 120, 20, "#ffffff", fonts.bold, 190);
  const RN: Record<string, string> = { commun: "Commun", rare: "Rare", epique: "Épique", legendaire: "Légendaire" };
  let y = 160;
  for (const k of ["commun", "rare", "epique", "legendaire"]) {
    const p = (o.weights[k] ?? 0) / tot;
    body += await txt(RN[k], 300, y + 14, 16, "#ffffff", fonts.semi);
    body += pill(410, y + 2, 230, 14, "#000000", .25) + pill(410, y + 2, Math.max(14, 230 * p), 14, R_COL[k]);
    body += await txt(`${Math.round(p * 100)}%`, 650, y + 15, 15, "#ffffff", fonts.bold);
    y += 22;
  }
  return png(frame(W, H, ["#7a3fd1", "#2b1a63"], body), W);
}

export async function dailyCard(o: { name: string; avatar?: string | null; streak: number; amount: number; next: number }) {
  await boot();
  const W = 720, H = 250, AM = [5, 5, 10, 10, 15, 15, 30];
  const pos = ((o.streak - 1) % 7);
  let body = await avatarCircle(o.avatar, 64, 62, 34, "dav", "#fff", 4);
  body += await txt("Récompense du jour", 116, 56, 30, "#ffffff", fonts.bold);
  body += await txt(`🔥 Série de ${o.streak} jour${o.streak > 1 ? "s" : ""} · ${o.name}`, 118, 88, 18, "#fff3d6", fonts.semi, 560);
  const tw = 86, gap = 10, x0 = (W - (7 * tw + 6 * gap)) / 2, ty = 120;
  for (let i = 0; i < 7; i++) {
    const x = x0 + i * (tw + gap), past = i < pos, cur = i === pos, big = i === 6;
    const fill = cur ? "#ffd84d" : past ? "#ffffff" : "rgba(255,255,255,.18)";
    body += `<rect x="${x}" y="${ty}" width="${tw}" height="104" rx="18" fill="${fill}" ${cur ? 'stroke="#fff" stroke-width="4"' : ""}/>`;
    body += await txt(`Jour ${i + 1}`, x + 14, ty + 26, 15, cur ? "#7a4a00" : past ? "#2fa26a" : "#ffffff", fonts.bold);
    const ic = past ? "✅" : big ? "🎁" : "💎";
    body += await txt(ic, x + tw / 2 - 14, ty + 64, 26, "#fff", fonts.bold);
    body += await txt(`+${AM[i]}`, x + 18, ty + 92, 20, cur ? "#7a4a00" : past ? "#7d93a8" : "#ffffff", fonts.bold);
  }
  body += pill(W - 230, 32, 200, 44, "#ffffff", .95) + await txt(`+${o.amount} 💎`, W - 200, 63, 26, "#e08a00", fonts.bold);
  return png(frame(W, H, ["#ff9a3d", "#e8487a"], body), W);
}

export async function quizCard(o: { day: string; reward: number; count: number }) {
  await boot();
  const W = 720, H = 180;
  let body = "";
  for (const [x, y, s, r] of [[600, 40, 70, -15], [665, 120, 46, 18]]) {
    body += `<g transform="translate(${x} ${y}) rotate(${r})"><circle r="${s / 1.6}" fill="rgba(255,255,255,.14)"/></g>`;
    body += await txt("?", x - s * .22, y + s * .3, s, "rgba(255,255,255,.9)", fonts.bold);
  }
  body += pill(36, 30, 210, 34, "#ffffff", .95) + await txt("🎮 Quiz Nintendo", 52, 55, 18, "#e4000f", fonts.bold);
  body += await txt("Question du jour", 36, 112, 40, "#ffffff", fonts.bold);
  const d = new Date(o.day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  body += await txt(`${d} · +${o.reward} 💎 · ${o.count} réponse${o.count > 1 ? "s" : ""}`, 38, 148, 18, "#ffe0e0", fonts.semi, 520);
  return png(frame(W, H, ["#ff2a3a", "#a8001a"], body), W);
}

export async function duelCard(o: { a: Person; b: Person; game?: string | null; status: string; winner?: string | null; reward?: [number, number] | null }) {
  await boot();
  const W = 720, H = 270, done = o.status === "done", off = ["declined", "cancelled"].includes(o.status);
  let body = rays(W / 2, 130, 420, "rgba(255,255,255,.05)", 18);
  const side = async (p: Person, cx: number, id: string) => {
    const win = done && o.winner === p.id, lose = done && o.winner && o.winner !== p.id;
    let s = await avatarCircle(p.avatar_url, cx, 112, 62, id, win ? "#ffd84d" : lose ? "#6b7a8a" : "#ffffff", win ? 8 : 5);
    if (lose || off) s += `<circle cx="${cx}" cy="112" r="62" fill="#0b1020" opacity=".45"/>`;
    if (win) s += await txt("👑", cx - 24, 52, 44, "#fff", fonts.bold);
    const nm = await layout(p.username, 24);
    const w = Math.min(nm.width, 220);
    s += await txt(p.username, cx - w / 2, 212, 24, lose || off ? "#a3b1bf" : "#ffffff", fonts.bold, 220);
    return s;
  };
  body += await side(o.a, 150, "da") + await side(o.b, W - 150, "db");
  body += `<circle cx="${W / 2}" cy="112" r="44" fill="#ffd84d"/><circle cx="${W / 2}" cy="112" r="36" fill="#ff5a3d"/>`;
  body += await txt("VS", W / 2 - 22, 124, 32, "#ffffff", fonts.bold);
  const label = o.status === "pending" ? "DÉFI LANCÉ" : o.status === "accepted" ? "MATCH EN COURS" : o.status === "claimed" ? "RÉSULTAT À CONFIRMER"
    : done ? "VICTOIRE !" : o.status === "declined" ? "DÉFI REFUSÉ" : "DÉFI ANNULÉ";
  const lw = (await layout(label, 18)).width + 36;
  body += pill(W / 2 - lw / 2, 22, lw, 32, done ? "#3ddc84" : off ? "#6b7a8a" : "#ffffff", done || off ? 1 : .2) + await txt(label, W / 2 - lw / 2 + 18, 45, 18, "#ffffff", fonts.bold);
  if (o.game) { const g = (await layout(o.game, 17, fonts.semi)).width; body += await txt(o.game, W / 2 - Math.min(g, 200) / 2, 182, 17, "#ffe9a8", fonts.semi, 200); }
  if (done && o.reward && (o.reward[0] || o.reward[1])) {
    const t = `Gagnant +${o.reward[0]} 💎 +${o.reward[0]} 🍄 · perdant +${o.reward[1]} 💎 +${o.reward[1]} 🍄`;
    const tw = (await layout(t, 17, fonts.semi)).width + 30;
    body += pill(W / 2 - tw / 2, 232, tw, 28, "#000000", .3) + await txt(t, W / 2 - tw / 2 + 15, 252, 17, "#fff6c4", fonts.semi);
  }
  return png(frame(W, H, off ? ["#5b6b7d", "#2c3846"] : done ? ["#1f9d55", "#0d4f3c"] : ["#ff7a2f", "#7a1fa8"], body), W);
}

export async function podiumCard(o: { title: string; top: { name: string; avatar?: string | null; pts: number; rubis?: number }[] }) {
  await boot();
  const W = 720, H = 360;
  let body = rays(W / 2, H, 560, "rgba(255,255,255,.05)", 20);
  body += await txt(o.title, 32, 48, 28, "#ffffff", fonts.bold, 300);
  const slots = [{ i: 1, x: 150, h: 80, c: "#c9d6e3" }, { i: 0, x: 360, h: 120, c: "#ffd84d" }, { i: 2, x: 570, h: 56, c: "#e0a86a" }];
  for (const s of slots) {
    const p = o.top[s.i]; if (!p) continue;
    const base = H - 16, top = base - s.h, r = s.i === 0 ? 40 : 32;
    body += `<rect x="${s.x - 80}" y="${top}" width="160" height="${s.h}" rx="14" fill="${s.c}"/>`;
    body += await txt(`${s.i + 1}`, s.x - 11, top + 40, 34, "#ffffff", fonts.bold);
    const label = `${p.pts} pt${p.pts > 1 ? "s" : ""}${p.rubis ? ` · +${p.rubis}💎 +${p.rubis}🍄` : ""}`;
    const lw = Math.min((await layout(label, 15, fonts.semi)).width, 205);
    body += await txt(label, s.x - lw / 2, top - 10, 15, "#fff6c4", fonts.semi, 205);
    const nw = Math.min((await layout(p.name, 18)).width, 170);
    body += await txt(p.name, s.x - nw / 2, top - 32, 18, "#ffffff", fonts.bold, 170);
    const cy = top - 54 - r;
    body += await avatarCircle(p.avatar, s.x, cy, r, `pd${s.i}`, s.c, 5);
    if (s.i === 0) body += await txt("👑", s.x - 20, cy - r - 6, 38, "#fff", fonts.bold);
  }
  return png(frame(W, H, ["#2a8fe0", "#5b3fd1"], body), W);
}

// Petit badge carré (vignette en haut à droite de Discord) : doit rester lisible en tout petit
export async function quizBadge() {
  await boot();
  const W = 256;
  let body = `<circle cx="128" cy="128" r="118" fill="#ffffff"/><circle cx="128" cy="128" r="104" fill="#e4000f"/>`;
  body += await txt("?", 92, 170, 150, "#ffffff", fonts.bold);
  body += pill(58, 186, 140, 44, "#ffffff") + await txt("QUIZ", 84, 219, 32, "#e4000f", fonts.bold);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${body}</svg>`;
  return rasterize(svg, W * 2).png();
}

// Bannière du lobby Quiz Battle : titre, nombre de questions et avatars des joueurs inscrits
export async function quizBattleCard(o: { total: number; players: { n: string; a?: string | null }[] }) {
  await boot();
  const W = 720, H = 260;
  let body = rays(110, 130, 420, "rgba(255,255,255,.06)", 16);
  for (const [x, y, s, r] of [[620, 60, 74, 14], [560, 190, 44, -12], [680, 200, 36, 20]]) {
    body += `<g transform="translate(${x} ${y}) rotate(${r})"><circle r="${s / 1.5}" fill="rgba(255,255,255,.12)"/></g>`;
    body += await txt("?", x - s * .22, y + s * .3, s, "rgba(255,255,255,.85)", fonts.bold);
  }
  body += `<circle cx="96" cy="100" r="62" fill="#ffd84d"/><circle cx="96" cy="100" r="52" fill="#ff5a3d"/>`;
  body += await txt("⚡", 66, 124, 58, "#fff", fonts.bold);
  body += await txt("QUIZ BATTLE", 182, 92, 46, "#ffffff", fonts.bold, 380);
  body += pill(182, 108, 300, 36, "#ffffff", .95) + await txt(`🎮 ${o.total} questions Nintendo`, 198, 133, 19, "#2a5fd0", fonts.bold, 270);
  body += await txt("Le plus rapide marque le point !", 184, 172, 19, "#e6ecff", fonts.semi, 380);
  const ps = o.players.slice(0, 8), r = 22;
  let x = 52;
  for (let i = 0; i < ps.length; i++) { body += await avatarCircle(ps[i].a, x + r, 222, r, `qb${i}`, "#ffffff", 3); x += r * 2 + 12; }
  const left = ps.length ? `${o.players.length} joueur${o.players.length > 1 ? "s" : ""}${o.players.length < 2 ? " · il en faut 2" : " · prêts ?"}` : "En attente de joueurs…";
  body += await txt(left, x + 6, 230, 18, "#fff6c4", fonts.bold, W - x - 30);
  return png(frame(W, H, ["#3b6ff0", "#7a2fd1"], body), W);
}

// Petites pubs du site postées dans le salon général
export async function promoCard(o: { icon: string; title: string; sub: string; bg: [string, string] }) {
  await boot();
  const W = 720, H = 220;
  let body = rays(W - 120, 110, 420, "rgba(255,255,255,.06)", 16);
  body += `<circle cx="${W - 120}" cy="110" r="78" fill="rgba(255,255,255,.18)"/><circle cx="${W - 120}" cy="110" r="62" fill="rgba(255,255,255,.9)"/>`;
  body += await txt(o.icon, W - 120 - 36, 134, 66, "#fff", fonts.bold);
  body += pill(36, 30, 190, 34, "#ffffff", .95) + await txt("🏝️ L'île Wuhu", 54, 55, 18, "#1689c9", fonts.bold);
  body += await txt(o.title, 36, 120, 40, "#ffffff", fonts.bold, 470);
  body += await txt(o.sub, 38, 160, 19, "#ffffff", fonts.semi, 470);
  for (const [sx, sy, sr] of [[520, 40, 7], [470, 190, 5], [690, 30, 6]]) body += star(sx, sy, sr, "#fff6c4", .9);
  return png(frame(W, H, o.bg, body), W);
}
