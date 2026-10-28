import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeResumeFilename,
  computeJobDeduplicationKeys,
  validateTailoredResumeAgainstSource,
  createSignedDownloadUrl,
  verifySignedDownloadToken,
  extractJobsFromScrapedPayload,
} from './core.js';

const sampleMasterResume = {
  basics: {
    name: 'Alex Mercer',
    title: 'Senior DevOps & Platform Engineer',
    email: 'alex.mercer.devops@example.com',
  },
  summary:
    'Platform and DevOps Engineer with 6.5 years of experience designing, automating, and operating resilient cloud infrastructure across AWS and Azure.',
  skills: {
    'Cloud Platforms': ['AWS (EKS, EC2, RDS)', 'Azure (AKS, Azure DevOps)'],
    'Infrastructure as Code': ['Terraform', 'Terragrunt', 'Ansible'],
    'Containers & CI/CD': ['Kubernetes', 'Docker', 'Helm', 'ArgoCD', 'GitHub Actions', 'Jenkins'],
    'Observability': ['Prometheus', 'Grafana', 'Python', 'Bash', 'PostgreSQL'],
  },
  experience: [
    {
      company: 'CloudScale Systems',
      role: 'Senior Platform Engineer',
      start_date: '2022-03',
      end_date: 'Present',
      bullets: [
        'Architected and maintained multi-region AWS EKS and Azure AKS production clusters hosting 140+ microservices with 99.98% uptime SLA.',
        'Migrated 95 legacy Jenkins pipelines to reusable GitHub Actions workflows, cutting mean deployment lead time by 58%.',
        'Saved $210,000 in annual cloud compute spend through Karpenter spot autoscaling.',
      ],
    },
  ],
  education: [
    {
      institution: 'University of Washington',
      degree: 'B.S. in Computer Science',
      graduation_year: '2019',
    },
  ],
  certifications: [
    {
      name: 'Certified Kubernetes Administrator (CKA)',
      issuer: 'CNCF',
      year: '2023',
    },
  ],
};

test('buildSafeResumeFilename sanitizes special characters and formats consistently', () => {
  const filename = buildSafeResumeFilename(
    'HashiCorp, Inc. (Cloud / Infra)',
    'Senior DevOps & Platform Engineer!',
    '2026-10-26',
    'docx'
  );
  assert.equal(
    filename,
    'HashiCorp_Inc_Cloud_Infra_Senior_DevOps_Platform_Engineer_Resume_2026-10-26.docx'
  );
});

test('computeJobDeduplicationKeys strips tracking query params and produces deterministic hashes', () => {
  const keys1 = computeJobDeduplicationKeys({
    company: 'Datadog',
    title: 'Senior DevOps Engineer',
    location: 'Remote, US',
    application_url: 'https://boards.greenhouse.io/datadog/jobs/123456?utm_source=linkedin&gh_jid=123456',
    job_description: 'Build Kubernetes and Terraform automation.',
  });
  const keys2 = computeJobDeduplicationKeys({
    company: '  datadog ',
    title: 'senior devops engineer',
    location: 'remote, us',
    application_url: 'https://boards.greenhouse.io/datadog/jobs/123456?utm_medium=cpc',
    job_description: 'Build Kubernetes and Terraform automation.',
  });

  assert.equal(keys1.canonical_url, 'https://boards.greenhouse.io/datadog/jobs/123456');
  assert.equal(keys1.canonical_url, keys2.canonical_url);
  assert.equal(keys1.fallback_dedup_hash, keys2.fallback_dedup_hash);
  assert.equal(keys1.description_sha256, keys2.description_sha256);
});

test('validateTailoredResumeAgainstSource passes valid tailored resume preserving facts and metrics', () => {
  const validTailored = structuredClone(sampleMasterResume);
  validTailored.summary =
    'Senior Platform & DevOps Engineer with 6.5 years of hands-on AWS, Azure, Kubernetes, and Terraform automation experience.';
  validTailored.experience[0].bullets = [
    'Cut mean deployment lead time by 58% by migrating 95 legacy Jenkins pipelines to reusable GitHub Actions workflows.',
    'Operated multi-region AWS EKS and Azure AKS clusters with 99.98% uptime SLA and saved $210,000 annually.',
  ];

  const qa = validateTailoredResumeAgainstSource(sampleMasterResume, validTailored);
  assert.equal(qa.passed, true);
  assert.equal(qa.errors.length, 0);
});

test('validateTailoredResumeAgainstSource rejects fabricated skills, altered dates, and invented metrics', () => {
  const fabricated = structuredClone(sampleMasterResume);
  fabricated.skills['Containers & CI/CD'].push('Rustlang Kernel Hacking');
  fabricated.experience[0].start_date = '2020-01'; // Altered employment date!
  fabricated.experience[0].bullets.push('Reduced latency by 94% saving $950,000.'); // Invented metrics!

  const qa = validateTailoredResumeAgainstSource(sampleMasterResume, fabricated);
  assert.equal(qa.passed, false);
  assert.ok(qa.errors.some((e) => e.includes('Fabricated or altered employment record')));
  assert.ok(qa.errors.some((e) => e.includes('Unsupported skill "Rustlang Kernel Hacking"')));
  assert.ok(qa.errors.some((e) => e.includes('Fabricated performance metric "94%"')));
});

test('createSignedDownloadUrl and verifySignedDownloadToken enforce HMAC integrity and expiration', () => {
  const secret = 'test_hmac_secret_key';
  const signed = createSignedDownloadUrl({
    baseUrl: 'http://localhost:3001',
    filePath: 'Datadog_DevOps_Engineer_Resume_2026-10-26.docx',
    secret,
    expirySeconds: 3600,
  });

  const parsed = new URL(signed.url);
  const validCheck = verifySignedDownloadToken({
    filePath: parsed.searchParams.get('file'),
    expires: parsed.searchParams.get('expires'),
    sig: parsed.searchParams.get('sig'),
    secret,
  });
  assert.equal(validCheck.valid, true);

  const tamperedCheck = verifySignedDownloadToken({
    filePath: 'Other_File.docx',
    expires: parsed.searchParams.get('expires'),
    sig: parsed.searchParams.get('sig'),
    secret,
  });
  assert.equal(tamperedCheck.valid, false);
});

test('extractJobsFromScrapedPayload extracts Schema.org JobPosting JSON-LD from career page HTML', () => {
  const sampleHtml = `
    <!doctype html>
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "identifier": { "value": "stripe-sre-9921" },
            "title": "Senior Infrastructure & Reliability Engineer",
            "hiringOrganization": { "@type": "Organization", "name": "Stripe" },
            "jobLocationType": "TELECOMMUTE",
            "employmentType": "FULL_TIME",
            "datePosted": "2026-10-25",
            "description": "<p>Operate global Kubernetes and Terraform cloud infrastructure with 99.999% availability.</p>",
            "url": "https://stripe.com/jobs/listing/senior-infra-sre/9921?utm_source=careerpage"
          }
        </script>
      </head>
      <body><h1>Careers at Stripe</h1></body>
    </html>
  `;

  const jobs = extractJobsFromScrapedPayload({
    rawBody: sampleHtml,
    contentType: 'text/html',
    sourceUrl: 'https://stripe.com/jobs',
    defaultCompany: 'Stripe',
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].job_id, 'ld_stripe-sre-9921');
  assert.equal(jobs[0].company, 'Stripe');
  assert.equal(jobs[0].title, 'Senior Infrastructure & Reliability Engineer');
  assert.equal(jobs[0].work_mode, 'remote');
  assert.equal(jobs[0].canonical_url, 'https://stripe.com/jobs/listing/senior-infra-sre/9921');
});

test('extractJobsFromScrapedPayload extracts normalized jobs from RSS XML job feeds', () => {
  const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>Remote DevOps Jobs</title>
        <item>
          <title>Cloudflare: Senior Platform DevOps Engineer</title>
          <region>Remote (US/EU)</region>
          <pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate>
          <link>https://weworkremotely.com/remote-jobs/cloudflare-senior-platform-devops</link>
          <description><![CDATA[<p>Build Kubernetes, Terraform, and CI/CD automation at edge scale.</p>]]></description>
        </item>
      </channel>
    </rss>
  `;

  const jobs = extractJobsFromScrapedPayload({
    rawBody: sampleRss,
    contentType: 'application/rss+xml',
    sourceUrl: 'https://weworkremotely.com/categories/remote-devops.rss',
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'Cloudflare');
  assert.equal(jobs[0].title, 'Senior Platform DevOps Engineer');
  assert.equal(jobs[0].work_mode, 'remote');
  assert.ok(jobs[0].job_description.includes('Build Kubernetes, Terraform'));
});

