output "server_ipv4" {
  value = hcloud_server.app.ipv4_address
}

output "ssh_command" {
  value = "ssh root@${hcloud_server.app.ipv4_address}"
}

output "app_url" {
  value = "https://${local.app_host}"
}

output "recommended_compose_env" {
  value = {
    APP_DOMAIN           = local.app_host
    APP_HTTP_PORT         = var.app_http_port
    CORS_ALLOWED_ORIGINS  = var.cors_allowed_origins
    VITE_STATIC_BASE_URL  = "${var.cloudflare_r2_public_base_url}/releases/2026-07-18"
    DB_RESTORE_URL        = var.db_restore_url
    SERVER_TYPE           = var.server_type
    R2_PROJECTION_BUCKET  = var.r2_projection_bucket_name
    R2_DB_BUCKET          = var.r2_db_bucket_name
  }
}
