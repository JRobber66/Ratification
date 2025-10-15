// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

/**
 * Seed members with 4-digit birthday PINs (hashed).
 * Provided members and PINs:
 * - me: 0623
 * - David: 0305
 * - Arnoldo: 0716
 * - Callen: 0621
 * - William: 0115
 *
 * NOTE: names used here must exactly match the member names used in the frontend dropdown.
 */
function bootstrapData() {
  if (fs.existsSync(DATA_PATH)) return;
  const rawMembers = [
    { name: 'Daniel', pin: '0623' },
    { name: 'David', pin: '0305' },
    { name: 'Arnoldo', pin: '0716' },
    { name: 'Callen', pin: '0621' },
    { name: 'William', pin: '0115' }
  ];
  const members = rawMembers.map(m => ({
    name: m.name,
    pinHash: bcrypt.hashSync(String(m.pin), 10)
  }));
  const initial = { members, candidates: [] };
  fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
}

function load() {
  bootstrapData();
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

const makeId = () => Math.random().toString(36).slice(2, 9);

function recalcRatified(candidate, members) {
  const votes = candidate.votes || {};
  const memberNames = members.map(m => m.name);
  const allYes = memberNames.length > 0 && memberNames.every(m => votes[m] === true);
  candidate.ratified = !!allYes;
  candidate.totalMembers = memberNames.length;
}

/* ---------- Endpoints ---------- */

// Health
app.get('/', (_req, res) => res.send('Ratify backend running'));

// Auth - verify member + PIN
app.post('/auth', (req, res) => {
  const { memberName, pin } = req.body || {};
  if (!memberName || !pin) return res.status(400).json({ error: 'memberName and pin required' });

  const d = load();
  const member = d.members.find(m => m.name === memberName);
  if (!member) return res.status(404).json({ error: 'member not found' });

  const ok = bcrypt.compareSync(String(pin), member.pinHash);
  if (!ok) return res.status(401).json({ error: 'invalid pin' });

  // For this simple flow we return success boolean. No tokens issued (sessionless).
  return res.json({ ok: true, memberName });
});

// Return list of member display names (no pins)
app.get('/members', (req, res) => {
  const d = load();
  // return only names to frontend
  res.json({ members: d.members.map(m => m.name) });
});

// Add member (name + pin) - stores hashed pin
app.post('/members', (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });

  const d = load();
  if (d.members.find(m => m.name === name)) return res.status(409).json({ error: 'member exists' });

  const pinHash = bcrypt.hashSync(String(pin), 10);
  d.members.push({ name, pinHash });

  // Recompute ratified flags for candidates (now with new member count)
  d.candidates.forEach(c => recalcRatified(c, d.members));
  save(d);
  res.json({ message: 'member added', members: d.members.map(m => m.name) });
});

// Get candidates
app.get('/candidates', (req, res) => {
  const d = load();
  d.candidates.forEach(c => recalcRatified(c, d.members));
  res.json({ candidates: d.candidates });
});

// Create candidate
app.post('/candidates', (req, res) => {
  const { firstName, lastInitial, notes } = req.body || {};
  if (!firstName || !lastInitial) return res.status(400).json({ error: 'firstName and lastInitial required' });

  const d = load();
  const dupe = d.candidates.find(c =>
    String(c.firstName).toLowerCase() === String(firstName).toLowerCase() &&
    String(c.lastInitial).toLowerCase() === String(lastInitial).slice(0,1).toLowerCase()
  );
  if (dupe) return res.status(409).json({ error: 'name already exists' });

  const candidate = {
    id: makeId(),
    firstName: String(firstName),
    lastInitial: String(lastInitial).slice(0,1).toUpperCase(),
    notes: notes || '',
    votes: {}, // memberName -> boolean
    ratified: false,
    totalMembers: d.members.length,
    createdAt: new Date().toISOString()
  };
  d.candidates.push(candidate);
  save(d);
  res.json({ message: 'candidate added', candidate });
});

// Vote (memberName must match a member)
app.post('/vote', (req, res) => {
  const { candidateId, memberName, vote } = req.body || {};
  if (!candidateId || !memberName || typeof vote !== 'boolean') {
    return res.status(400).json({ error: 'candidateId, memberName, vote(boolean) required' });
  }

  const d = load();
  const candidate = d.candidates.find(c => c.id === candidateId);
  if (!candidate) return res.status(404).json({ error: 'candidate not found' });

  if (!d.members.find(m => m.name === memberName)) return res.status(400).json({ error: 'member not recognized' });

  candidate.votes = candidate.votes || {};
  candidate.votes[memberName] = !!vote;

  recalcRatified(candidate, d.members);
  save(d);
  res.json({ message: 'vote recorded', candidate });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
