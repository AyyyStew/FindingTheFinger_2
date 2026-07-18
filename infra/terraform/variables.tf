variable "project_name" {
  type        = string
  description = "Prefix used for Hetzner resources."
  default     = "finding-the-finger"
}

variable "hcloud_token" {
  type        = string
  description = "Hetzner Cloud API token used by the Terraform provider."
  default     = ""
  sensitive   = true
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API token used by the Terraform provider when Cloudflare resources are managed here."
  default     = ""
  sensitive   = true
}

variable "server_type" {
  type        = string
  description = "Hetzner server type. Change this single value to resize later."
  default     = "cpx31"
}

variable "server_image" {
  type        = string
  description = "Hetzner image slug."
  default     = "ubuntu-24.04"
}

variable "location" {
  type        = string
  description = "Hetzner location."
  default     = "ash"
}

variable "domain" {
  type        = string
  description = "Base domain used for docs and outputs."
  default     = "example.com"
}

variable "hostname" {
  type        = string
  description = "App hostname."
  default     = "ftf"
}

variable "hcloud_ssh_keys" {
  type        = list(string)
  description = "Hetzner SSH key names or IDs to attach to the server."
  default     = []
}

variable "managed_ssh_public_key" {
  type        = string
  description = "Optional local SSH public key content to register in Hetzner and attach to the server."
  default     = ""
}

variable "managed_ssh_key_name" {
  type        = string
  description = "Name to assign to the Terraform-managed Hetzner SSH key."
  default     = ""
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "CIDR ranges allowed to SSH to the server."
  default     = ["0.0.0.0/0", "::/0"]
}

variable "create_r2_buckets" {
  type        = bool
  description = "Whether Terraform should create the R2 buckets."
  default     = true
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID for R2 bucket management."
  default     = ""
}

variable "r2_projection_bucket_name" {
  type        = string
  description = "Bucket name for projection assets."
  default     = "ftf-assets"
}

variable "r2_db_bucket_name" {
  type        = string
  description = "Bucket name for database dump artifacts."
  default     = "ftf-db-dumps"
}

variable "cloudflare_r2_public_base_url" {
  type        = string
  description = "Public base URL for the R2 assets endpoint."
  default     = "https://static.findingthefinger.ayyystew.com"
}

variable "app_http_port" {
  type        = number
  description = "Public HTTP port for the Docker Compose web service."
  default     = 80
}

variable "cors_allowed_origins" {
  type        = string
  description = "Comma-separated origins allowed by the backend."
  default     = "https://ftf.example.com"
}

variable "db_restore_url" {
  type        = string
  description = "Versioned SQL dump URL used to bootstrap the database."
  default     = ""
}
