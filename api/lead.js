// /api/lead.js
// Vercel serverless function (Node.js runtime).
// Receives a contact-form submission, saves it to Google Sheets,
// and sends a notification email via Resend.
//
// All secrets are read from environment variables — never hardcode them.
// Required env vars (set in Vercel > Project > Settings > Environment Variables):
//   GOOGLE_SHEET_ID     - the spreadsheet ID
//   GOOGLE_CLIENT_EMAIL - service account (client) email
//   GOOGLE_PRIVATE_KEY  - service account private key (with \n escaped)
//   RESEND_API_KEY      - Resend API key
//   NOTIFICATION_EMAIL  - address that receives lead notifications
// Optional env var (sensible default applied):
//   LEAD_SHEET_TAB      - worksheet/tab name (default: "Leads")
//
// The Resend "from" address is fixed to onboarding@resend.dev (Resend's
// shared test sender). To use a custom sender, verify your domain in Resend
// and change LEAD_FROM below.

const { google } = require('googleapis');
const { Resend } = require('resend');

// Column order MUST match the sheet header row exactly.
const COLUMNS = ['Timestamp', 'Name', 'Phone', 'Service', 'Message', 'Source', 'gclid'];

module.exports = async function handler(req, res) {
  console.log('LEAD API CALLED', req.method);
  // Only allow POST.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Vercel parses JSON bodies automatically, but guard against string bodies.
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const name = (body.name || '').toString().trim();
    const phone = (body.phone || '').toString().trim();
    const email = (body.email || '').toString().trim();
    const company = (body.company || '').toString().trim();
    const service = (body.service || '').toString().trim();
    const message = (body.message || '').toString().trim();
    const source = (body.source || '').toString().trim();
    const gclid = (body.gclid || '').toString().trim();

    // Minimal validation: Name and Phone are required.
    if (!name || !phone) {
      return res.status(400).json({ ok: false, error: 'Name and phone are required.' });
    }

    const timestamp = new Date().toISOString();

    // --- 1. Save to Google Sheets -------------------------------------------
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      // Vercel stores newlines as literal "\n"; convert them back.
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const tab = process.env.LEAD_SHEET_TAB || 'Leads';

    // Row values in the exact COLUMNS order.
    const row = [timestamp, name, phone, service, message, source, gclid];

    console.log('Trying to save to Google Sheet:', process.env.GOOGLE_SHEET_ID);
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${tab}!A:G`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    
    console.log('Google Sheet save completed');

    // --- 2. Send notification email via Resend ------------------------------
    // Email failure should not lose the lead (it's already in the sheet),
    // so we try/catch it separately.
    let emailSent = false;
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);

      console.log('Starting Resend email...');
      console.log('Has Resend key:', !!process.env.RESEND_API_KEY);
      
      const to = process.env.NOTIFICATION_EMAIL || 'info@sas-properties.com';
      const LEAD_FROM = 'onboarding@resend.dev';
      const from = LEAD_FROM;

      const esc = (s) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

      console.log('Calling Resend API...');
      
      await resend.emails.send({
        from: `BVS Website Leads <${from}>`,
        to: to.split(',').map((s) => s.trim()).filter(Boolean),
        replyTo: email || undefined,
        subject: `New website lead: ${name}`,
        html: `
          <h2>New lead from the BVS Business Center website</h2>
          <table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif">
            <tr><td><b>Name</b></td><td>${esc(name)}</td></tr>
            <tr><td><b>Phone</b></td><td>${esc(phone)}</td></tr>
            <tr><td><b>Email</b></td><td>${esc(email)}</td></tr>
            <tr><td><b>Company</b></td><td>${esc(company)}</td></tr>
            <tr><td><b>Service</b></td><td>${esc(service)}</td></tr>
            <tr><td><b>Message</b></td><td>${esc(message)}</td></tr>
            <tr><td><b>Source</b></td><td>${esc(source)}</td></tr>
            <tr><td><b>gclid</b></td><td>${esc(gclid)}</td></tr>
            <tr><td><b>Time</b></td><td>${esc(timestamp)}</td></tr>
          </table>
        `,
      });
      emailSent = true;
      console.log('Resend email sent successfully');
    } catch (mailErr) {
      console.error('Resend email failed:', mailErr);
    }

    return res.status(200).json({ ok: true, emailSent });
  } catch (err) {
    console.error('Lead handler error:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
};
