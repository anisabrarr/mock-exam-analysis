/**
 * PRELIM MOCK PROGRAM ANALYZER (Maths umbrella + mx111 logic)
 * -----------------------------------------------------------
 * Files in same folder:
 *  - before-program.csv  (enrolments before; JSON in courseStates)
 *  - after-program.csv   (enrolments after;  JSON in courseStates)
 *  - acuity.csv          (bookings; Type=mock name, Label=present/absent)
 *
 * Rules:
 *  - Chem/Phys:
 *      • Booking code = "chem" / "phys"
 *      • existing if BEFORE active in same code
 *      • gained if AFTER active in same code and NOT before
 *  - Maths:
 *      • Booking code = "mx111"  (prelim program)
 *      • existing for maths only if BEFORE active in "mx111" (likely 0)
 *      • gained for maths if AFTER active in "mtx1" OR "mtx2" and BEFORE not active in either
 */

import fs from "fs";
import Papa from "papaparse";

// ---------- CONFIG: column names ----------
const CFG = {
  // identifiers to match students across files
  emailCols: ["email", "Email"],
  phoneCols: ["phoneNumber", "Phone"],
  nameCols:  ["firstName", "First Name"],

  // both enrolment files store subjects inside stringified JSON 'courseStates'
  before: { subjectCols: ["courseStates"] },
  after:  { subjectCols: ["courseStates"] },

  // Acuity bookings: subject text in 'Type', attendance in 'Label'
  acuity: {
    subjectCols: ["Type"],
    attendanceCols: ["Label"],             // values: "present" / "absent"
    attendanceTrueValues: ["present"],
  },
};

// ---------- Umbrella subjects & labels ----------
/** Umbrella → member codes used in enrolments */
const SUBJECT_GROUPS = {
  chem:  new Set(["chem"]),
  phys:  new Set(["phys"]),
  maths: new Set(["mtx1", "mtx2"]),        // ongoing maths classes after program
};

/** Friendly labels for console */
const SUBJECT_LABEL = {
  chem:  "Year 11 Chemistry",
  phys:  "Year 11 Physics",
  maths: "Year 11 Maths",
};

// ---------- Detect booking code + umbrella from Acuity “Type” ----------
/** Chem/Phys map to same code+umbrella; Maths prelim maps to booking code mx111, umbrella maths */
function detectFromType(typeStr) {
  const t = (typeStr || "").toString().toLowerCase();
  if (/year\s*11.*chem/.test(t))  return { code: "chem",  umbrella: "chem"  };
  if (/year\s*11.*phys/.test(t))  return { code: "phys",  umbrella: "phys"  };
  if (/year\s*11.*(math|maths)/.test(t)) return { code: "mx111", umbrella: "maths" };
  return null; // unmatched type
}

// ---------- Normalize enrolment member codes ----------
/** Converts tokens from courseStates (chem, phys, mtx112, mtx212, mx1/mx2/mx111, etc.) */
function normalizeMemberCode(s) {
  const x = (s || "").toString().trim().toLowerCase();

  if (x.startsWith("chem")) return "chem";
  if (x.startsWith("phys")) return "phys";

  // prelim maths program (booked code)
  if (x.includes("mx111")) return "mx111";

  // Maths Ext 1 (mtx1)
  if (
    x === "mtx1" || x.includes("mtx1") || x.includes("mtx112") ||
    x.includes("mx1") || x.includes("methods 1") || x.includes("method 1") ||
    x.includes("extension 1") || x.includes("ext 1") ||
    x.includes("maths ext 1") || x.includes("math ext 1")
  ) return "mtx1";

  // Maths Ext 2 (mtx2)
  if (
    x === "mtx2" || x.includes("mtx2") || x.includes("mtx212") ||
    x.includes("mx2") || x.includes("methods 2") || x.includes("method 2") ||
    x.includes("extension 2") || x.includes("ext 2") ||
    x.includes("maths ext 2") || x.includes("math ext 2")
  ) return "mtx2";

  return x;
}

// ---------- Small helpers ----------
const norm = (s) => (s ?? "").toString().trim().toLowerCase();

const firstVal = (row, cols) => {
  for (const c of cols) if (c in row && row[c]) return row[c];
  return "";
};

const idKey = (row) => {
  const email = norm(firstVal(row, CFG.emailCols));
  const phone = norm(firstVal(row, CFG.phoneCols)).replace(/\D+/g, "");
  return email || phone;
};

function readCSV(path) {
  const buf = fs.readFileSync(path);
  const isUtf16 = buf[0] === 0xFF && buf[1] === 0xFE;
  const text = isUtf16 ? buf.toString("utf16le") : buf.toString("utf8");
  return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

// ---------- Build enrolment index from courseStates ----------
/** Map<studentKey, { anyActive:boolean, activeMembers:Set<string> }> */
function buildEnrolmentIndex(rows, { subjectCols }) {
  const map = new Map();

  for (const r of rows) {
    const k = idKey(r);
    if (!k) continue;

    const raw = firstVal(r, subjectCols);
    if (!raw) {
      if (!map.has(k)) map.set(k, { anyActive: false, activeMembers: new Set() });
      continue;
    }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.warn(`could not parse courseStates for ${r.email || r.Email || k}`);
      continue;
    }

    const activeMembers = new Set();
    for (const entry of Object.values(parsed)) {
      const state   = entry?.M?.state?.S;   // "ACTIVE" | "UNENROLLED"
      const subject = entry?.M?.subject?.S; // raw token like "chem","phys","mtx112","mx111", etc.
      if (state === "ACTIVE" && subject) {
        activeMembers.add(normalizeMemberCode(subject));
      }
    }

    if (!map.has(k)) map.set(k, { anyActive: false, activeMembers: new Set() });
    const rec = map.get(k);
    if (activeMembers.size > 0) {
      rec.anyActive = true;
      for (const s of activeMembers) rec.activeMembers.add(s);
    }
  }

  return map;
}

// ---------- Membership check: active in umbrella? ----------
/** umbrella maths → any of {mtx1, mtx2}; chem/phys → itself */
function activeInUmbrella(index, studentKey, umbrella) {
  const rec = index.get(studentKey);
  if (!rec) return false;
  const members = SUBJECT_GROUPS[umbrella] || new Set([umbrella]);
  for (const m of rec.activeMembers) if (members.has(m)) return true;
  return false;
}

/* ========================= MAIN ========================= */

console.log("📘 Reading CSV files...");
const beforeRows = readCSV("test-before.csv");
const afterRows  = readCSV("test-after.csv");
const acuityRows = readCSV("test-acuity.csv");

console.log("🔍 Building enrolment indexes...");
const beforeIdx = buildEnrolmentIndex(beforeRows, CFG.before);
const afterIdx  = buildEnrolmentIndex(afterRows,  CFG.after);

console.log(
  "✅ BEFORE member codes:",
  [...new Set([...beforeIdx.values()].flatMap(v => [...v.activeMembers]))].slice(0, 20)
);
console.log(
  "✅ AFTER member codes:",
  [...new Set([...afterIdx.values()].flatMap(v => [...v.activeMembers]))].slice(0, 20)
);

// ---------- Classify each booking (BEFORE-only) ----------
const attendedTrue = new Set(CFG.acuity.attendanceTrueValues.map(norm));

function classifyBooking(row) {
  const key = idKey(row);
  const typeStr = firstVal(row, CFG.acuity.subjectCols);
  const det = detectFromType(typeStr);
  const bookingCode = det ? det.code : "(unknown)";     // chem | phys | mx111 | (unknown)
  const umbrella    = det ? det.umbrella : "(unknown)"; // chem | phys | maths | (unknown)
  const attended    = attendedTrue.has(norm(firstVal(row, CFG.acuity.attendanceCols)));
  const before = beforeIdx.get(key);

  // not in system at all
  if (!before) return { key, bookingCode, umbrella, attended, state: "completely_new" };

  if (before.anyActive) {
    // Maths special rule: existing only if BEFORE active in mx111 (prelim program itself)
    if (bookingCode === "mx111") {
      if (before.activeMembers.has("mx111")) {
        return { key, bookingCode, umbrella, attended, state: "existing" };
      }
      return { key, bookingCode, umbrella, attended, state: "existing_other_subject" };
    }

    // Chem/Phys: existing if BEFORE active in same code
    if (before.activeMembers.has(bookingCode)) {
      return { key, bookingCode, umbrella, attended, state: "existing" };
    }
    return { key, bookingCode, umbrella, attended, state: "existing_other_subject" };
  }

  // in system but not active anywhere
  return { key, bookingCode, umbrella, attended, state: "lead" };
}

const bookings = acuityRows.map(classifyBooking);

// warn on unmatched Acuity Types (helps catch typos)
const unmatchedTypes = acuityRows
  .map(r => firstVal(r, CFG.acuity.subjectCols))
  .filter(t => !detectFromType(t));
if (unmatchedTypes.length) {
  console.warn("\n⚠️ Unmatched Acuity Types (not mapped):");
  console.warn([...new Set(unmatchedTypes)].slice(0, 10));
}

// ---------- Summaries (by umbrella) ----------
function summarizeByUmbrella(rows) {
  const out = {};
  for (const b of rows) {
    const u = b.umbrella || "(unknown)";
    if (!out[u]) out[u] = {
      total: 0, attended: 0,
      existing: 0, existing_other_subject: 0, lead: 0, completely_new: 0
    };
    const rec = out[u];
    rec.total += 1;
    if (b.attended) rec.attended += 1;
    rec[b.state] += 1;
  }
  return out;
}

const summary = summarizeByUmbrella(bookings);

// ---------- Gains (AFTER vs BEFORE, umbrella-aware) ----------
/**
 * Count as gained if:
 *  • AFTER active in umbrella (maths → any of {mtx1, mtx2}; chem/phys → itself)
 *  • BEFORE NOT active in umbrella
 */
function countGainsUmbrella(rows) {
  const out = {};
  const dedupe = new Set();

  for (const b of rows) {
    const u = b.umbrella || "(unknown)";
    const k = `${b.key}::${u}`;
    if (dedupe.has(k)) continue;
    dedupe.add(k);
    if (u === "(unknown)") continue;

    const wasBefore = activeInUmbrella(beforeIdx, b.key, u);
    const isAfter   = activeInUmbrella(afterIdx,  b.key, u);
    const gained    = isAfter && !wasBefore;
    if (!gained) continue;

    if (!out[u]) out[u] = {
      gained_total: 0,
      from_existing: 0,
      from_existing_other_subject: 0,
      from_lead: 0,
      from_completely_new: 0,
    };

    out[u].gained_total++;
    if (b.state === "existing")                    out[u].from_existing++;
    else if (b.state === "existing_other_subject") out[u].from_existing_other_subject++;
    else if (b.state === "lead")                   out[u].from_lead++;
    else if (b.state === "completely_new")         out[u].from_completely_new++;
  }
  return out;
}

const gains = countGainsUmbrella(bookings);

// ---------- Print results ----------
const order = ["chem", "maths", "phys", "(unknown)"];
const labelOf = (u) => SUBJECT_LABEL[u] ?? u;

console.log("\n=== SUMMARY BY SUBJECT (BEFORE classifications) ===");
Object.entries(summary)
  .sort((a,b)=> order.indexOf(a[0]) - order.indexOf(b[0]))
  .forEach(([u, c]) => {
    const rate = c.total ? (100 * c.attended / c.total).toFixed(1) : "0.0";
    console.log(`\nSubject: ${labelOf(u)}`);
    console.log(`  Total bookings: ${c.total}`);
    console.log(`  Attendance rate: ${rate}%`);
    console.log(`  Existing (same subject): ${c.existing}`);
    console.log(`  Existing (other subject): ${c.existing_other_subject}`);
    console.log(`  Lead (in system, not active): ${c.lead}`);
    console.log(`  Completely new: ${c.completely_new}`);
  });

console.log("\n=== NEW STUDENTS GAINED AFTER PROGRAM ===");
Object.entries(gains)
  .sort((a,b)=> order.indexOf(a[0]) - order.indexOf(b[0]))
  .forEach(([u, g]) => {
    console.log(`\nSubject: ${labelOf(u)}`);
    console.log(`  Total gained (now active): ${g.gained_total}`);
    console.log(`    from Existing (same subject): ${g.from_existing}`);
    console.log(`    from Existing (other subject): ${g.from_existing_other_subject}`);
    console.log(`    from Lead: ${g.from_lead}`);
    console.log(`    from Completely New: ${g.from_completely_new}`);
  });

console.log("\n✅ Analysis complete!");
