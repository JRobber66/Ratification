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

// Seed members (name + hashed 4-digit PINs)
function bootstrapData() {
  if (fs.existsSync(DATA_PATH)) return;
  const rawMembers = [
    { name: 'Daniel',  pin: '0623' },
    { name: 'David',   pin: '0305' },
    { name: 'Arnoldo', pin: '0716' },
    { name: 'Callen',  pin: '0621' },
    { name: 'William', pin: '0115' }
  ];
  const members = rawMembers.map(m => ({ name: m.name, pinHash: bcrypt.hashSync(String(m.pin), 10) }));
  const initial = { members, candidates: [] };
  fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
}

function load() { bootstrapData(); return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
function save(d) { fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }
const makeId = () => Math.random().toString(36).slice(2, 9);

// Helpers
function memberNames(d) { return d.members.map(m => m.name); }
function countYes(v = {}) { return Object.values(v).filter(x => x === true).length; }
function countNo(v = {}) { return Object.values(v).filter(x => x === false).length; }

function recomputeStatus(candidate, membersArr) {
  const names = membersArr.map(m => m.name);
  const votes = candidate.votes || {};
  const total = names.length;
  const votedCount = Object.keys(votes).length;

  const allYes = total > 0 && names.every(n => votes[n] === true);
  const allNo  = total > 0 && votedCount === total && names.every(n => votes[n] === false);

  if (allYes) {
    candidate.status = 'banned';
    candidate.ratified = true;
  } else if (allNo) {
    candidate.status = 'allowed';
    candidate.ratified = false;
  } else {
    candidate.status = 'pending';
    candidate.ratified = false;
  }
  candidate.totalMembers = total;
}

function recomputeAll(d) {
  d.candidates.forEach(c => recomputeStatus(c, d.members));
}

/* ---------- Endpoints ---------- */

// Health
app.get('/', (_req, res) => res.send('Ratify backend running'));

// Auth
app.post('/auth', (req, res) => {
  const { memberName, pin } = req.body || {};
  if (!memberName || !pin) return res.status(400).json({ error: 'memberName and pin required' });
  const d = load();
  const m = d.members.find(x => x.name === memberName);
  if (!m) return res.status(404).json({ error: 'member not found' });
  const ok = bcrypt.compareSync(String(pin), m.pinHash);
  if (!ok) return res.status(401).json({ error: 'invalid pin' });
  res.json({ ok: true, memberName });
});

// Members (names only)
app.get('/members', (req, res) => {
  const d = load();
  res.json({ members: memberNames(d) });
});

app.post('/members', (req, res) => {
  const { name, pin } = req.body || {};
  if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
  const d = load();
  if (d.members.find(m => m.name === name)) return res.status(409).json({ error: 'member exists' });
  d.members.push({ name, pinHash: bcrypt.hashSync(String(pin), 10) });
  recomputeAll(d);
  save(d);
  res.json({ message: 'member added', members: memberNames(d) });
});

// Candidates
app.get('/candidates', (req, res) => {
  const d = load();
  recomputeAll(d);
  res.json({ candidates: d.candidates });
});

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
    votes: {},           // memberName -> boolean
    status: 'pending',   // 'pending' | 'banned' | 'allowed'
    ratified: false,     // kept for compatibility; equals (status==='banned')
    totalMembers: load().members.length,
    createdAt: new Date().toISOString()
  };
  d.candidates.push(candidate);
  recomputeAll(d);
  save(d);
  res.json({ message: 'candidate added', candidate });
});

// Vote
app.post('/vote', (req, res) => {
  const { candidateId, memberName, vote } = req.body || {};
  if (!candidateId || !memberName || typeof vote !== 'boolean') {
    return res.status(400).json({ error: 'candidateId, memberName, vote(boolean) required' });
  }
  const d = load();
  const c = d.candidates.find(x => x.id === candidateId);
  if (!c) return res.status(404).json({ error: 'candidate not found' });
  if (!d.members.find(m => m.name === memberName)) return res.status(400).json({ error: 'member not recognized' });
  c.votes = c.votes || {};
  c.votes[memberName] = !!vote;
  recomputeStatus(c, d.members);
  save(d);
  res.json({ message: 'vote recorded', candidate: c });
});

// Admin actions (no server-side admin gate; UI limits to Daniel)
app.patch('/candidates/:id', (req, res) => {
  const { id } = req.params;
  const { action, status, mode } = req.body || {};
  const d = load();
  const idx = d.candidates.findIndex(c => c.id === id);
  if (idx < 0) return res.status(404).json({ error: 'candidate not found' });
  const c = d.candidates[idx];

  switch (action) {
    case 'reopen':
      c.votes = {};
      c.status = 'pending';
      c.ratified = false;
      break;
    case 'delete':
      d.candidates.splice(idx, 1);
      save(d);
      return res.json({ message: 'deleted', id });
    case 'setStatus':
      if (!['banned','allowed','pending'].includes(status)) {
        return res.status(400).json({ error: 'invalid status' });
      }
      c.status = status;
      c.ratified = status === 'banned';
      // Optionally normalize votes to reflect status
      if (status === 'banned' || status === 'allowed') {
        const yes = status === 'banned';
        c.votes = {};
        memberNames(d).forEach(n => { c.votes[n] = yes; });
      } else if (status === 'pending') {
        c.votes = {};
      }
      break;
    case 'resolve':
      // mode: 'majority' | 'opposite'
      {
        const y = countYes(c.votes);
        const n = countNo(c.votes);
        const majorityIsYes = y >= n; // ties count as YES majority here
        const target = (mode === 'opposite')
          ? (majorityIsYes ? 'allowed' : 'banned')
          : (majorityIsYes ? 'banned' : 'allowed');
        c.status = target;
        c.ratified = target === 'banned';
      }
      break;
    default:
      return res.status(400).json({ error: 'unknown action' });
  }

  recomputeStatus(c, d.members);
  save(d);
  res.json({ message: 'updated', candidate: c });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
