terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    bucket                      = "pidlab-tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true
    # key and endpoints set per-workspace via -backend-config
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ─── Variables ──────────────────────────────────────────────────────

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers/R2/DNS permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "environment" {
  description = "Environment: dev or prod"
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be 'dev' or 'prod'."
  }
}

variable "admin_key" {
  description = "Admin API key for /admin/* endpoints"
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key for daily email reports"
  type        = string
  sensitive   = true
  default     = ""
}

variable "report_email" {
  description = "Recipient email for reports and notifications"
  type        = string
  default     = ""
}

variable "report_from_email" {
  description = "Sender email address (must be verified in Resend)"
  type        = string
  default     = "onboarding@resend.dev"
}

variable "domain" {
  description = "Custom domain for the worker (e.g. telemetry.fpvpidlab.app). Leave empty to use *.workers.dev"
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Cloudflare zone ID for custom domain DNS. Required if domain is set."
  type        = string
  default     = ""
}

# License Worker variables
variable "license_admin_key" {
  description = "Admin API key for license /admin/* endpoints"
  type        = string
  sensitive   = true
  default     = ""
}

variable "license_ed25519_private_key" {
  description = "Ed25519 private key (base64 PKCS8 DER) for license signing"
  type        = string
  sensitive   = true
  default     = ""
}

variable "license_ed25519_public_key" {
  description = "Ed25519 public key (base64 SPKI DER) for license verification"
  type        = string
  sensitive   = true
  default     = ""
}

variable "license_domain" {
  description = "Custom domain for the license worker (e.g. license.fpvpidlab.app). Leave empty to use *.workers.dev"
  type        = string
  default     = ""
}

# ─── Locals ─────────────────────────────────────────────────────────

locals {
  is_prod             = var.environment == "prod"
  name_suffix         = local.is_prod ? "" : "-${var.environment}"
  bucket_name         = "pidlab-telemetry${local.name_suffix}"
  worker_name         = "pidlab-telemetry${local.name_suffix}"
  license_db_name     = "pidlab-license${local.name_suffix}"
  license_worker_name = "pidlab-license${local.name_suffix}"
  license_enabled     = var.license_admin_key != "" && var.license_ed25519_private_key != ""
}

# ─── R2 Bucket ──────────────────────────────────────────────────────

resource "cloudflare_r2_bucket" "telemetry" {
  account_id = var.cloudflare_account_id
  name       = local.bucket_name
  location   = "EEUR"
}

# ─── Worker ─────────────────────────────────────────────────────────

resource "cloudflare_workers_script" "telemetry" {
  account_id = var.cloudflare_account_id
  name       = local.worker_name
  content    = file("${path.module}/worker-bundle.js")
  module     = true

  r2_bucket_binding {
    name        = "TELEMETRY_BUCKET"
    bucket_name = cloudflare_r2_bucket.telemetry.name
  }

  secret_text_binding {
    name = "ADMIN_KEY"
    text = var.admin_key
  }

  dynamic "secret_text_binding" {
    for_each = var.resend_api_key != "" ? [1] : []
    content {
      name = "RESEND_API_KEY"
      text = var.resend_api_key
    }
  }

  plain_text_binding {
    name = "REPORT_EMAIL"
    text = var.report_email
  }

  plain_text_binding {
    name = "REPORT_FROM_EMAIL"
    text = var.report_from_email
  }

  plain_text_binding {
    name = "ENVIRONMENT"
    text = var.environment
  }
}

# ─── Cron Trigger ───────────────────────────────────────────────────

resource "cloudflare_workers_cron_trigger" "daily_report" {
  count       = local.is_prod ? 1 : 0
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_workers_script.telemetry.name
  schedules   = ["0 7 * * *"]
}

# ─── Custom Domain (optional) ──────────────────────────────────────

resource "cloudflare_workers_route" "telemetry" {
  count       = var.domain != "" ? 1 : 0
  zone_id     = var.zone_id
  pattern     = "${var.domain}/*"
  script_name = cloudflare_workers_script.telemetry.name
}

resource "cloudflare_record" "telemetry" {
  count   = var.domain != "" ? 1 : 0
  zone_id = var.zone_id
  name    = var.domain
  content = "100::"
  type    = "AAAA"
  proxied = true
  comment = "Telemetry Worker (${var.environment})"
}

# ─── License Worker Custom Domain (optional) ──────────────────────

resource "cloudflare_workers_route" "license" {
  count       = var.license_domain != "" ? 1 : 0
  zone_id     = var.zone_id
  pattern     = "${var.license_domain}/*"
  script_name = local.license_worker_name
}

resource "cloudflare_record" "license" {
  count   = var.license_domain != "" ? 1 : 0
  zone_id = var.zone_id
  name    = var.license_domain
  content = "100::"
  type    = "AAAA"
  proxied = true
  comment = "License Worker (${var.environment})"
}

# ═══════════════════════════════════════════════════════════════════
# LICENSE WORKER
# ═══════════════════════════════════════════════════════════════════

# ─── D1 Database ───────────────────────────────────────────────────

resource "cloudflare_d1_database" "license" {
  count      = local.license_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = local.license_db_name
}

# ─── License Worker ────────────────────────────────────────────────
# Worker script is deployed via `wrangler deploy` in CI/CD (not Terraform).
# Terraform cloudflare_workers_script doesn't support compatibility_date,
# which is required for Ed25519 WebCrypto in CF Workers runtime.
# Wrangler reads compatibility_date from wrangler.toml correctly.
#
# Secrets (ADMIN_KEY, ED25519_*) are set via `wrangler secret put` in CI/CD.
# D1 binding is configured in wrangler.toml with the database_id from Terraform.

# ─── Outputs ────────────────────────────────────────────────────────

output "environment" {
  description = "Active environment"
  value       = var.environment
}

output "worker_url" {
  description = "Worker URL (workers.dev)"
  value       = "https://${local.worker_name}.${var.cloudflare_account_id}.workers.dev"
}

output "custom_url" {
  description = "Custom domain URL (if configured)"
  value       = var.domain != "" ? "https://${var.domain}" : "(not configured)"
}

output "r2_bucket" {
  description = "R2 bucket name"
  value       = cloudflare_r2_bucket.telemetry.name
}

output "license_d1_database" {
  description = "License D1 database name"
  value       = local.license_enabled ? local.license_db_name : "(not configured)"
}
