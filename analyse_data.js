// PRELIM MOCK EXAM PROGRAM DATA ANALYSIS

import fs from "fs";
import Papa from "papaparse";

// CONFIG

const CFG = {
  emailCols: ["email", "Email"],
  phoneCols: ["phoneNumber", "Phone"],

  before: { subjectCols: ["courseStates"] },
  after:  { subjectCols: ["courseStates"] },

  acuity: {
    subjectCols: ["Type"],
    attendanceCols: ["Label"],
    attendanceTrueValues: new Set(["present"]), 
  },
};

// CONSTANTS/REGEX

const REGEX = {
  chem: /year\s*11.*chem/i,
  phys: /year\s*11.*phys/i,
  maths: /year\s*11.*(math|maths|mathematics)/i,
  digits: /\D+/g,
};

// map course codes to differnt subjects
const SUBJECT_GROUPS = {
  chem:  new Set(["chem"]),
  phys:  new Set(["phys"]),
  maths: new Set(["mtx1", "mtx2", "mx111"]), 
};

const SUBJECT_LABEL = {
  chem:  "Chemistry",
  phys:  "Physics",
  maths: "Mathematics",
};

// HELPER FUNCTIONS

const norm = (s) => (s ?? "").toString().trim().toLowerCase();

// cleans all phone numbers to standard format
function stdPhoneNumber(raw) {
  const d = (raw ?? "").toString().replace(REGEX.digits, "");
  if (!d) return "";
  if (d.startsWith("61") && d.length >= 10) return "0" + d.slice(2);
  if (d.length === 9 && d.startsWith("4")) return "0" + d;
  return d;
}

// detects the subject from acuity appointment
function detectFromType(typeStr) {
  const t = (typeStr || "").toString().toLowerCase();
  
  if (REGEX.chem.test(t))  return { code: "chem",  umbrella: "chem"  };
  if (REGEX.phys.test(t))  return { code: "phys",  umbrella: "phys"  };
  if (REGEX.maths.test(t)) return { code: "mx111", umbrella: "maths" };
  
  return null;
}


function normalizeMemberCode(s) {
  const x = (s || "").toString().trim().toLowerCase();

  if (x.startsWith("chem")) return "chem";
  if (x.startsWith("phys")) return "phys";
  if (x.includes("mx111")) return "mx111"; 
  
  if (["mtx1", "mx1", "methods 1", "method 1", "extension 1", "ext 1"].some(c => x.includes(c))) return "mtx1";
  if (["mtx2", "mx2", "methods 2", "method 2", "extension 2", "ext 2"].some(c => x.includes(c))) return "mtx2";

  return x;
}

const firstVal = (row, cols) => {
  for (const c of cols) if (c in row && row[c]) return row[c];
  return "";
};

const idKey = (row) => {
  const email = norm(firstVal(row, CFG.emailCols));
  const phone = stdPhoneNumber(firstVal(row, CFG.phoneCols));
  return email || phone;
};

// csv reader -> error handling
function readCSV(path) {
  try {
    const buf = fs.readFileSync(path);
    const isUtf16 = buf[0] === 0xFF && buf[1] === 0xFE;
    const text = isUtf16 ? buf.toString("utf16le") : buf.toString("utf8");
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  } catch (err) {
    console.error(`Error reading ${path}:`, err.message);
    process.exit(1);
  }
}

// INDEXING LOGIC

function buildEnrolmentIndex(rows, { subjectCols }) {
  const map = new Map();

  for (const r of rows) {
    const k = idKey(r);
    if (!k) continue;

    if (!map.has(k)) map.set(k, { anyActive: false, activeMembers: new Map() });
    
    const raw = firstVal(r, subjectCols);
    if (!raw) continue;

    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }

    const activeMembers = new Map();
    for (const entry of Object.values(parsed)) {
      const state   = entry?.M?.state?.S;
      const subject = entry?.M?.subject?.S;

      // count ACTIVE/ON_TRIAL as enrolled
      if ((state === "ACTIVE" || state === "ON_TRIAL") && subject) {
        activeMembers.set(normalizeMemberCode(subject), state);
      }
    }

    const rec = map.get(k);
    if (activeMembers.size > 0) {
      rec.anyActive = true;
      for (const [s, state] of activeMembers) {
        rec.activeMembers.set(s, state);
      }
    }
  }
  return map;
}

function activeInUmbrella(index, studentKey, umbrella) {
  const rec = index.get(studentKey);
  if (!rec) return false;
  
  const members = SUBJECT_GROUPS[umbrella] || new Set([umbrella]);
  
  for (const [m, _state] of rec.activeMembers) {
    if (members.has(m)) return true;
  }
  return false;
}

function getUmbrellaState(index, studentKey, umbrella) {
  const rec = index.get(studentKey);
  if (!rec) return null;
  const members = SUBJECT_GROUPS[umbrella] || new Set([umbrella]);
  
  let foundState = null;
  for (const [m, state] of rec.activeMembers) {
    if (members.has(m)) {
      if (state === 'ACTIVE') return 'ACTIVE';
      foundState = state; 
    }
  }
  return foundState;
}

// MAIN

// reading csv files
const beforeRows = readCSV("before-program.csv");
const afterRows  = readCSV("after-program.csv");
const acuityRows = readCSV("acuity.csv");

// building enrolment indexes
const beforeIdx = buildEnrolmentIndex(beforeRows, CFG.before);
const afterIdx  = buildEnrolmentIndex(afterRows,  CFG.after);

// CLASSIFICATION

function classifyBooking(row) {
  const key = idKey(row);
  const det = detectFromType(firstVal(row, CFG.acuity.subjectCols));
  
  if (!det) return { key, umbrella: "(unknown)", state: "unknown" };

  const bookingCode = det.code;
  const umbrella    = det.umbrella;
  
  const attendedStr = norm(firstVal(row, CFG.acuity.attendanceCols));
  const attended    = CFG.acuity.attendanceTrueValues.has(attendedStr);

  const name = `${row["First Name"] || ""} ${row["Last Name"] || ""}`.trim() || "(no name)";
  const phone = stdPhoneNumber(row["Phone"] || "");

  const before = beforeIdx.get(key);

  // completely new students
  if (!before) return { key, name, phone, bookingCode, umbrella, attended, state: "completely_new" };

  // existing students
  if (before.anyActive) {
    if (activeInUmbrella(beforeIdx, key, umbrella)) {
      return { key, name, phone, bookingCode, umbrella, attended, state: "existing" };
    }
    return { key, name, phone, bookingCode, umbrella, attended, state: "existing_other_subject" };
  }

  // lead students
  return { key, name, phone, bookingCode, umbrella, attended, state: "lead" };
}

const bookingsRaw = acuityRows
  .map(classifyBooking)
  .filter(b => b.umbrella !== "(unknown)");

const summaryStats = {};
const gainStats = {};
const gainsExportRows = [];

Object.keys(SUBJECT_LABEL).forEach(k => {
    const label = SUBJECT_LABEL[k];
    summaryStats[label] = { total: 0, attended: 0, existing: 0, existing_other: 0, lead: 0, new: 0 };
    gainStats[label] = { total: 0, active: 0, trial: 0, src_existing_other: 0, src_lead: 0, src_new: 0 };
});

const dedupeGains = new Set();

bookingsRaw.forEach(b => {
    const label = SUBJECT_LABEL[b.umbrella];
    
    // summary stats
    const s = summaryStats[label];
    s.total++;
    if (b.attended) s.attended++;
    if (b.state === 'existing') s.existing++;
    if (b.state === 'existing_other_subject') s.existing_other++;
    if (b.state === 'lead') s.lead++;
    if (b.state === 'completely_new') s.new++;

    // calculate gains
    const gainKey = `${b.key}::${b.umbrella}`;
    if (dedupeGains.has(gainKey)) return;
    dedupeGains.add(gainKey);

    const wasBefore = activeInUmbrella(beforeIdx, b.key, b.umbrella);
    const afterState = getUmbrellaState(afterIdx, b.key, b.umbrella);

    const isGain = !!afterState && !wasBefore;

    if (isGain) {
        const g = gainStats[label];
        g.total++;
        if (afterState === 'ACTIVE') g.active++;
        if (afterState === 'ON_TRIAL') g.trial++;
        
        if (b.state === "existing_other_subject") g.src_existing_other++;
        else if (b.state === "lead") g.src_lead++;
        else if (b.state === "completely_new") g.src_new++;

        gainsExportRows.push({
            subject: label,
            name: b.name,
            phone: b.phone,
            from_category_before: b.state,
            current_enrolment_status: afterState
        });
    }
});

// PRINT RESULTS

console.log("\nSUMMARY BY SUBJECT - ACUITY BOOKINGS");
Object.entries(summaryStats).forEach(([label, s]) => {
    const rate = s.total ? ((s.attended / s.total) * 100).toFixed(1) : "0.0";
    console.log(`\nSubject: ${label}`);
    console.log(`  Total bookings: ${s.total}`);
    console.log(`  Attendance rate: ${rate}%`);
    console.log(`  Existing (other subject): ${s.existing_other}`);
    console.log(`  Lead (in system, not active): ${s.lead}`);
    console.log(`  Completely new: ${s.new}`);
});

console.log("\nNEW STUDENTS GAINED AFTER PROGRAM");
Object.entries(gainStats).forEach(([label, g]) => {
    console.log(`\nSubject: ${label}`);
    console.log(`  Total gained: ${g.total}`);
    console.log(`     -> Active: ${g.active}`);
    console.log(`     -> On Trial: ${g.trial}`);
    console.log(`  Sources:`);
    console.log(`    from Existing (other): ${g.src_existing_other}`);
    console.log(`    from Lead: ${g.src_lead}`);
    console.log(`    from New: ${g.src_new}`);
});

// CSV EXPORT (phoebe's request to get list of student names)
function csvEscape(v) {
  const s = (v ?? "").toString();
  return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s.replace(/"/g, '""')}"` : s;
}

// bookings CSV
const uniqueBookings = [];
const seenBookings = new Set();
bookingsRaw.forEach(b => {
    const k = `${b.key}::${b.umbrella}`;
    if (!seenBookings.has(k)) {
        seenBookings.add(k);
        uniqueBookings.push([SUBJECT_LABEL[b.umbrella], b.state, b.attended ? "present" : "absent", b.name, b.phone]);
    }
});

const header1 = ["subject", "category", "attended", "name", "phone"];
const csvContent1 = [header1.map(csvEscape).join(",")].concat(
    uniqueBookings.map(row => row.map(csvEscape).join(","))
).join("\n");
fs.writeFileSync("output_bookings_by_category.csv", csvContent1);

// gains CSV
const header2 = ["subject", "name", "phone", "from_category_before", "current_enrolment_status"];
const csvContent2 = [header2.map(csvEscape).join(",")].concat(
    gainsExportRows.map(r => [r.subject, r.name, r.phone, r.from_category_before, r.current_enrolment_status].map(csvEscape).join(","))
).join("\n");
fs.writeFileSync("output_gains_after_program.csv", csvContent2);