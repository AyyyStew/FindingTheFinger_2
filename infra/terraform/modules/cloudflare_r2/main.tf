resource "cloudflare_r2_bucket" "projection_assets" {
  account_id = var.cloudflare_account_id
  name       = var.r2_projection_bucket_name
  location   = "ENAM"
}

resource "cloudflare_r2_bucket" "db_dumps" {
  account_id = var.cloudflare_account_id
  name       = var.r2_db_bucket_name
  location   = "ENAM"
}
