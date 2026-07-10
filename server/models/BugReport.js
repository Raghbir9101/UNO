const mongoose = require('mongoose');

// One document per user-submitted bug report from the /contact form.
// No TTL — reports are kept until resolved/deleted by the admin.
const bugReportSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  message: { type: String, required: true },
  page: { type: String, default: '' },        // URL the reporter was on
  userAgent: { type: String, default: '' },
  ip: { type: String, default: '' },
  status: { type: String, enum: ['new', 'seen', 'fixed'], default: 'new', index: true },
  ts: { type: Date, default: Date.now, index: true },
}, {
  versionKey: false
});

const BugReport = mongoose.model('BugReport', bugReportSchema);
module.exports = BugReport;
