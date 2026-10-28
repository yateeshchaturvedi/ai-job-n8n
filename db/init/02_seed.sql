-- ============================================================================
-- Migration 02: Seed Initial User, Preferences, Master Resume, and Job Sources
-- ============================================================================

DO $$
DECLARE
    v_user_id UUID := '11111111-1111-4111-8111-111111111111';
    v_resume_id UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
    -- 1. Seed Default User
    INSERT INTO users (
        id, email, full_name, phone, linkedin_url, github_url, portfolio_url, is_active, schedule_enabled, retention_days
    ) VALUES (
        v_user_id,
        'alex.mercer.devops@example.com',
        'Alex Mercer',
        '+1-415-555-0192',
        'https://linkedin.com/in/alexmercer-devops',
        'https://github.com/alexmercer-infra',
        'https://alexmercer.dev',
        TRUE,
        TRUE,
        90
    ) ON CONFLICT (email) DO NOTHING;

    -- 2. Seed Default User Preferences
    INSERT INTO user_preferences (
        user_id,
        target_job_titles,
        years_of_experience,
        technical_skills,
        preferred_locations,
        work_modes,
        work_authorization,
        employment_types,
        salary_min,
        salary_max,
        salary_currency,
        seniority_levels,
        preferred_companies,
        excluded_companies,
        notice_period,
        resume_output_format,
        notification_method,
        notification_target,
        immediate_strong_match_alert,
        strong_match_threshold,
        search_frequency,
        max_jobs_per_run,
        min_match_score,
        scoring_weights
    ) VALUES (
        v_user_id,
        '["DevOps Engineer", "Cloud Infrastructure Engineer", "Platform Engineer", "Azure DevOps Engineer", "Site Reliability Engineer"]'::jsonb,
        6.5,
        '["AWS", "Azure", "Terraform", "Kubernetes", "Docker", "GitHub Actions", "Jenkins", "Helm", "ArgoCD", "Prometheus", "Grafana", "Python", "Bash", "Linux", "PostgreSQL"]'::jsonb,
        '["Remote", "San Francisco, CA", "Seattle, WA", "New York, NY", "United States"]'::jsonb,
        '["remote", "hybrid"]'::jsonb,
        'US Citizen / Authorized to work in the US without sponsorship',
        '["full-time", "contract"]'::jsonb,
        145000,
        195000,
        'USD',
        '["senior", "mid-level", "lead"]'::jsonb,
        '["HashiCorp", "Datadog", "Cloudflare", "GitLab", "Stripe"]'::jsonb,
        '["Stealth Crypto Casino Corp", "Legacy Outsource Inc"]'::jsonb,
        '2 weeks',
        'both',
        'email',
        'alex.mercer.devops@example.com',
        TRUE,
        85,
        'daily',
        15,
        70,
        '{
            "technical_skills": 35,
            "relevant_experience": 25,
            "role_alignment": 20,
            "location_work_mode": 10,
            "seniority_industry": 10
        }'::jsonb
    ) ON CONFLICT (user_id) DO NOTHING;

    -- 3. Seed Master Resume (Structured + Raw Text + Content Hash)
    INSERT INTO resumes (
        id,
        user_id,
        version_tag,
        original_filename,
        file_format,
        storage_path,
        content_sha256,
        parsed_text,
        structured_resume,
        is_current
    ) VALUES (
        v_resume_id,
        v_user_id,
        'master-v1.0',
        'Alex_Mercer_Master_Resume.docx',
        'json',
        '/data/test-data/sample_master_resume.json',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'Alex Mercer - Senior DevOps & Platform Engineer. 6.5 years of experience architecting multi-region AWS and Azure cloud infrastructure, Kubernetes (EKS/AKS) clusters, Terraform IaC modules, and GitHub Actions CI/CD pipelines. Led platform engineering at CloudScale Systems (2022-Present) and DevOps automation at FinTech Pulse (2019-2022). B.S. in Computer Science, University of Washington (2019). Certified Kubernetes Administrator (CKA) and AWS Certified Solutions Architect - Associate.',
        '{
          "basics": {
            "name": "Alex Mercer",
            "title": "Senior DevOps & Platform Engineer",
            "email": "alex.mercer.devops@example.com",
            "phone": "+1-415-555-0192",
            "location": "Seattle, WA (Open to Remote)",
            "linkedin": "https://linkedin.com/in/alexmercer-devops",
            "github": "https://github.com/alexmercer-infra"
          },
          "summary": "Platform and DevOps Engineer with 6.5 years of experience designing, automating, and operating resilient cloud infrastructure across AWS and Azure. Proven track record in Kubernetes cluster lifecycle management, modular Terraform Infrastructure-as-Code, GitOps delivery with ArgoCD and GitHub Actions, and full-stack observability using Prometheus and Grafana.",
          "skills": {
            "Cloud Platforms": ["AWS (EKS, EC2, RDS, IAM, VPC, S3, CloudFront)", "Microsoft Azure (AKS, Azure DevOps, VNet, KeyVault)"],
            "Containers & Orchestration": ["Kubernetes", "Docker", "Helm", "ArgoCD", "Istio"],
            "Infrastructure as Code": ["Terraform", "Terragrunt", "Ansible", "CloudFormation"],
            "CI/CD & Automation": ["GitHub Actions", "Jenkins", "Azure Pipelines", "SonarQube"],
            "Observability & Security": ["Prometheus", "Grafana", "OpenTelemetry", "ELK Stack", "HashiCorp Vault", "Trivy"],
            "Languages & Databases": ["Python", "Bash", "Go (basic)", "PostgreSQL", "Redis"]
          },
          "experience": [
            {
              "company": "CloudScale Systems",
              "role": "Senior Platform Engineer",
              "location": "Seattle, WA (Remote)",
              "start_date": "2022-03",
              "end_date": "Present",
              "bullets": [
                "Architected and maintained multi-region AWS EKS and Azure AKS production clusters hosting 140+ microservices with 99.98% uptime SLA.",
                "Standardized Infrastructure-as-Code across 18 engineering squads by authoring versioned Terraform and Terragrunt modules, reducing environment provisioning time from 4 days to 22 minutes.",
                "Migrated 95 legacy Jenkins pipelines to reusable GitHub Actions workflows and ArgoCD GitOps deployments, cutting mean deployment lead time by 58%.",
                "Implemented centralized Prometheus, Grafana, and OpenTelemetry observability stacks, decreasing Mean Time to Detection (MTTD) for P1 incidents from 19 minutes to 4 minutes.",
                "Partnered with FinOps to right-size Kubernetes node groups and adopt Karpenter spot autoscaling, saving $210,000 in annual cloud compute spend."
              ]
            },
            {
              "company": "FinTech Pulse",
              "role": "DevOps Engineer",
              "location": "San Francisco, CA",
              "start_date": "2019-07",
              "end_date": "2022-02",
              "bullets": [
                "Automated AWS VPC, RDS PostgreSQL, and ECS/EKS infrastructure provisioning using Terraform and Ansible across dev, staging, and PCI-DSS compliant production environments.",
                "Built automated container vulnerability scanning gates in Jenkins and GitHub Actions using Trivy and HashiCorp Vault dynamic secrets.",
                "Managed high-availability PostgreSQL database replicas, automated snapshot verification, and disaster recovery runbooks achieving an RPO of <5 minutes.",
                "Developed Python and Bash CLI tooling for developer self-service log retrieval and ephemeral preview environments, reducing DevOps ticket volume by 40%."
              ]
            }
          ],
          "projects": [
            {
              "name": "KubeGuard Drift Detector",
              "description": "Internal Python service comparing live Kubernetes cluster manifests against Git repositories and alerting Slack on unauthorized manual kubectl edits.",
              "technologies": ["Python", "Kubernetes API", "ArgoCD", "Slack Webhooks"]
            }
          ],
          "education": [
            {
              "institution": "University of Washington",
              "degree": "B.S. in Computer Science",
              "graduation_year": "2019",
              "location": "Seattle, WA"
            }
          ],
          "certifications": [
            {
              "name": "Certified Kubernetes Administrator (CKA)",
              "issuer": "Cloud Native Computing Foundation (CNCF)",
              "year": "2023"
            },
            {
              "name": "AWS Certified Solutions Architect – Associate",
              "issuer": "Amazon Web Services",
              "year": "2022"
            }
          ]
        }'::jsonb,
        TRUE
    ) ON CONFLICT (id) DO NOTHING;

    -- 4. Seed Configured Authorized Job Sources (Greenhouse Public Board API + Lever Postings API)
    INSERT INTO job_sources (
        source_key,
        display_name,
        source_type,
        base_url,
        board_tokens,
        rate_limit_per_minute,
        timeout_ms,
        is_enabled,
        config_json
    ) VALUES
    (
        'greenhouse',
        'Greenhouse Job Board API',
        'greenhouse_api',
        'https://boards-api.greenhouse.io/v1/boards',
        '["hashicorp", "datadog", "cloudflare", "gitlab"]'::jsonb,
        30,
        15000,
        TRUE,
        '{"content_param": "true", "supports_pagination": false, "public_authorized_api": true}'::jsonb
    ),
    (
        'lever',
        'Lever Postings Public API',
        'lever_api',
        'https://api.lever.co/v0/postings',
        '["palantir", "netflix", "spotify"]'::jsonb,
        30,
        15000,
        TRUE,
        '{"mode": "json", "limit": 50, "supports_skip_pagination": true, "public_authorized_api": true}'::jsonb
    ),
    (
        'web_scrape',
        'Career Page & RSS/JSON-LD Scraper (/scrape & Firecrawl)',
        'web_scrape_api',
        'http://docx-service:3001/scrape',
        '["https://remotive.com/api/remote-jobs?category=devops", "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss"]'::jsonb,
        20,
        20000,
        TRUE,
        '{"respects_robots_txt": true, "supports_json_ld_jobposting": true, "supports_rss": true, "supports_firecrawl_proxy": true}'::jsonb
    ),
    (
        'portal_search',
        'Multi-Portal Job Search Aggregator (LinkedIn, Indeed, Naukri, Wellfound via JSearch/SerpApi)',
        'job_search_aggregator',
        'https://jsearch.p.rapidapi.com/search',
        '["DevOps Engineer", "Platform Engineer", "Cloud Infrastructure Engineer"]'::jsonb,
        15,
        20000,
        TRUE,
        '{"providers": ["jsearch_rapidapi", "serpapi_google_jobs", "adzuna"], "date_posted": "week"}'::jsonb
    )
    ON CONFLICT (source_key) DO NOTHING;
END $$;
