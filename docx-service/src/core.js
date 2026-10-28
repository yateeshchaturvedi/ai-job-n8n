import crypto from 'node:crypto';

/**
 * Sanitizes company, role, and date strings into a safe, predictable filename:
 * e.g., CompanyName_DevOps_Engineer_Resume_2026-10-26.docx
 */
export function buildSafeResumeFilename(company, roleTitle, dateStr, extension = 'docx') {
  const cleanPart = (val, fallback) => {
    const str = String(val || fallback)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
    return str.slice(0, 45) || fallback;
  };

  const safeCompany = cleanPart(company, 'Company');
  const safeRole = cleanPart(roleTitle, 'Engineer');
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
    ? dateStr
    : new Date().toISOString().slice(0, 10);
  const safeExt = String(extension).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'docx';

  return `${safeCompany}_${safeRole}_Resume_${safeDate}.${safeExt}`;
}

/**
 * Computes canonical URL and fallback deduplication hash for job records
 */
export function computeJobDeduplicationKeys(job) {
  const rawUrl = String(job.application_url || '').trim();
  let canonicalUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    // Strip tracking query parameters while keeping essential job identifiers
    const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gh_jid', 'ref', 'source'];
    for (const p of stripParams) {
      parsed.searchParams.delete(p);
    }
    canonicalUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`.replace(/\/+$/, '');
  } catch {
    canonicalUrl = rawUrl.toLowerCase();
  }

  const normCompany = String(job.company || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normTitle = String(job.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normLocation = String(job.location || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const fallbackDedupHash = crypto
    .createHash('sha256')
    .update(`${normCompany}|${normTitle}|${normLocation}`)
    .digest('hex');

  const descriptionSha256 = crypto
    .createHash('sha256')
    .update(String(job.job_description || '').trim())
    .digest('hex');

  return {
    canonical_url: canonicalUrl,
    fallback_dedup_hash: fallbackDedupHash,
    description_sha256: descriptionSha256,
  };
}

/**
 * Automated Quality Assurance & Claim Verification against Master Resume
 * Enforces Section 5 & Section 6 Critical Integrity Rules:
 * 1. Employment history (company names, roles, start_date, end_date) must match source resume.
 * 2. Education details (institution, degree, graduation_year) must match source resume.
 * 3. Certifications must be a subset of source resume certifications.
 * 4. Claimed skills must not invent unsupported technologies outside source resume + skills inventory.
 * 5. Numeric metrics (% / $ / numbers) in tailored bullets must exist in source resume.
 * 6. No prompt leakage, confidential markers, or placeholder brackets.
 * 7. Required ATS sections (summary, skills, experience, education) must be present and non-empty.
 */
export function validateTailoredResumeAgainstSource(sourceResume, tailoredResume) {
  const errors = [];
  const warnings = [];

  if (!tailoredResume || typeof tailoredResume !== 'object') {
    return {
      passed: false,
      errors: ['Tailored resume payload is missing or not a valid JSON object.'],
      warnings: [],
    };
  }

  // 1. Check required ATS sections
  if (!tailoredResume.summary || String(tailoredResume.summary).trim().length < 30) {
    errors.push('Missing or excessively short professional summary section.');
  }
  if (!tailoredResume.skills || typeof tailoredResume.skills !== 'object' || Object.keys(tailoredResume.skills).length === 0) {
    errors.push('Missing or empty skills section.');
  }
  if (!Array.isArray(tailoredResume.experience) || tailoredResume.experience.length === 0) {
    errors.push('Missing or empty experience section.');
  }
  if (!Array.isArray(tailoredResume.education) || tailoredResume.education.length === 0) {
    errors.push('Missing or empty education section.');
  }

  // 2. Check for prompt injection leakage, LLM instructions, or unresolved placeholders
  const serializedTailored = JSON.stringify(tailoredResume);
  const forbiddenPatterns = [
    /ignore previous instructions/i,
    /as an ai language model/i,
    /system prompt/i,
    /\[insert\s+.*?\]/i,
    /\{\{.*?\}\}/,
    /TODO:/i,
    /DO NOT FABRICATE/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serializedTailored)) {
      errors.push(`Detected forbidden prompt artifact or placeholder matching ${pattern}.`);
    }
  }

  // 3. Verify Employment History (Companies, Titles, Dates) against Source
  const sourceExpList = Array.isArray(sourceResume?.experience) ? sourceResume.experience : [];
  const tailoredExpList = Array.isArray(tailoredResume?.experience) ? tailoredResume.experience : [];

  for (const tExp of tailoredExpList) {
    const matchInSource = sourceExpList.find(
      (sExp) =>
        String(sExp.company || '').trim().toLowerCase() === String(tExp.company || '').trim().toLowerCase() &&
        String(sExp.start_date || '').trim().toLowerCase() === String(tExp.start_date || '').trim().toLowerCase() &&
        String(sExp.end_date || '').trim().toLowerCase() === String(tExp.end_date || '').trim().toLowerCase()
    );
    if (!matchInSource) {
      errors.push(
        `Fabricated or altered employment record detected: "${tExp.role || 'Unknown Role'}" at "${tExp.company || 'Unknown'}" (${tExp.start_date} - ${tExp.end_date}) does not match source resume.`
      );
    } else if (String(matchInSource.role || '').trim().toLowerCase() !== String(tExp.role || '').trim().toLowerCase()) {
      errors.push(
        `Altered job title detected for ${tExp.company}: tailored title "${tExp.role}" does not match source title "${matchInSource.role}".`
      );
    }
  }

  // 4. Verify Education details match Source
  const sourceEduList = Array.isArray(sourceResume?.education) ? sourceResume.education : [];
  const tailoredEduList = Array.isArray(tailoredResume?.education) ? tailoredResume.education : [];

  for (const tEdu of tailoredEduList) {
    const eduMatch = sourceEduList.find(
      (sEdu) =>
        String(sEdu.institution || '').trim().toLowerCase() === String(tEdu.institution || '').trim().toLowerCase() &&
        String(sEdu.degree || '').trim().toLowerCase() === String(tEdu.degree || '').trim().toLowerCase() &&
        String(sEdu.graduation_year || '').trim() === String(tEdu.graduation_year || '').trim()
    );
    if (!eduMatch) {
      errors.push(
        `Education mismatch or fabrication: "${tEdu.degree}" at "${tEdu.institution}" (${tEdu.graduation_year}) does not match source resume.`
      );
    }
  }

  // 5. Verify Certifications are not fabricated
  const sourceCerts = new Set(
    (Array.isArray(sourceResume?.certifications) ? sourceResume.certifications : []).map((c) =>
      String(c.name || '').trim().toLowerCase()
    )
  );
  const tailoredCerts = Array.isArray(tailoredResume?.certifications) ? tailoredResume.certifications : [];
  for (const tCert of tailoredCerts) {
    const certName = String(tCert.name || '').trim().toLowerCase();
    if (certName && !sourceCerts.has(certName)) {
      errors.push(`Fabricated certification detected: "${tCert.name}" is not in the source resume.`);
    }
  }

  // 6. Verify Skills Inventory against Source Corpus
  const sourceCorpusText = JSON.stringify(sourceResume).toLowerCase();
  const tailoredSkillValues = Object.values(tailoredResume.skills || {}).flat();

  for (const rawSkill of tailoredSkillValues) {
    const cleanSkill = String(rawSkill || '').trim();
    // Extract core token before parentheses e.g. "AWS (EKS, EC2)" -> "aws"
    const primaryToken = cleanSkill.split('(')[0].trim().toLowerCase();
    if (primaryToken.length >= 2 && !sourceCorpusText.includes(primaryToken)) {
      errors.push(`Unsupported skill "${cleanSkill}" claimed in tailored resume but absent from source resume.`);
    }
  }

  // 7. Verify Quantitative Metrics (percentages, dollar figures, multipliers) in Experience Bullets
  const extractMetrics = (text) => {
    const matches = String(text).match(/(?:\$\d[\d,.]*|\d+(?:\.\d+)?%)/g);
    return matches ? matches.map((m) => m.toLowerCase()) : [];
  };

  const sourceMetrics = new Set(extractMetrics(JSON.stringify(sourceResume)));
  const tailoredBulletsText = tailoredExpList.map((e) => (e.bullets || []).join(' ')).join(' ');
  const tailoredMetrics = extractMetrics(tailoredBulletsText);

  for (const metric of tailoredMetrics) {
    if (!sourceMetrics.has(metric)) {
      errors.push(
        `Fabricated performance metric "${metric}" detected in experience bullets; not present in source resume.`
      );
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Generates and verifies HMAC-SHA256 expiring download tokens so resume links are never publicly exposed
 */
export function createSignedDownloadUrl({ baseUrl, filePath, secret, expirySeconds = 86400 }) {
  const expiresAt = Math.floor(Date.now() / 1000) + Number(expirySeconds);
  const payload = `${filePath}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
  const encodedFile = encodeURIComponent(filePath);
  return {
    url: `${String(baseUrl).replace(/\/+$/, '')}/download?file=${encodedFile}&expires=${expiresAt}&sig=${signature}`,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  };
}

export function verifySignedDownloadToken({ filePath, expires, sig, secret }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expNum = Number(expires);
  if (!expNum || nowSec > expNum) {
    return { valid: false, reason: 'Download link has expired.' };
  }
  const expectedSig = crypto
    .createHmac('sha256', String(secret))
    .update(`${filePath}:${expNum}`)
    .digest('hex');

  const sigBuf = Buffer.from(String(sig || ''), 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'Invalid HMAC signature.' };
  }
  return { valid: true };
}

/**
 * Extracts and normalizes job listings from scraped career page HTML (Schema.org JobPosting JSON-LD),
 * RSS/Atom XML feeds, or JSON career endpoints into the common normalized job schema.
 */
export function extractJobsFromScrapedPayload({ rawBody, contentType = '', sourceUrl = '', defaultCompany = 'Career Portal' }) {
  const bodyStr = String(rawBody || '').trim();
  if (!bodyStr) return [];

  const stripHtml = (html) =>
    String(html || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const inferWorkMode = (loc, desc) => {
    const combined = `${loc} ${desc}`.toLowerCase();
    if (combined.includes('remote') || combined.includes('telecommute')) return 'remote';
    if (combined.includes('hybrid')) return 'hybrid';
    return 'onsite';
  };

  const buildJobRecord = (raw) => {
    const title = String(raw.title || '').trim();
    const company = String(raw.company || defaultCompany).trim();
    const location = String(raw.location || 'Remote / Unspecified').trim();
    const description = stripHtml(raw.job_description || raw.description || '');
    const appUrl = String(raw.application_url || raw.url || sourceUrl).trim();
    const keys = computeJobDeduplicationKeys({
      company,
      title,
      location,
      application_url: appUrl,
      job_description: description,
    });

    return {
      job_id: String(raw.job_id || `scrape_${keys.fallback_dedup_hash.slice(0, 16)}`),
      source: String(raw.source || 'web_scrape'),
      title,
      company,
      location,
      work_mode: raw.work_mode || inferWorkMode(location, description.slice(0, 400)),
      employment_type: String(raw.employment_type || 'full-time').toLowerCase(),
      experience_required: raw.experience_required || null,
      required_skills: Array.isArray(raw.required_skills) ? raw.required_skills : [],
      preferred_skills: Array.isArray(raw.preferred_skills) ? raw.preferred_skills : [],
      job_description: description,
      description_sha256: keys.description_sha256,
      salary_range: raw.salary_range || null,
      posted_at: raw.posted_at || new Date().toISOString(),
      application_url: appUrl,
      canonical_url: keys.canonical_url,
      fallback_dedup_hash: keys.fallback_dedup_hash,
      status: 'discovered',
    };
  };

  // 1. Try JSON feed (e.g., Remotive API, Arbetsformedlingen, or structured JSON career endpoints)
  if (contentType.includes('application/json') || bodyStr.startsWith('{') || bodyStr.startsWith('[')) {
    try {
      const parsed = JSON.parse(bodyStr);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.jobs || parsed.data || parsed.results || parsed.postings || [];
      if (Array.isArray(list) && list.length > 0) {
        return list
          .filter((item) => item && (item.title || item.job_title || item.position))
          .map((item) =>
            buildJobRecord({
              job_id: item.id ? `scrape_json_${item.id}` : undefined,
              title: item.title || item.job_title || item.position,
              company: item.company_name || item.employer_name || item.company || defaultCompany,
              location: item.candidate_required_location || item.job_city || item.location || 'Remote',
              employment_type: item.job_type || item.employment_type || 'full-time',
              job_description: item.description || item.job_description || '',
              salary_range: item.salary || null,
              posted_at: item.publication_date || item.posted_at || new Date().toISOString(),
              application_url: item.url || item.job_apply_link || sourceUrl,
            })
          );
      }
    } catch {
      // Fall through to XML/HTML parsing
    }
  }

  // 2. Try RSS / Atom XML Job Feed (<item> blocks)
  if (bodyStr.includes('<rss') || bodyStr.includes('<feed') || bodyStr.includes('<item>')) {
    const items = [];
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(bodyStr)) !== null) {
      const block = match[1];
      const extractTag = (tag) => {
        const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
        return m ? stripHtml(m[1]) : '';
      };
      const rawTitle = extractTag('title');
      const link = extractTag('link') || extractTag('guid') || sourceUrl;
      const desc = extractTag('description') || extractTag('content:encoded');
      const pubDate = extractTag('pubDate') || extractTag('dc:date');
      const region = extractTag('region') || extractTag('location') || 'Remote';

      if (rawTitle) {
        // Split "Company: Job Title" if formatted that way (common on WeWorkRemotely / RemoteOK RSS)
        const parts = rawTitle.includes(':') ? rawTitle.split(':') : [defaultCompany, rawTitle];
        const company = parts.length > 1 ? parts[0].trim() : defaultCompany;
        const title = parts.length > 1 ? parts.slice(1).join(':').trim() : rawTitle;

        items.push(
          buildJobRecord({
            title,
            company,
            location: region,
            job_description: desc || rawTitle,
            posted_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            application_url: link,
          })
        );
      }
    }
    if (items.length > 0) return items;
  }

  // 3. Try HTML Schema.org JobPosting JSON-LD (<script type="application/ld+json">)
  const ldJsonJobs = [];
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = ldRegex.exec(bodyStr)) !== null) {
    try {
      const ldData = JSON.parse(ldMatch[1].trim());
      const nodes = Array.isArray(ldData)
        ? ldData
        : ldData['@graph'] && Array.isArray(ldData['@graph'])
          ? ldData['@graph']
          : [ldData];

      for (const node of nodes) {
        if (node && (node['@type'] === 'JobPosting' || (Array.isArray(node['@type']) && node['@type'].includes('JobPosting')))) {
          const orgName =
            typeof node.hiringOrganization === 'object'
              ? node.hiringOrganization?.name
              : node.hiringOrganization || defaultCompany;

          const address = node.jobLocation?.address || node.jobLocation?.[0]?.address;
          const locStr = address
            ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')
            : node.jobLocationType === 'TELECOMMUTE'
              ? 'Remote'
              : 'Unspecified';

          ldJsonJobs.push(
            buildJobRecord({
              job_id: node.identifier?.value ? `ld_${node.identifier.value}` : undefined,
              title: node.title,
              company: orgName,
              location: locStr || 'Remote',
              work_mode: node.jobLocationType === 'TELECOMMUTE' ? 'remote' : undefined,
              employment_type: Array.isArray(node.employmentType) ? node.employmentType[0] : node.employmentType,
              job_description: node.description || '',
              posted_at: node.datePosted || new Date().toISOString(),
              application_url: node.url || node.directApplyUrl || sourceUrl,
            })
          );
        }
      }
    } catch {
      // Ignore malformed JSON-LD script blocks
    }
  }

  return ldJsonJobs;
}

