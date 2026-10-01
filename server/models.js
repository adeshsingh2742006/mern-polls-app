const { Schema, model } = require('mongoose');
const User = model('User', new Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
}, { timestamps: true }));
const Poll = model('Poll', new Schema({
  question: { type: String, required: true, trim: true, maxlength: 140 },
  choices: [{ text: { type: String, required: true, maxlength: 40 }, votes: { type: Number, default: 0 } }],
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  voters: [{ _id: false, user: { type: Schema.Types.ObjectId, index: true }, choice: Schema.Types.ObjectId }],
}, { timestamps: true }));
module.exports = { User, Poll };
