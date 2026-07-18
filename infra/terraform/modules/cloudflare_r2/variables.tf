variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token for managing R2 buckets."
  sensitive   = true
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID for R2 bucket management."
}

variable "r2_projection_bucket_name" {
  type        = string
  description = "Bucket name for projection assets."
}

variable "r2_db_bucket_name" {
  type        = string
  description = "Bucket name for database dump artifacts."
}
