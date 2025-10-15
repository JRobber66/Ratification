// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const DATA_PATH = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    const initial = { members: ["Alice A","Bob B","Charlie C"], candidates: [] };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(d) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2));
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function recalcRatified(candidate, members) {
  // candidate.votes is map memberName -> boolean
  const votes = candidate.votes || {};
  // ratified = every member has a vote === true
  const allYes = members.length > 0 && members.every(m => votes[m] === true);
  candidate.ratified = !!allYes;
  candidate.totalMembers = members.length;
}

const app = express();
app.use(cors());
app.use(express.json());

// GET members
app.get('/members', (req, res) => {
  const d = loadData();
  res.json({ members: d.members });
});

// Optional: endpoint to add member (edit group)
app.post('/members', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).send('name required');
  const d = loadData();
  if (d.members.includes(name)) return res.status(409).send('already exists');
  d.members.push(name);
  // Recalc all candidates ratified fields
  d.candidates.forEach(c => recalcRatified(c, d.members));
  saveData(d);
  res.json({ message: 'member added', members: d.members });
});

// GET candidates (with votes)
app.get('/candidates', (req, res) => {
  const d = loadData();
  // Recalc ratified before sending
  d.candidates.forEach(c => recalcRatified(c, d.members));
  res.json({ candidates: d.candidates });
});

// POST create candidate
app.post('/candidates', (req, res) => {
  const { firstName, lastInitial, notes } = req.body;
  if (!firstName || !lastInitial) return res.status(400).send('firstName and lastInitial required');
  const d = loadData();
  // duplicate check (case-insensitive)
  const exists = d.candidates.find(c => c.firstName.toLowerCase() === firstName.toLowerCase() && c.lastInitial.toLowerCase() === lastInitial.toLowerCase());
  if (exists) return res.status(409).json({ message: 'name already exists' });
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
  saveData(d);
  res.json({ message: 'candidate added', candidate });
});

// POST vote
app.post('/vote', (req, res) => {
  const { candidateId, memberName, vote } = req.body;
  if (!candidateId || !memberName || typeof vote !== 'boolean') return res.status(400).send('candidateId, memberName, vote(boolean) required');
  const d = loadData();
  const candidate = d.candidates.find(c => c.id === candidateId);
  if (!candidate) return res.status(404).send('candidate not found');
  if (!d.members.includes(memberName)) return res.status(400).send('member not recognized');
  candidate.votes = candidate.votes || {};
  candidate.votes[memberName] = !!vote;
  // recompute ratified
  recalcRatified(candidate, d.members);
  saveData(d);
  res.json({ message: 'vote recorded', candidate });
});

// Simple health
app.get('/', (req, res) => res.send('Ratify backend running'));

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
