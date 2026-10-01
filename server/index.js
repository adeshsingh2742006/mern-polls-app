require('dotenv').config();
const express = require('express'), mongoose = require('mongoose'), cors = require('cors');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const { User, Poll } = require('./models');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, code = 400) => res.status(code).json({ message });
const sign = u => jwt.sign({ id: String(u._id) }, SECRET, { expiresIn: '1d' });
const auth = (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET).id; next(); }
  catch { bad(res, 'Please sign in again', 401); }
};
const view = (p, uid) => {
  const mine = p.voters.find(v => String(v.user) === String(uid));
  return {
    _id: p._id, question: p.question, expiresAt: p.expiresAt, createdAt: p.createdAt,
    expired: p.expiresAt <= new Date(),
    creator: p.creator && p.creator.username ? { _id: p.creator._id, name: p.creator.name, username: p.creator.username } : null,
    choices: p.choices.map(c => ({ _id: c._id, text: c.text, votes: c.votes })),
    selected: mine ? String(mine.choice) : null,
  };
};
const CREATOR = ['name', 'username'];
async function paged(query, req) {
  const page = Math.max(0, parseInt(req.query.page) || 0);
  const size = Math.min(30, Math.max(1, parseInt(req.query.size) || 10));
  const total = await Poll.countDocuments(query);
  const polls = await Poll.find(query).sort({ createdAt: -1 }).skip(page * size).limit(size).populate('creator', CREATOR);
  return { polls: polls.map(p => view(p, req.uid)), page, total, last: (page + 1) * size >= total };
}

// ---------- auth ----------
app.get('/api/auth/check', wrap(async (req, res) => {
  const { username, email } = req.query;
  const q = username ? { username: String(username).toLowerCase().trim() } : { email: String(email || '').toLowerCase().trim() };
  res.json({ taken: !!(await User.exists(q)) });
}));

app.post('/api/auth/signup', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim(), username = String(b.username || '').trim().toLowerCase();
  const email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (name.length < 4 || name.length > 40) return bad(res, 'Name must be 4 to 40 characters');
  if (!/^[a-z0-9_]{3,15}$/.test(username)) return bad(res, 'Username: 3 to 15 letters, numbers or _');
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 40) return bad(res, 'Enter a valid email');
  if (password.length < 6 || password.length > 20) return bad(res, 'Password must be 6 to 20 characters');
  if (await User.exists({ username })) return bad(res, 'Username already taken');
  if (await User.exists({ email })) return bad(res, 'Email already registered');
  try {
    const u = await User.create({ name, username, email, password: await bcrypt.hash(password, 10) });
    res.json({ token: sign(u) });
  } catch (e) { bad(res, e.code === 11000 ? 'Username or email already used' : 'Could not sign up'); }
}));

app.post('/api/auth/signin', wrap(async (req, res) => {
  const id = String((req.body || {}).usernameOrEmail || '').trim().toLowerCase();
  const u = id && (await User.findOne({ $or: [{ username: id }, { email: id }] }));
  if (!u || !(await bcrypt.compare(String((req.body || {}).password || ''), u.password)))
    return bad(res, 'Wrong username/email or password', 401);
  res.json({ token: sign(u) });
}));

app.get('/api/me', auth, wrap(async (req, res) => {
  const u = await User.findById(req.uid);
  if (!u) return bad(res, 'Please sign in again', 401);
  res.json({ _id: u._id, name: u.name, username: u.username });
}));

// ---------- polls ----------
app.get('/api/polls', auth, wrap(async (req, res) => res.json(await paged({}, req))));

app.post('/api/polls', auth, wrap(async (req, res) => {
  const { question, choices, expiry } = req.body || {};
  const cs = Array.isArray(choices) ? choices.map(c => String(c).trim()).filter(Boolean) : [];
  if (!question || !String(question).trim() || String(question).length > 140) return bad(res, 'Question required (max 140 characters)');
  if (cs.length < 2 || cs.length > 6) return bad(res, 'A poll needs 2 to 6 choices');
  if (cs.some(c => c.length > 40)) return bad(res, 'Each choice can be at most 40 characters');
  const days = Math.max(0, parseInt(expiry && expiry.days) || 0), hours = Math.max(0, parseInt(expiry && expiry.hours) || 0);
  if (days * 24 + hours < 1) return bad(res, 'Poll must last at least 1 hour');
  if (days > 365) return bad(res, 'Poll can last at most 365 days');
  const p = await Poll.create({
    question: String(question).trim(), choices: cs.map(text => ({ text })), creator: req.uid,
    expiresAt: new Date(Date.now() + (days * 24 + hours) * 3600000),
  });
  await p.populate('creator', CREATOR);
  res.json(view(p, req.uid));
}));

app.post('/api/polls/:id/vote', auth, wrap(async (req, res) => {
  const { id } = req.params, { choiceId } = req.body || {};
  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(choiceId)) return bad(res, 'Invalid poll or choice');
  const updated = await Poll.findOneAndUpdate(
    { _id: id, expiresAt: { $gt: new Date() }, 'voters.user': { $ne: req.uid }, 'choices._id': choiceId },
    { $inc: { 'choices.$.votes': 1 }, $push: { voters: { user: req.uid, choice: choiceId } } },
    { new: true }).populate('creator', CREATOR);
  if (updated) return res.json(view(updated, req.uid));
  const p = await Poll.findById(id);
  if (!p) return bad(res, 'Poll not found', 404);
  if (p.expiresAt <= new Date()) return bad(res, 'This poll has ended');
  if (p.voters.some(v => String(v.user) === req.uid)) return bad(res, 'You already voted');
  bad(res, 'Invalid choice');
}));

app.delete('/api/polls/:id', auth, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 'Invalid poll');
  const p = await Poll.findById(req.params.id);
  if (!p) return bad(res, 'Poll not found', 404);
  if (String(p.creator) !== req.uid) return bad(res, 'Only the creator can delete this poll', 403);
  await p.deleteOne();
  res.json({ ok: true });
}));

// ---------- profiles ----------
const findUser = async (req, res) => {
  const u = await User.findOne({ username: String(req.params.username).toLowerCase() });
  if (!u) bad(res, 'User not found', 404);
  return u;
};
app.get('/api/users/:username', auth, wrap(async (req, res) => {
  const u = await findUser(req, res); if (!u) return;
  res.json({
    name: u.name, username: u.username, joinedAt: u.createdAt,
    pollCount: await Poll.countDocuments({ creator: u._id }),
    voteCount: await Poll.countDocuments({ 'voters.user': u._id }),
  });
}));
app.get('/api/users/:username/polls', auth, wrap(async (req, res) => {
  const u = await findUser(req, res); if (!u) return;
  res.json(await paged({ creator: u._id }, req));
}));
app.get('/api/users/:username/votes', auth, wrap(async (req, res) => {
  const u = await findUser(req, res); if (!u) return;
  res.json(await paged({ 'voters.user': u._id }, req));
}));

app.use((err, req, res, next) => { console.error(err); bad(res, 'Server error', 500); });

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pollsdb')
  .then(() => app.listen(PORT, () => console.log('API on port ' + PORT)))
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
