// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');

function bootstrapData() {
  if (!fs.existsSync(DATA_PATH)) {
    const initial = { members: ["Arnoldo","Daniel","David","Callen","William"], candidates: [] };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
  }
}
function load() { bootstrapData(); return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
function save(d) { fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }
const makeId = () => Math.random().toString(36).slice(2, 9);

function recalcRatified(candidate, members) {
  const votes = candidate.votes || {};
  const allYes = members.length > 0 && members.every(m => votes[m] === true);
  candidate.ratified = !!allYes;
  candidate.totalMembers = members.length;
}

app.use(cors());              // allow cross-origin (frontend on another origin)
app.use(express.json());      // parse JSON bodies

// Health
app.get('/', (_req, res) => res.send('Ratify backend running'));

// Members
app.get('/members', (req, res) => {
  const d = load();
  res.json({ members: d.members });
});

app.post('/members', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).send('name required');
  const d = load();
  if (d.members.includes(name)) return res.status(409).send('already exists');
  d.members.push(name);
  d.candidates.forEach(c => recalcRatified(c, d.members));
  save(d);
  res.json({ message: 'member added', members: d.members });
});

// Candidates
app.get('/candidates', (req, res) => {
  const d = load();
  d.candidates.forEach(c => recalcRatified(c, d.members));
  res.json({ candidates: d.candidates });
});

app.post('/candidates', (req, res) => {
  const { firstName, lastInitial, notes } = req.body || {};
  if (!firstName || !lastInitial) return res.status(400).send('firstName and lastInitial required');
  const d = load();
  const dupe = d.candidates.find(c =>
    c.firstName.toLowerCase() === String(firstName).toLowerCase() &&
    c.lastInitial.toLowerCase() === String(lastInitial).slice(0,1).toLowerCase()
  );
  if (dupe) return res.status(409).json({ message: 'name already exists' });

  const candidate = {
    id: makeId(),
    firstName: String(firstName),
    lastInitial: String(lastInitial).slice(0,1).toUpperCase(),
    notes: notes || '',
    votes: {},                // memberName -> boolean
    ratified: false,
    totalMembers: d.members.length,
    createdAt: new Date().toISOString()
  };
  d.candidates.push(candidate);
  save(d);
  res.json({ message: 'candidate added', candidate });
});

// Voting
app.post('/vote', (req, res) => {
  const { candidateId, memberName, vote } = req.body || {};
  if (!candidateId || !memberName || typeof vote !== 'boolean') {
    return res.status(400).send('candidateId, memberName, vote(boolean) required');
  }
  const d = load();
  const candidate = d.candidates.find(c => c.id === candidateId);
  if (!candidate) return res.status(404).send('candidate not found');
  if (!d.members.includes(memberName)) return res.status(400).send('member not recognized');

  candidate.votes[memberName] = vote;
  recalcRatified(candidate, d.members);
  save(d);
  res.json({ message: 'vote recorded', candidate });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
