import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';
import mammoth from 'mammoth';
import {
  buildSafeResumeFilename,
  validateTailoredResumeAgainstSource,
  createSignedDownloadUrl,
  verifySignedDownloadToken,
  extractJobsFromScrapedPayload,
} from './core.js';

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '15mb' }));

const PORT = Number(process.env.PORT || 3001);
const STORAGE_DIR = process.env.STORAGE_DIR || '/data/resumes';
const API_KEY = process.env.API_KEY || '';
const URL_SIGNING_SECRET = process.env.URL_SIGNING_SECRET || 'default_signing_secret_change_me';
const LINK_EXPIRY_SECONDS = Number(process.env.LINK_EXPIRY_SECONDS || 86400);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// Optional API key middleware for internal endpoints
function requireAuth(req, res, next) {
  if (!API_KEY || API_KEY === 'change_me_internal_docx_service_token') {
    return next();
  }
  const provided = req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (provided !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid X-API-Key' });
  }
  return next();
}

/**
 * Builds an ATS-friendly single-column DOCX Buffer from structured resume JSON
 */
async function generateAtsDocxBuffer(resume) {
  const basics = resume.basics || {};
  const children = [];

  // Header: Candidate Name & Contact Bar
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: basics.name || 'Candidate Name',
          bold: true,
          size: 32,
          font: 'Calibri',
        }),
      ],
    })
  );

  if (basics.title) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: basics.title,
            bold: true,
            size: 22,
            color: '333333',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  const contactItems = [
    basics.location,
    basics.email,
    basics.phone,
    basics.linkedin,
    basics.github,
  ].filter(Boolean);

  if (contactItems.length > 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: contactItems.join('  |  '),
            size: 19,
            color: '444444',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  const addSectionHeading = (title) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 100 },
        border: {
          bottom: { color: '999999', space: 2, style: BorderStyle.SINGLE, size: 6 },
        },
        children: [
          new TextRun({
            text: title.toUpperCase(),
            bold: true,
            size: 22,
            font: 'Calibri',
          }),
        ],
      })
    );
  };

  // 1. Professional Summary
  if (resume.summary) {
    addSectionHeading('Professional Summary');
    children.push(
      new Paragraph({
        spacing: { after: 140 },
        children: [
          new TextRun({
            text: String(resume.summary),
            size: 21,
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  // 2. Technical Skills
  if (resume.skills && typeof resume.skills === 'object') {
    addSectionHeading('Technical Skills');
    for (const [category, skillArray] of Object.entries(resume.skills)) {
      const listStr = Array.isArray(skillArray) ? skillArray.join(', ') : String(skillArray);
      children.push(
        new Paragraph({
          spacing: { after: 70 },
          children: [
            new TextRun({ text: `${category}: `, bold: true, size: 21, font: 'Calibri' }),
            new TextRun({ text: listStr, size: 21, font: 'Calibri' }),
          ],
        })
      );
    }
  }

  // 3. Professional Experience
  if (Array.isArray(resume.experience) && resume.experience.length > 0) {
    addSectionHeading('Professional Experience');
    for (const exp of resume.experience) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({ text: `${exp.role} — ${exp.company}`, bold: true, size: 22, font: 'Calibri' }),
            new TextRun({
              text: `   (${exp.start_date} – ${exp.end_date}${exp.location ? ` | ${exp.location}` : ''})`,
              italics: true,
              size: 20,
              color: '444444',
              font: 'Calibri',
            }),
          ],
        })
      );

      for (const bullet of exp.bullets || []) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: String(bullet),
                size: 21,
                font: 'Calibri',
              }),
            ],
          })
        );
      }
    }
  }

  // 4. Key Projects (Optional)
  if (Array.isArray(resume.projects) && resume.projects.length > 0) {
    addSectionHeading('Projects');
    for (const proj of resume.projects) {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [
            new TextRun({ text: `${proj.name}: `, bold: true, size: 21, font: 'Calibri' }),
            new TextRun({ text: String(proj.description || ''), size: 21, font: 'Calibri' }),
          ],
        })
      );
    }
  }

  // 5. Education
  if (Array.isArray(resume.education) && resume.education.length > 0) {
    addSectionHeading('Education');
    for (const edu of resume.education) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${edu.degree}, `, bold: true, size: 21, font: 'Calibri' }),
            new TextRun({
              text: `${edu.institution} (${edu.graduation_year})`,
              size: 21,
              font: 'Calibri',
            }),
          ],
        })
      );
    }
  }

  // 6. Certifications
  if (Array.isArray(resume.certifications) && resume.certifications.length > 0) {
    addSectionHeading('Certifications');
    for (const cert of resume.certifications) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: `${cert.name} — ${cert.issuer} (${cert.year})`,
              size: 21,
              font: 'Calibri',
            }),
          ],
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

/**
 * Generates a PDF file from either LibreOffice headless conversion (if installed)
 * or native PDFKit fallback so PDF generation is 100% deterministic in all environments.
 */
async function generatePdfFromDocxOrResume(docxPath, pdfPath, resume) {
  try {
    const outDir = path.dirname(pdfPath);
    await execFileAsync('soffice', [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      docxPath,
    ]);
    const librePdfPath = path.join(
      outDir,
      `${path.basename(docxPath, path.extname(docxPath))}.pdf`
    );
    if (librePdfPath !== pdfPath) {
      await fs.rename(librePdfPath, pdfPath);
    }
    const stat = await fs.stat(pdfPath);
    if (stat.size > 500) {
      return { engine: 'libreoffice-writer', size: stat.size };
    }
  } catch {
    // Fallback to PDFKit native rendering when soffice is unavailable
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 45, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        await fs.writeFile(pdfPath, buffer);
        resolve({ engine: 'pdfkit-native', size: buffer.length });
      } catch (err) {
        reject(err);
      }
    });

    const basics = resume.basics || {};
    doc.fontSize(18).font('Helvetica-Bold').text(basics.name || 'Candidate Name', { align: 'center' });
    if (basics.title) {
      doc.moveDown(0.2).fontSize(11).font('Helvetica-Bold').fillColor('#333333').text(basics.title, { align: 'center' });
    }
    const contact = [basics.location, basics.email, basics.phone, basics.linkedin, basics.github]
      .filter(Boolean)
      .join(' | ');
    if (contact) {
      doc.moveDown(0.2).fontSize(9).font('Helvetica').fillColor('#444444').text(contact, { align: 'center' });
    }

    const renderHeading = (heading) => {
      doc.moveDown(0.7).fontSize(11).font('Helvetica-Bold').fillColor('#000000').text(heading.toUpperCase());
      doc.moveTo(45, doc.y).lineTo(567, doc.y).strokeColor('#888888').stroke();
      doc.moveDown(0.3);
    };

    if (resume.summary) {
      renderHeading('Professional Summary');
      doc.fontSize(10).font('Helvetica').text(String(resume.summary));
    }

    if (resume.skills && typeof resume.skills === 'object') {
      renderHeading('Technical Skills');
      for (const [cat, items] of Object.entries(resume.skills)) {
        const list = Array.isArray(items) ? items.join(', ') : String(items);
        doc.fontSize(10).font('Helvetica-Bold').text(`${cat}: `, { continued: true }).font('Helvetica').text(list);
      }
    }

    if (Array.isArray(resume.experience) && resume.experience.length > 0) {
      renderHeading('Professional Experience');
      for (const exp of resume.experience) {
        doc
          .moveDown(0.3)
          .fontSize(10.5)
          .font('Helvetica-Bold')
          .text(`${exp.role} — ${exp.company} (${exp.start_date} – ${exp.end_date})`);
        for (const bullet of exp.bullets || []) {
          doc.fontSize(9.5).font('Helvetica').text(`• ${bullet}`, { indent: 10 });
        }
      }
    }

    if (Array.isArray(resume.education) && resume.education.length > 0) {
      renderHeading('Education');
      for (const edu of resume.education) {
        doc.fontSize(10).font('Helvetica-Bold').text(`${edu.degree}`, { continued: true }).font('Helvetica').text(`, ${edu.institution} (${edu.graduation_year})`);
      }
    }

    if (Array.isArray(resume.certifications) && resume.certifications.length > 0) {
      renderHeading('Certifications');
      for (const cert of resume.certifications) {
        doc.fontSize(9.5).font('Helvetica').text(`• ${cert.name} — ${cert.issuer} (${cert.year})`);
      }
    }

    doc.end();
  });
}

// Healthcheck endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'job-auto-docx-service',
    storage_dir: STORAGE_DIR,
    timestamp: new Date().toISOString(),
  });
});

// 1. Parse uploaded resume (DOCX / PDF / JSON)
app.post('/parse-resume', requireAuth, async (req, res) => {
  try {
    const { file_path, base64_content, filename, structured_resume } = req.body || {};

    if (structured_resume && typeof structured_resume === 'object') {
      const text = JSON.stringify(structured_resume);
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');
      return res.json({
        parsed_text: text,
        structured_resume,
        content_sha256: sha256,
      });
    }

    let buffer;
    if (base64_content) {
      buffer = Buffer.from(base64_content, 'base64');
    } else if (file_path) {
      buffer = await fs.readFile(file_path);
    } else {
      return res.status(400).json({ error: 'Provide structured_resume, base64_content, or file_path' });
    }

    const ext = path.extname(filename || file_path || '').toLowerCase();
    let parsedText = '';
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      parsedText = result.value;
    } else {
      parsedText = buffer.toString('utf8');
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    return res.json({
      parsed_text: parsedText.trim(),
      content_sha256: sha256,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Validate tailored resume claims against master resume (Section 6 QA Gate)
app.post('/validate-claims', requireAuth, (req, res) => {
  const { source_resume, tailored_resume } = req.body || {};
  const result = validateTailoredResumeAgainstSource(source_resume, tailored_resume);
  res.json(result);
});

// 3. Generate, validate, and store DOCX & PDF resumes + signed download URLs
app.post('/generate-resume', requireAuth, async (req, res) => {
  try {
    const {
      source_resume,
      tailored_resume,
      company,
      job_title,
      date_str,
      output_format = 'both',
      skip_qa = false,
    } = req.body || {};

    // Run deterministic claim validation first unless explicitly bypassed
    if (!skip_qa && source_resume) {
      const qaResult = validateTailoredResumeAgainstSource(source_resume, tailored_resume);
      if (!qaResult.passed) {
        return res.status(422).json({
          status: 'qa_failed',
          qa_report: qaResult,
        });
      }
    }

    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const datePart = date_str || new Date().toISOString().slice(0, 10);
    const docxFilename = buildSafeResumeFilename(company, job_title, datePart, 'docx');
    const pdfFilename = buildSafeResumeFilename(company, job_title, datePart, 'pdf');

    const docxPath = path.join(STORAGE_DIR, docxFilename);
    const pdfPath = path.join(STORAGE_DIR, pdfFilename);

    // Generate DOCX
    const docxBuffer = await generateAtsDocxBuffer(tailored_resume);
    await fs.writeFile(docxPath, docxBuffer);

    // Verify DOCX can be opened & parsed back by Mammoth
    const mammothVerify = await mammoth.extractRawText({ buffer: docxBuffer });
    const docxReadable = Boolean(mammothVerify.value && mammothVerify.value.trim().length > 80);

    let pdfMeta = null;
    if (output_format === 'pdf' || output_format === 'both') {
      pdfMeta = await generatePdfFromDocxOrResume(docxPath, pdfPath, tailored_resume);
    }

    const docxSigned = createSignedDownloadUrl({
      baseUrl: PUBLIC_BASE_URL,
      filePath: docxFilename,
      secret: URL_SIGNING_SECRET,
      expirySeconds: LINK_EXPIRY_SECONDS,
    });

    const pdfSigned =
      output_format === 'pdf' || output_format === 'both'
        ? createSignedDownloadUrl({
            baseUrl: PUBLIC_BASE_URL,
            filePath: pdfFilename,
            secret: URL_SIGNING_SECRET,
            expirySeconds: LINK_EXPIRY_SECONDS,
          })
        : null;

    return res.json({
      status: 'generated',
      resume_version_id: `rev-${crypto.randomBytes(4).toString('hex')}-${datePart}`,
      docx_filename: docxFilename,
      docx_storage_path: docxPath,
      docx_download_url: docxSigned.url,
      pdf_filename: pdfSigned ? pdfFilename : null,
      pdf_storage_path: pdfSigned ? pdfPath : null,
      pdf_download_url: pdfSigned ? pdfSigned.url : null,
      link_expires_at: docxSigned.expires_at,
      file_validation: {
        docx_size_bytes: docxBuffer.length,
        docx_parseable_and_readable: docxReadable,
        extracted_char_count: mammothVerify.value.trim().length,
        pdf_generated: Boolean(pdfMeta),
        pdf_engine: pdfMeta?.engine || null,
        pdf_size_bytes: pdfMeta?.size || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. Secure Expiring Download Endpoint
app.get('/download', async (req, res) => {
  try {
    const { file, expires, sig } = req.query;
    const safeBasename = path.basename(String(file || ''));
    if (!safeBasename) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const check = verifySignedDownloadToken({
      filePath: safeBasename,
      expires,
      sig,
      secret: URL_SIGNING_SECRET,
    });

    if (!check.valid) {
      return res.status(403).json({ error: check.reason });
    }

    const fullPath = path.join(STORAGE_DIR, safeBasename);
    await fs.access(fullPath);
    return res.download(fullPath, safeBasename);
  } catch {
    return res.status(404).json({ error: 'Requested resume file not found' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`DOCX & PDF Resume Generation Service listening on port ${PORT}`);
  });
}

export default app;
