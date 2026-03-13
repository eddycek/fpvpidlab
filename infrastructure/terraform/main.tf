terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Remote state in Cloudflare R2 (bootstrapped manually once)
  # Uncomment after first `terraform init` with local state:
  #
  # backend "s3" {
  #   bucket                      = "pidlab-tfstate"
  #   key                         = "terraform.tfstate"
  #   region                      = "auto"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   use_path_style              = true
  #   endpoints = {
  #     s3 = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
  #   }
  # }
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

variable "admin_key" {
  description = "Admin API key for /admin/* endpoints"
  type        = string
  sensitive   = true
}

variable "resend_api_key" {
  description = "Resend API key for daily email reports"
  type        = string
  sensitive   = true
}

variable "report_email" {
  description = "Email address for daily telemetry reports"
  type        = string
}

# Optional: custom domain
variable "domain" {
  description = "Custom domain for the worker (e.g. telemetry.pidlab.app). Leave empty to use *.workers.dev"
  type        = string
  default     = ""
}

variable "zone_id" {
  description = "Cloudflare zone ID for custom domain DNS. Required if domain is set."
  type        = string
  default     = ""
}

# ─── R2 Bucket ──────────────────────────────────────────────────────

resource "cloudflare_r2_bucket" "telemetry" {
  account_id = var.cloudflare_account_id
  name       = "pidlab-telemetry"
  location   = "EEUR"
}

# ─── Worker ─────────────────────────────────────────────────────────

resource "cloudflare_workers_script" "telemetry" {
  account_id = var.cloudflare_account_id
  name       = "pidlab-telemetry"
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

  secret_text_binding {
    name = "RESEND_API_KEY"
    text = var.resend_api_key
  }

  plain_text_binding {
    name = "REPORT_EMAIL"
    text = var.report_email
  }
}

# ─── Cron Trigger ───────────────────────────────────────────────────

resource "cloudflare_workers_cron_trigger" "daily_report" {
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
  comment = "Telemetry Worker custom domain"
}

# ─── Outputs ────────────────────────────────────────────────────────

output "worker_url" {
  description = "Worker URL (workers.dev)"
  value       = "https://pidlab-telemetry.${var.cloudflare_account_id}.workers.dev"
}

output "custom_url" {
  description = "Custom domain URL (if configured)"
  value       = var.domain != "" ? "https://${var.domain}" : "(not configured)"
}

output "r2_bucket" {
  description = "R2 bucket name"
  value       = cloudflare_r2_bucket.telemetry.name
}
